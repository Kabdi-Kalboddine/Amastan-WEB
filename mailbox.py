#!/usr/bin/env python3
"""In-process Check URL mailbox: demo verdicts + queued live jobs for the lab agent."""
from __future__ import annotations

import ipaddress
import os
import re
import socket
import threading
import time
import uuid
from collections import deque
from typing import Any
from urllib.parse import urlparse

MAX_URL_LEN = 2048
JOB_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)

ALLOW_HOSTS = {
    "example.com",
    "www.example.com",
    "wikipedia.org",
    "www.wikipedia.org",
    "en.wikipedia.org",
    "google.com",
    "www.google.com",
    "github.com",
    "microsoft.com",
    "apple.com",
    "cloudflare.com",
}

BLOCK_EXACT = {
    "malware-test.amastan.demo": ("malware", "Matched demo malware block list"),
    "phishing-login.amastan.demo": ("phishing", "Matched demo phishing block list"),
    "casino-offers.amastan.demo": ("gambling", "Matched demo gambling policy"),
}

BLOCK_KEYWORDS = (
    ("phish", "phishing", "Suspected phishing pattern in hostname"),
    ("malware", "malware", "Suspected malware pattern in hostname"),
    ("casino", "gambling", "Gambling category policy"),
    ("bet365", "gambling", "Gambling category policy"),
    ("porn", "adult", "Adult content category policy"),
)

RBI_KEYWORDS = ("pastebin", "raw.githubusercontent")

BLOCKED_HOSTS = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "metadata.google.internal",
}
BLOCKED_HOST_SUFFIXES = (".localhost", ".local", ".internal", ".home", ".lan")


def host_is_blocked_name(host: str) -> bool:
    h = (host or "").lower().strip(".")
    if not h or h in BLOCKED_HOSTS:
        return True
    if any(h.endswith(suf) for suf in BLOCKED_HOST_SUFFIXES):
        return True
    try:
        ip = ipaddress.ip_address(h)
    except ValueError:
        return False
    return not ip.is_global


def host_resolves_unsafe(host: str, timeout_sec: float = 2.0) -> bool:
    """True if DNS yields any non-global address (private, loopback, link-local)."""
    if host_is_blocked_name(host):
        return True
    prev = socket.getdefaulttimeout()
    try:
        socket.setdefaulttimeout(timeout_sec)
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, TimeoutError, OSError):
        return False
    finally:
        socket.setdefaulttimeout(prev)
    for info in infos:
        sockaddr = info[4]
        if not sockaddr:
            continue
        try:
            ip = ipaddress.ip_address(sockaddr[0])
        except ValueError:
            continue
        if not ip.is_global:
            return True
    return False


def normalize_url(raw: str) -> tuple[str, str] | tuple[None, None]:
    text = (raw or "").strip()
    if not text or len(text) > MAX_URL_LEN:
        return None, None
    if "://" not in text:
        text = "https://" + text
    try:
        parsed = urlparse(text)
    except Exception:
        return None, None
    if parsed.scheme not in {"http", "https"}:
        return None, None
    if parsed.username or parsed.password:
        return None, None
    host = (parsed.hostname or "").lower().strip(".")
    if not host or not re.match(r"^[a-z0-9.-]+$", host):
        return None, None
    if host_is_blocked_name(host):
        return None, None
    # Single-label junk like "dfjfj" is not a public hostname.
    try:
        ipaddress.ip_address(host)
        is_ip = True
    except ValueError:
        is_ip = False
    if not is_ip:
        labels = [p for p in host.split(".") if p]
        if len(labels) < 2 or any(len(p) == 0 for p in host.split(".")):
            return None, None
        tld = labels[-1]
        if tld.isdigit() or len(tld) < 2:
            return None, None
        if not host.startswith("www."):
            host = "www." + host
    path = parsed.path or "/"
    query = f"?{parsed.query}" if parsed.query else ""
    clean = f"{parsed.scheme}://{host}{path}{query}"
    return clean, host


