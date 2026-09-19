#!/usr/bin/env python3
"""Pull URL list from the website mailbox. The website never connects to this PC."""
from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from mailbox import host_resolves_unsafe  # noqa: E402

MAILBOX_URL = os.environ.get("AMASTAN_MAILBOX_URL", "http://127.0.0.1:8765").rstrip("/")
AGENT_TOKEN = os.environ.get("AMASTAN_AGENT_TOKEN", "").strip()
CLASSIFY_URL = os.environ.get("AMASTAN_CLASSIFY_URL", "http://127.0.0.1:8010/classify").rstrip("/")
CLASSIFY_TOKEN = os.environ.get("AMASTAN_CLASSIFY_TOKEN", "").strip()
POLL_SEC = float(os.environ.get("AMASTAN_AGENT_POLL_SEC", "1"))
SLEEP_ERR = float(os.environ.get("AMASTAN_AGENT_ERROR_SLEEP", "3"))
TREATED_PATH = Path(os.environ.get("AMASTAN_TREATED_FILE", str(ROOT / "data" / "treated.json")))
TREATED_MAX = 500


def _request(
    url: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    token: str = "",
    timeout: float = 30.0,
) -> tuple[int, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Accept": "application/json", "User-Agent": "amastan-lab-agent/1.0"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            payload: Any = json.loads(raw) if raw else {}
            return resp.status, payload
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"error": raw[:300] or exc.reason}
        return exc.code, payload


def load_treated() -> dict[str, Any]:
    if not TREATED_PATH.is_file():
        return {"job_ids": [], "urls": {}}
    try:
        data = json.loads(TREATED_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"job_ids": [], "urls": {}}
    if not isinstance(data, dict):
        return {"job_ids": [], "urls": {}}
    ids = data.get("job_ids") if isinstance(data.get("job_ids"), list) else []
    urls = data.get("urls") if isinstance(data.get("urls"), dict) else {}
    return {"job_ids": [str(x) for x in ids], "urls": {str(k): v for k, v in urls.items()}}


def save_treated(store: dict[str, Any]) -> None:
    TREATED_PATH.parent.mkdir(parents=True, exist_ok=True)
    ids = store.get("job_ids") or []
    if len(ids) > TREATED_MAX:
        store["job_ids"] = ids[-TREATED_MAX:]
    tmp = TREATED_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(store, indent=2), encoding="utf-8")
    tmp.replace(TREATED_PATH)


def inbox() -> dict[str, Any]:
    status, payload = _request(
        f"{MAILBOX_URL}/api/agent/inbox",
        method="GET",
        token=AGENT_TOKEN,
        timeout=10,
    )
    if status != 200 or not isinstance(payload, dict):
        raise RuntimeError(f"inbox HTTP {status}: {payload}")
    return payload


def ack(job_ids: list[str]) -> None:
    status, payload = _request(
        f"{MAILBOX_URL}/api/agent/ack",
        method="POST",
        body={"job_ids": job_ids},
        token=AGENT_TOKEN,
        timeout=10,
    )
    if status != 200:
        raise RuntimeError(f"ack HTTP {status}: {payload}")


def complete(job_id: str, live: dict[str, Any]) -> None:
    status, payload = _request(
        f"{MAILBOX_URL}/api/agent/result",
        method="POST",
        body={"job_id": job_id, **live},
        token=AGENT_TOKEN,
        timeout=10,
    )
    if status != 200:
        raise RuntimeError(f"result HTTP {status}: {payload}")


def fail(job_id: str, reason: str) -> None:
    status, _payload = _request(
        f"{MAILBOX_URL}/api/agent/result",
        method="POST",
        body={"job_id": job_id, "error": reason},
        token=AGENT_TOKEN,
        timeout=10,
    )
    if status not in {200, 404}:
        raise RuntimeError(f"fail HTTP {status}")


