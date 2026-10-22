#!/usr/bin/env python3
"""
Probe outcomes.reconcile + decision snooze sweep.

Modes:
  sync (default) — call task functions directly against FINANCE_API_URL / INTELLIGENCE_URL
  async          — apply_async via Celery (needs REDIS_URL reachable)

  cd backend-monytix/intelligence && \\
    FINANCE_API_URL=http://127.0.0.1:8090 INTELLIGENCE_URL=http://127.0.0.1:8091 \\
    INTERNAL_TOKEN=... ../../.venv-or-path python ../../scripts/probe_celery_tasks.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


def load_dotenv() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text().splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def main() -> int:
    load_dotenv()
    mode = (os.environ.get("PROBE_MODE") or "sync").strip().lower()
    # Prefer localhost when compose DNS hostname is used.
    finance = os.environ.get("FINANCE_API_URL") or "http://127.0.0.1:8090"
    if "finance-api" in finance or finance.endswith("//redis") or "://redis" in finance:
        finance = "http://127.0.0.1:8090"
    intel = os.environ.get("INTELLIGENCE_URL") or "http://127.0.0.1:8091"
    if "finance-intelligence" in intel:
        intel = "http://127.0.0.1:8091"
    os.environ["FINANCE_API_URL"] = finance
    os.environ["INTELLIGENCE_URL"] = intel

    if not os.environ.get("INTERNAL_TOKEN"):
        print(json.dumps({"event": "fatal", "error": "INTERNAL_TOKEN missing"}))
        return 1

    intel_root = Path(__file__).resolve().parents[1] / "backend-monytix" / "intelligence"
    sys.path.insert(0, str(intel_root))

    from app.tasks import reconcile_outcomes_mile, sweep_expired_snoozes

    if mode == "async":
        redis_url = os.environ.get("REDIS_URL") or "redis://127.0.0.1:6379/0"
        if redis_url.startswith("redis://redis:") or redis_url == "redis://redis:6379/0":
            redis_url = "redis://127.0.0.1:6379/0"
            os.environ["REDIS_URL"] = redis_url
        from app.celery_app import celery

        r1 = celery.send_task("app.tasks.reconcile_outcomes_mile", args=[{}], queue="reconciliation")
        r2 = celery.send_task("app.tasks.sweep_expired_snoozes", args=[{}], queue="decisions")
        print(json.dumps({"event": "dispatched", "outcomes_id": r1.id, "snooze_id": r2.id}))
        deadline = time.time() + 60
        results = {}
        while time.time() < deadline and len(results) < 2:
            for label, async_result in (("outcomes", r1), ("snooze", r2)):
                if label in results:
                    continue
                if async_result.ready():
                    results[label] = {"state": async_result.state, "result": async_result.result}
            time.sleep(0.5)
        print(json.dumps({"event": "async_results", "results": results}, default=str))
        if len(results) < 2:
            print(json.dumps({"event": "fatal", "error": "timeout waiting for worker"}))
            return 1
        ok = all(item.get("state") == "SUCCESS" for item in results.values())
        return 0 if ok else 1

    # Sync probe — same task bodies the worker runs.
    # When Redis is unreachable (compose hostname / no local broker), inject a noop lock
    # so we still exercise pending→evaluate→apply / sweep-expired against live APIs.
    class _NoopLock:
        def acquire(self, *args, **kwargs):
            return True

        def release(self):
            return None

    noop = _NoopLock()
    outcomes = reconcile_outcomes_mile({}, lock=noop)
    snooze = sweep_expired_snoozes({}, lock=noop)
    print(json.dumps({"event": "probe_ok", "mode": "sync", "outcomes": outcomes, "snooze": snooze}))
    if outcomes.get("status") not in {"success", "skipped"}:
        return 1
    if snooze.get("status") not in {"success", "skipped"}:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