def demo_classify(url: str, host: str) -> dict[str, Any]:
    lower_url = (url or "").lower()
    h = (host or "").lower()
    if "testsafebrowsing.appspot.com" in h or "testsafebrowsing.withgoogle.com" in h:
        if "social_engineering" in lower_url:
            return {
                "verdict": "block",
                "category": "phishing",
                "reason": "Google Safe Browsing social-engineering test URL",
                "confidence": 0.99,
                "source": "demo-policy",
            }
        if "malware" in lower_url:
            return {
                "verdict": "block",
                "category": "malware",
                "reason": "Google Safe Browsing malware test URL",
                "confidence": 0.99,
                "source": "demo-policy",
            }
        if "unwanted" in lower_url:
            return {
                "verdict": "block",
                "category": "unwanted-software",
                "reason": "Google Safe Browsing unwanted-software test URL",
                "confidence": 0.99,
                "source": "demo-policy",
            }
        return {
            "verdict": "block",
            "category": "threat-test",
            "reason": "Google Safe Browsing test host",
            "confidence": 0.95,
            "source": "demo-policy",
        }
    if host in BLOCK_EXACT:
        category, reason = BLOCK_EXACT[host]
        return {
            "verdict": "block",
            "category": category,
            "reason": reason,
            "confidence": 0.99,
            "source": "demo-policy",
        }
    for needle, category, reason in BLOCK_KEYWORDS:
        if needle in host:
            return {
                "verdict": "block",
                "category": category,
                "reason": reason,
                "confidence": 0.92,
                "source": "demo-policy",
            }
    for needle in RBI_KEYWORDS:
        if needle in host:
            return {
                "verdict": "rbi",
                "category": "untrusted-content",
                "reason": "Host marked for Remote Browser Isolation in demo policy",
                "confidence": 0.8,
                "source": "demo-policy",
            }
    if host in ALLOW_HOSTS or host.endswith(".example.com"):
        return {
            "verdict": "allow",
            "category": "business",
            "reason": "Matched demo allow list",
            "confidence": 0.97,
            "source": "demo-policy",
        }
    return {
        "verdict": "unknown",
        "category": "unknown",
        "reason": "No demo policy matched. Live lab did not classify this host.",
        "confidence": 0.2,
        "source": "demo-fallback",
    }


def destination_meta(url: str, host: str) -> dict[str, Any]:
    """URL shape fields similar to what an operator sees beside category."""
    try:
        parsed = urlparse(url)
    except Exception:
        parsed = None
    labels = [p for p in (host or "").split(".") if p]
    registered = ".".join(labels[-2:]) if len(labels) >= 2 else (host or "")
    path = (parsed.path if parsed else "/") or "/"
    return {
        "scheme": (parsed.scheme if parsed else "") or "",
        "host": host,
        "path": path[:500],
        "has_query": bool(parsed and parsed.query),
        "registered_domain": registered[:253],
        "is_https": bool(parsed and parsed.scheme == "https"),
    }


def sanitize_client(client: dict[str, Any] | None) -> dict[str, Any]:
    """Visitor context for the verdict page only (not public history)."""
    raw = client if isinstance(client, dict) else {}
    ip = str(raw.get("ip") or "").strip()[:45]
    country = str(raw.get("country") or "").strip().upper()[:2]
    asn = str(raw.get("asn") or "").strip()[:16]
    colo = str(raw.get("colo") or "").strip()[:8]
    out: dict[str, Any] = {}
    if ip:
        out["ip"] = ip
    if country:
        out["country"] = country
    if asn:
        out["asn"] = asn
    if colo:
        out["colo"] = colo
    return out


def public_result(job: dict[str, Any]) -> dict[str, Any]:
    live = job.get("live")
    done_live = job["status"] == "done" and isinstance(live, dict)
    if done_live:
        src = live
        mode = "live"
        verdict = src.get("verdict", "unknown")
        category = src.get("category", "n/a")
        reason = src.get("reason", "")
        confidence = src.get("confidence")
        source = src.get("source")
        latency_ms = src.get("latency_ms")
    elif job["status"] in {"queued", "running"}:
        mode = "pending"
        verdict = None
        category = None
        reason = ""
        confidence = None
        source = None
        latency_ms = None
    else:
        mode = job["status"]
        verdict = None
        category = None
        reason = "Lab did not return a live verdict"
        confidence = None
        source = None
        latency_ms = None
    client = job.get("client") if isinstance(job.get("client"), dict) else {}
    dest = job.get("destination") if isinstance(job.get("destination"), dict) else {}
    if not dest:
        dest = destination_meta(str(job.get("url") or ""), str(job.get("host") or ""))
    return {
        "ok": True,
        "job_id": job["id"],
        "status": job["status"],
        "lab_pending": job["status"] in {"queued", "running"},
        "new_url": job["status"] in {"queued", "running"},
        "new_verdict": done_live and not job.get("verdict_seen"),
        "mode": mode,
        "url": job["url"],
        "host": job["host"],
        "verdict": verdict,
        "category": category,
        "reason": reason,
        "confidence": confidence,
        "source": source,
        "latency_ms": latency_ms,
        "client": client,
        "destination": dest,
    }


