#!/usr/bin/env python3
"""Amastan website server: static files + Check URL mailbox API."""
from __future__ import annotations

import hmac
import json
import os
import time
from collections import defaultdict, deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from mailbox import JOB_ID_RE, Mailbox, mailbox_from_env

ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("AMASTAN_SITE_HOST", "127.0.0.1")
PORT = int(os.environ.get("AMASTAN_SITE_PORT", "8765"))
RATE_LIMIT = int(os.environ.get("AMASTAN_CHECK_RATE_LIMIT", "30"))

BOX: Mailbox = mailbox_from_env()
_HITS: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(handler: SimpleHTTPRequestHandler) -> str:
    forwarded = handler.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",", 1)[0].strip() or handler.client_address[0]
    return handler.client_address[0]


def _rate_limited(ip: str) -> bool:
    now = time.time()
    window = _HITS[ip]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= RATE_LIMIT:
        return True
    window.append(now)
    return False


def _bearer(handler: SimpleHTTPRequestHandler) -> str:
    header = handler.headers.get("Authorization") or ""
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return ""


def _agent_ok(handler: SimpleHTTPRequestHandler) -> bool:
    token = BOX.agent_token
    offered = _bearer(handler)
    if not token or not offered:
        return False
    try:
        return hmac.compare_digest(offered, token)
    except (TypeError, ValueError):
        return False


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        if path.endswith((".json", ".js", ".css", ".html")) or path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):  # noqa: N802
        if self.path.startswith("/api/"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.end_headers()
            return
        self.send_error(404)

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path == "/api/check-url":
            self._handle_check_url()
            return
        if path == "/api/agent/ping":
            self._handle_agent_ping()
            return
        if path == "/api/agent/claim":
            self._handle_agent_claim()
            return
        if path == "/api/agent/result":
            self._handle_agent_result()
            return
        if path == "/api/agent/ack":
            self._handle_agent_ack()
            return
        if path.endswith("/seen") and path.startswith("/api/check-url/jobs/"):
            job_id = path.split("/api/check-url/jobs/")[-1].removesuffix("/seen").strip("/")
            self._handle_verdict_seen(job_id)
            return
        self.send_error(404)

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path == "/api/check-url/health":
            self._json_response(200, BOX.health())
            return
        if path == "/api/check-url/history":
            self._handle_check_history()
            return
        if path == "/api/agent/inbox":
            self._handle_agent_inbox()
            return
        if path.startswith("/api/check-url/jobs/"):
            job_id = path.rsplit("/", 1)[-1]
            job = BOX.public_job(job_id)
            if not job:
                self._json_response(404, {"ok": False, "error": "not_found"})
                return
            self._json_response(200, job)
            return
        # Cloudflare Pages-style: /community -> community.html
        if path != "/" and not path.startswith("/api/"):
            name = path.lstrip("/")
            if "/" not in name and "." not in name:
                html = ROOT / f"{name}.html"
                if html.is_file():
                    parsed = urlparse(self.path)
                    self.path = f"/{html.name}" + (f"?{parsed.query}" if parsed.query else "")
        super().do_GET()

    def log_message(self, fmt: str, *args) -> None:
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)
            return
        super().log_message(fmt, *args)

    def _json_response(self, status: int, payload: dict, extra_headers: dict | None = None) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 16_384:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def _handle_check_url(self) -> None:
        ip = _client_ip(self)
        if _rate_limited(ip):
            self._json_response(429, {"ok": False, "error": "rate_limited"})
            return
        payload = self._read_json()
        result, err = BOX.create_check(
            str(payload.get("url") or ""),
            client={"ip": ip},
        )
        if err or not result:
            code = 400
            if err == "lab_offline":
                code = 503
            elif err == "live_busy":
                code = 429
            self._json_response(code, {"ok": False, "error": err or "invalid_url"})
            return
        self._json_response(200, result)

    def _handle_check_history(self) -> None:
        from urllib.parse import parse_qs

        qs = parse_qs(urlparse(self.path).query)
        try:
            limit = int((qs.get("limit") or ["50"])[0])
        except (TypeError, ValueError):
            limit = 50
        from check_history import list_history

        self._json_response(200, list_history(limit=limit))

    def _handle_agent_ping(self) -> None:
        if not _agent_ok(self):
            self._json_response(401, {"ok": False, "error": "unauthorized"})
            return
        self._read_json()
        BOX.ping()
        self._json_response(200, {"ok": True, "lab_online": True})

    def _handle_agent_inbox(self) -> None:
        if not _agent_ok(self):
            self._json_response(401, {"ok": False, "error": "unauthorized"})
            return
        BOX.ping()
        self._json_response(200, BOX.inbox())

    def _handle_agent_ack(self) -> None:
        if not _agent_ok(self):
            self._json_response(401, {"ok": False, "error": "unauthorized"})
            return
        body = self._read_json()
        ids = body.get("job_ids") or body.get("ids") or []
        if not isinstance(ids, list):
            ids = []
        self._json_response(200, BOX.ack_urls([str(x) for x in ids]))

    def _handle_verdict_seen(self, job_id: str) -> None:
        job = BOX.mark_verdict_seen(job_id)
        if not job:
            self._json_response(404, {"ok": False, "error": "not_found"})
            return
        self._json_response(200, job)

    def _handle_agent_claim(self) -> None:
        if not _agent_ok(self):
            self._json_response(401, {"ok": False, "error": "unauthorized"})
            return
        body = self._read_json()
        wait_sec = body.get("wait_sec", 20)
        try:
            wait_sec = float(wait_sec)
        except (TypeError, ValueError):
            wait_sec = 20.0
        job = BOX.claim(wait_sec)
        if not job:
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            return
        self._json_response(200, job)

    def _handle_agent_result(self) -> None:
        if not _agent_ok(self):
            self._json_response(401, {"ok": False, "error": "unauthorized"})
            return
        body = self._read_json()
        job_id = str(body.get("job_id") or "")
        if not JOB_ID_RE.match(job_id):
            self._json_response(400, {"ok": False, "error": "invalid_job"})
            return
        if body.get("error"):
            ok = BOX.fail(job_id, str(body.get("error")))
        else:
            ok = BOX.complete(job_id, body)
        if not ok:
            self._json_response(404, {"ok": False, "error": "not_found"})
            return
        self._json_response(200, {"ok": True})


if __name__ == "__main__":
    live = "on" if BOX.agent_token and not BOX.force_demo else "off"
    print(f"Amastan site: http://{HOST}:{PORT}/")
    print(f"Check URL: POST /api/check-url (demo first, live queue={live})")
    print("Lab agent: POST /api/agent/ping|claim|result (Bearer AMASTAN_AGENT_TOKEN)")
    print("Contact uses mailto → kabdi.kalboddine@gmail.com (no DB).")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
