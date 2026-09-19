#!/usr/bin/env python3
"""Persistent public history of Check URL verdicts (mailbox / site)."""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DEFAULT_PATH = Path(
    os.environ.get("AMASTAN_CHECK_HISTORY_FILE")
    or (ROOT / "data" / "checked-history.json")
)
MAX_ITEMS = int(os.environ.get("AMASTAN_CHECK_HISTORY_MAX", "200"))
_LOCK = threading.Lock()


def _empty() -> dict[str, Any]:
    return {"ok": True, "updated_at": 0, "items": []}


def _load(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return _empty()
    if not isinstance(raw, dict):
        return _empty()
    items = raw.get("items")
    if not isinstance(items, list):
        items = []
    return {"ok": True, "updated_at": float(raw.get("updated_at") or 0), "items": items}


def _save(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def record_verdict(
    *,
    url: str,
    host: str,
    verdict: str,
    category: str = "",
    reason: str = "",
    source: str = "",
    mode: str = "live",
    path: Path | None = None,
) -> None:
    """Upsert by host (latest verdict wins), newest first."""
    store = path or DEFAULT_PATH
    host_key = (host or "").lower().strip(".")
    if not host_key or not url:
        return
    entry = {
        "url": str(url)[:2048],
        "host": host_key[:253],
        "verdict": str(verdict or "unknown").strip().lower()[:40],
        "category": str(category or "n/a")[:200],
        "reason": str(reason or "")[:400],
        "source": str(source or "")[:80],
        "mode": str(mode or "live")[:40],
        "checked_at": time.time(),
    }
    with _LOCK:
        data = _load(store)
        items = [i for i in data["items"] if isinstance(i, dict) and i.get("host") != host_key]
        items.insert(0, entry)
        data["items"] = items[:MAX_ITEMS]
        data["updated_at"] = entry["checked_at"]
        data["ok"] = True
        _save(store, data)


def list_history(*, limit: int = 50, path: Path | None = None) -> dict[str, Any]:
    store = path or DEFAULT_PATH
    lim = max(1, min(int(limit or 50), 100))
    with _LOCK:
        data = _load(store)
    items = [i for i in data["items"] if isinstance(i, dict)][:lim]
    return {
        "ok": True,
        "count": len(items),
        "updated_at": data.get("updated_at") or 0,
        "items": items,
    }
