#!/usr/bin/env python3
"""Mailbox unit checks (no sidecar, no HTTP)."""
from __future__ import annotations

import time

from mailbox import Mailbox, host_is_blocked_name, normalize_url


def test_normalize_blocks_private() -> None:
    assert normalize_url("https://127.0.0.1/") == (None, None)
    assert normalize_url("http://10.0.0.1/x") == (None, None)
    assert normalize_url("https://192.168.1.1") == (None, None)
    assert normalize_url("https://localhost/foo") == (None, None)
    assert normalize_url("https://user:pass@example.com/") == (None, None)
    assert normalize_url("dfjfj") == (None, None)
    assert normalize_url("https://dfjfj/") == (None, None)
    assert normalize_url("not a url") == (None, None)
    url, host = normalize_url("example.com/path")
    assert host == "www.example.com" and url == "https://www.example.com/path"


def test_normalize_adds_www() -> None:
    url, host = normalize_url("https://facebook.com/")
    assert host == "www.facebook.com" and url == "https://www.facebook.com/"
    url, host = normalize_url("https://www.facebook.com/")
    assert host == "www.facebook.com" and url == "https://www.facebook.com/"
    url, host = normalize_url("google.com")
    assert host == "www.google.com" and url == "https://www.google.com/"


def test_blocked_names() -> None:
    assert host_is_blocked_name("localhost")
    assert host_is_blocked_name("foo.internal")
    assert host_is_blocked_name("169.254.169.254")
    assert not host_is_blocked_name("example.com")


def test_live_queue_and_verdict() -> None:
    box = Mailbox(agent_token="secret", lab_online_sec=30, max_live_per_hour=10)
    created, err = box.create_check("https://example.com/")
    assert created is None and err == "lab_offline"

    box.ping()
    created, err = box.create_check("https://malware-test.amastan.demo/")
    assert err is None and created
    assert created["status"] == "queued"
    assert created["mode"] == "pending"
    assert created["verdict"] is None
    job_id = created["job_id"]

    claimed = box.claim(0)
    assert claimed and claimed["id"] == job_id
    assert box.complete(
        job_id,
        {"verdict": "block", "category": "malware", "reason": "sidecar", "upstream": {"secret": "no"}},
    )
    pub = box.public_job(job_id)
    assert pub and pub["mode"] == "live" and pub["verdict"] == "block"
    assert "upstream" not in pub
    assert pub.get("source") == "sidecar"


def test_no_queue_without_ping() -> None:
    box = Mailbox(agent_token="secret")
    created, err = box.create_check("https://example.com")
    assert created is None and err == "lab_offline"
    assert box.claim(0) is None


def test_live_cap() -> None:
    box = Mailbox(agent_token="t", max_live_per_hour=1, lab_online_sec=60)
    box.ping()
    a, err_a = box.create_check("https://example.com/a")
    b, err_b = box.create_check("https://example.com/b")
    assert a and a["status"] == "queued"
    assert b is None and err_b == "live_busy"


def test_inbox_flags_and_local_diff() -> None:
    box = Mailbox(agent_token="t", lab_online_sec=60)
    box.ping()
    empty = box.inbox()
    assert empty["new_url"] is False
    assert empty["urls"] == []

    created, _ = box.create_check("https://example.com/")
    assert created and created["new_url"] is True
    job_id = created["job_id"]
    box2 = box.inbox()
    assert box2["new_url"] is True
    assert [u["id"] for u in box2["urls"]] == [job_id]

    treated_ids: set[str] = set()
    fresh = [u for u in box2["urls"] if u["id"] not in treated_ids]
    assert [u["id"] for u in fresh] == [job_id]
    treated_ids.add(job_id)
    fresh_again = [u for u in box2["urls"] if u["id"] not in treated_ids]
    assert fresh_again == []

    ack = box.ack_urls([job_id])
    assert ack["new_url"] is False
    assert box.inbox()["new_url"] is False

    assert box.complete(job_id, {"verdict": "allow", "reason": "ok"})
    pub = box.public_job(job_id)
    assert pub and pub["new_verdict"] is True
    seen = box.mark_verdict_seen(job_id)
    assert seen and seen["new_verdict"] is False


def test_claim_timeout() -> None:
    box = Mailbox(agent_token="t")
    box.ping()
    started = time.time()
    assert box.claim(0.2) is None
    assert time.time() - started < 1.5


if __name__ == "__main__":
    tests = [
        test_normalize_blocks_private,
        test_normalize_adds_www,
        test_blocked_names,
        test_live_queue_and_verdict,
        test_no_queue_without_ping,
        test_live_cap,
        test_claim_timeout,
        test_inbox_flags_and_local_diff,
    ]
    for fn in tests:
        fn()
        print(f"ok {fn.__name__}")
    print(f"{len(tests)} passed")