def sanitize_live_result(payload: dict[str, Any]) -> dict[str, Any]:
    verdict = str(payload.get("verdict") or payload.get("action") or payload.get("decision") or "unknown")
    return {
        "verdict": verdict.strip().lower() or "unknown",
        "category": str(payload.get("category") or payload.get("cat") or "n/a")[:200],
        "reason": str(payload.get("reason") or payload.get("message") or payload.get("detail") or "")[:500],
        "confidence": payload.get("confidence", payload.get("score")),
        "source": "sidecar",
        "latency_ms": payload.get("latency_ms"),
    }


class Mailbox:
    def __init__(
        self,
        *,
        agent_token: str = "",
        job_ttl_sec: int = 120,
        lab_online_sec: int = 20,
        max_live_per_hour: int = 20,
        force_demo: bool = False,
    ) -> None:
        self.agent_token = (agent_token or "").strip()
        self.job_ttl_sec = job_ttl_sec
        self.lab_online_sec = lab_online_sec
        self.max_live_per_hour = max_live_per_hour
        self.force_demo = force_demo
        self._lock = threading.Lock()
        self._cv = threading.Condition(self._lock)
        self._jobs: dict[str, dict[str, Any]] = {}
        self._last_ping = 0.0
        self._live_created: deque[float] = deque()

    def lab_online(self) -> bool:
        if not self.agent_token or self.force_demo:
            return False
        return (time.time() - self._last_ping) < self.lab_online_sec

    def health(self) -> dict[str, Any]:
        with self._lock:
            online = self.lab_online()
            now = time.time()
            self._purge_locked(now)
            queued = [j for j in self._jobs.values() if j["status"] == "queued"]
            unread_verdicts = [
                j for j in self._jobs.values() if j["status"] == "done" and not j.get("verdict_seen")
            ]
            return {
                "ok": True,
                "demo": False,
                "lab_online": online,
                "live_queue_enabled": bool(self.agent_token) and not self.force_demo,
                "agent_configured": bool(self.agent_token),
                "new_url": bool(queued),
                "new_verdict": bool(unread_verdicts),
            }

    def ping(self) -> None:
        with self._lock:
            self._last_ping = time.time()

    def _purge_locked(self, now: float) -> None:
        expired = [jid for jid, job in self._jobs.items() if job["expires_at"] <= now]
        for jid in expired:
            job = self._jobs[jid]
            if job["status"] in {"queued", "running"}:
                job["status"] = "timeout"
            # Drop finished jobs after TTL so memory stays bounded.
            if job["expires_at"] + 60 <= now:
                del self._jobs[jid]
        while self._live_created and now - self._live_created[0] > 3600:
            self._live_created.popleft()

    def _under_live_cap_locked(self, now: float) -> bool:
        while self._live_created and now - self._live_created[0] > 3600:
            self._live_created.popleft()
        return len(self._live_created) < self.max_live_per_hour

    def create_check(
        self, raw_url: str, *, client: dict[str, Any] | None = None
    ) -> tuple[dict[str, Any] | None, str | None]:
        url, host = normalize_url(raw_url)
        if not url or not host:
            return None, "invalid_url"
        now = time.time()
        job_id = str(uuid.uuid4())
        job: dict[str, Any] = {
            "id": job_id,
            "url": url,
            "host": host,
            "status": "queued",
            "created_at": now,
            "expires_at": now + self.job_ttl_sec,
            "live": None,
            "verdict_seen": False,
            "client": sanitize_client(client),
            "destination": destination_meta(url, host),
        }
        with self._cv:
            self._purge_locked(now)
            if not self.lab_online():
                return None, "lab_offline"
            if not self._under_live_cap_locked(now):
                return None, "live_busy"
            self._live_created.append(now)
            self._jobs[job_id] = job
            self._cv.notify()
        payload = public_result(job)
        payload["lab_online"] = True
        payload["queued_live"] = True
        return payload, None

    def public_job(self, job_id: str) -> dict[str, Any] | None:
        if not JOB_ID_RE.match(job_id or ""):
            return None
        with self._lock:
            self._purge_locked(time.time())
            job = self._jobs.get(job_id)
            if not job:
                return None
            return public_result(job)

    def inbox(self) -> dict[str, Any]:
        """PC agent reads this. Website never connects outbound to the lab."""
        with self._lock:
            self._purge_locked(time.time())
            urls = [
                {"id": job["id"], "url": job["url"], "host": job["host"]}
                for job in self._jobs.values()
                if job["status"] == "queued"
            ]
            return {
                "ok": True,
                "new_url": bool(urls),
                "urls": urls,
            }

    def ack_urls(self, job_ids: list[str]) -> dict[str, Any]:
        """PC took the list: new_url becomes false for those rows (queued → running)."""
        taken = 0
        now = time.time()
        with self._cv:
            self._purge_locked(now)
            want = {jid for jid in job_ids if JOB_ID_RE.match(jid or "")}
            for job in self._jobs.values():
                if job["id"] in want and job["status"] == "queued":
                    job["status"] = "running"
                    job["claimed_at"] = now
                    taken += 1
            inbox = [
                {"id": job["id"], "url": job["url"], "host": job["host"]}
                for job in self._jobs.values()
                if job["status"] == "queued"
            ]
            return {"ok": True, "taken": taken, "new_url": bool(inbox)}

    def mark_verdict_seen(self, job_id: str) -> dict[str, Any] | None:
        """Browser displayed the live result: new_verdict → false for this job."""
        if not JOB_ID_RE.match(job_id or ""):
            return None
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            job["verdict_seen"] = True
            return public_result(job)

    def claim(self, wait_sec: float = 0.0) -> dict[str, Any] | None:
        deadline = time.time() + max(0.0, min(wait_sec, 25.0))
        with self._cv:
            while True:
                now = time.time()
                self._purge_locked(now)
                for job in self._jobs.values():
                    if job["status"] == "queued":
                        job["status"] = "running"
                        job["claimed_at"] = now
                        return {"id": job["id"], "url": job["url"], "host": job["host"]}
                remaining = deadline - time.time()
                if remaining <= 0:
                    return None
                self._cv.wait(timeout=remaining)

    def complete(self, job_id: str, live: dict[str, Any]) -> bool:
        if not JOB_ID_RE.match(job_id or ""):
            return False
        with self._cv:
            job = self._jobs.get(job_id)
            if not job or job["status"] not in {"queued", "running"}:
                return False
            job["live"] = sanitize_live_result(live)
            job["status"] = "done"
            job["verdict_seen"] = False
            snap = {
                "url": job["url"],
                "host": job["host"],
                "verdict": job["live"].get("verdict"),
                "category": job["live"].get("category"),
                "reason": job["live"].get("reason"),
                "source": job["live"].get("source"),
            }
            self._cv.notify_all()
        try:
            from check_history import record_verdict

            record_verdict(
                url=snap["url"],
                host=snap["host"],
                verdict=str(snap["verdict"] or "unknown"),
                category=str(snap["category"] or ""),
                reason=str(snap["reason"] or ""),
                source=str(snap["source"] or "sidecar"),
                mode="live",
            )
        except Exception:
            pass
        return True

    def fail(self, job_id: str, reason: str) -> bool:
        if not JOB_ID_RE.match(job_id or ""):
            return False
        with self._cv:
            job = self._jobs.get(job_id)
            if not job or job["status"] not in {"queued", "running"}:
                return False
            job["status"] = "error"
            job["live"] = None
            job["error"] = str(reason)[:300]
            self._cv.notify_all()
            return True


def mailbox_from_env() -> Mailbox:
    force = os.environ.get("AMASTAN_CHECK_DEMO", "").strip().lower() in {"1", "true", "yes"}
    return Mailbox(
        agent_token=os.environ.get("AMASTAN_AGENT_TOKEN", ""),
        job_ttl_sec=int(os.environ.get("AMASTAN_JOB_TTL_SEC", "120")),
        lab_online_sec=int(os.environ.get("AMASTAN_LAB_ONLINE_SEC", "20")),
        max_live_per_hour=int(os.environ.get("AMASTAN_MAX_LIVE_PER_HOUR", "20")),
        force_demo=force,
    )