def classify(url: str) -> dict[str, Any]:
    body_obj = {"url": url, "method": "GET"}
    if CLASSIFY_TOKEN:
        body_obj["jwt_token"] = CLASSIFY_TOKEN
    body = json.dumps(body_obj).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "amastan-lab-agent/1.0",
    }
    if CLASSIFY_TOKEN:
        headers["Authorization"] = f"Bearer {CLASSIFY_TOKEN}"
    req = urllib.request.Request(CLASSIFY_URL, data=body, headers=headers, method="POST")
    started = time.perf_counter()
    with urllib.request.urlopen(req, timeout=8) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        data = json.loads(raw) if raw else {}
    if not isinstance(data, dict):
        data = {}
    verdict = ""
    for key in ("verdict", "action", "decision", "result"):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            verdict = val.strip().lower()
            break
    return {
        "verdict": verdict or "unknown",
        "category": str(data.get("category") or data.get("cat") or "n/a"),
        "reason": str(data.get("reason") or data.get("message") or data.get("detail") or "Sidecar classify"),
        "confidence": data.get("confidence", data.get("score")),
        "latency_ms": round((time.perf_counter() - started) * 1000, 1),
    }


def new_jobs(website_list: list[Any], treated: dict[str, Any]) -> list[dict[str, Any]]:
    seen = set(treated.get("job_ids") or [])
    out: list[dict[str, Any]] = []
    for item in website_list:
        if not isinstance(item, dict):
            continue
        job_id = str(item.get("id") or "")
        if not job_id or job_id in seen:
            continue
        out.append(item)
    return out


def handle_job(item: dict[str, Any], treated: dict[str, Any]) -> None:
    job_id = str(item.get("id") or "")
    url = str(item.get("url") or "")
    host = str(item.get("host") or "")
    urls_cache = treated.setdefault("urls", {})
    if not isinstance(urls_cache, dict):
        urls_cache = {}
        treated["urls"] = urls_cache

    if host_resolves_unsafe(host):
        fail(job_id, "blocked_host")
        print(f"skip {job_id}: unsafe host {host}")
        return

    cached = urls_cache.get(url)
    if isinstance(cached, dict) and cached.get("verdict"):
        complete(job_id, cached)
        print(f"cache {job_id} {cached.get('verdict')} {host}")
    else:
        try:
            live = classify(url)
        except Exception as exc:  # noqa: BLE001
            fail(job_id, str(exc))
            print(f"classify failed {job_id}: {exc}")
            time.sleep(SLEEP_ERR)
            return
        complete(job_id, live)
        urls_cache[url] = {
            "verdict": live.get("verdict"),
            "category": live.get("category"),
            "reason": live.get("reason"),
            "confidence": live.get("confidence"),
            "latency_ms": live.get("latency_ms"),
        }
        print(f"live {job_id} {live.get('verdict')} {host}")

    ids = treated.setdefault("job_ids", [])
    if job_id not in ids:
        ids.append(job_id)
    save_treated(treated)


def main() -> int:
    if not AGENT_TOKEN:
        print("Set AMASTAN_AGENT_TOKEN (same value as the website mailbox).", file=sys.stderr)
        return 2
    treated = load_treated()
    print(f"Lab agent mailbox={MAILBOX_URL} poll={POLL_SEC}s classify={CLASSIFY_URL}")
    print(f"Treated list: {TREATED_PATH} ({len(treated.get('job_ids') or [])} jobs)")
    while True:
        try:
            box = inbox()
            if not box.get("new_url"):
                time.sleep(POLL_SEC)
                continue
            website_list = box.get("urls") if isinstance(box.get("urls"), list) else []
            fresh = new_jobs(website_list, treated)
            ids = [str(item.get("id")) for item in website_list if isinstance(item, dict) and item.get("id")]
            if ids:
                ack(ids)
            if not fresh:
                print("new_url true but no new jobs vs local treated list")
                time.sleep(POLL_SEC)
                continue
            for item in fresh:
                handle_job(item, treated)
            time.sleep(POLL_SEC)
        except KeyboardInterrupt:
            print("lab-agent stopped")
            return 0
        except Exception as exc:  # noqa: BLE001
            print(f"agent loop: {exc}", file=sys.stderr)
            time.sleep(SLEEP_ERR)


if __name__ == "__main__":
    raise SystemExit(main())
