"""Celery parse tasks. They never open Postgres."""

from __future__ import annotations

import json
import os
import time
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any, Callable

from app.aa.crypto import decrypt_rebit_payload
from app.normalize.route import NormalizeError, detect_domain, normalize_record

QUEUES = ("intake", "cash", "holdings", "obligations", "reconciliation", "context", "decisions")
QUEUE_FOR_DOMAIN = {
    "LEDGER": "cash",
    "MUTUAL_FUND": "holdings",
    "INVESTMENT": "holdings",
    "ASSET": "holdings",
    "DUE_DATE": "obligations",
    "DEBT": "obligations",
    "INSURANCE": "obligations",
}
AA_DOMAIN = {
    "DEPOSIT": "LEDGER",
    "MUTUAL_FUNDS": "MUTUAL_FUND",
    "INSURANCE": "INSURANCE",
    "TERM_DEPOSIT": "ASSET",
    "CREDIT": "DEBT",
}
TASK_NAMES = {
    "intake.record": "app.tasks.intake_record",
    "gmail.history": "app.tasks.gmail_history",
    "gmail.backfill": "app.tasks.gmail_backfill",
    "gmail.renew": "app.tasks.renew_gmail_watch",
    "fx.fetch": "app.tasks.fetch_fx_rates",
    "normalize.domain": "app.tasks.normalize_domain",
    "finance.reconcile": "app.tasks.reconcile_forex_fees",
    "human.evaluate": "app.tasks.evaluate_human_context",
    "decision.evaluate": "app.tasks.evaluate_decision_candidates",
    "outcomes.reconcile": "app.tasks.reconcile_outcomes_mile",
    "decision.sweep_expired_snoozes": "app.tasks.sweep_expired_snoozes",
}
ECB_DAILY = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
ECB_NS = {"e": "http://www.ecb.int/vocabulary/2002-08-01/eurofxref"}
Sender = Callable[[str, dict, str], None]


def enqueue_task(task: str, queue: str, payload: dict, sender: Sender | None = None) -> str:
    if queue not in QUEUES:
        raise ValueError("unknown_queue")
    name = TASK_NAMES.get(task)
    if name is None:
        raise ValueError("unknown_task")
    if sender is not None:
        sender(name, payload, queue)
        return "local"
    from app.celery_app import celery

    result = celery.send_task(name, args=[payload], queue=queue)
    return str(result.id)


def prepare_record(record: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    payload = dict(record.get("payload") or {})
    if record.get("source") == "ACCOUNT_AGGREGATOR":
        if not isinstance(payload.get("decrypted_fi"), dict):
            private = _private_key()
            if private is None:
                raise NormalizeError("fiu_key_missing")
            nonce = _b64(payload["our_nonce"]) if payload.get("our_nonce") else None
            payload["decrypted_fi"] = decrypt_rebit_payload(payload["encrypted_fi"], private, nonce)
            record = {**record, "payload": payload}
        domain = AA_DOMAIN.get(str(payload.get("fi_type") or ""))
        if domain is None:
            raise NormalizeError("unrecognized_domain")
        return domain, record
    domain = detect_domain(str(payload.get("raw_text") or ""))
    if domain not in QUEUE_FOR_DOMAIN:
        raise NormalizeError("unrecognized_domain")
    return domain, record


def intake_record(payload: dict, sender: Sender | None = None) -> str:
    domain, record = prepare_record(payload["record"])
    queue = QUEUE_FOR_DOMAIN[domain]
    enqueue_task("normalize.domain", queue, {"record": record}, sender=sender)
    return queue


def normalize_domain(payload: dict) -> str:
    record = payload["record"]
    normalized = normalize_record(record, fiu_private_key=_private_key())
    post_finance("/v1/internal/apply", {"record": record, "normalized": normalized}, timeout=300)
    return str(normalized["domain"])


def gmail_history(payload: dict, sender: Sender | None = None) -> int:
    messages, history_id = fetch_history(payload["access_token"], payload["history_id"])
    stored = _store_messages(payload["owner_id"], messages, sender)
    if history_id and history_id != str(payload.get("history_id") or ""):
        post_finance(
            "/v1/internal/gmail/checkpoint",
            {"owner_id": payload["owner_id"], "history_id": history_id},
        )
    return stored


def gmail_backfill(payload: dict, sender: Sender | None = None) -> int:
    after = int(time.time()) - 365 * 24 * 60 * 60
    messages = fetch_list(payload["access_token"], f"after:{after}")
    return _store_messages(payload["owner_id"], messages, sender)


def renew_gmail_watch(payload: dict | None = None) -> dict:
    del payload
    return post_finance("/v1/internal/gmail/renew", {})


def fetch_fx_rates(payload: dict | None = None, xml_text: str | None = None) -> dict:
    del payload
    body = xml_text if xml_text is not None else urllib.request.urlopen(ECB_DAILY, timeout=15).read().decode("utf8")
    return post_finance("/v1/internal/fx", parse_ecb_daily(body))


def parse_ecb_daily(xml_text: str) -> dict[str, Any]:
    root = ET.fromstring(xml_text)
    dated = root.find(".//e:Cube[@time]", ECB_NS)
    if dated is None or not dated.get("time"):
        raise ValueError("fx_feed_invalid")
    rates = []
    for cube in dated.findall("e:Cube", ECB_NS):
        currency = cube.get("currency")
        rate = cube.get("rate")
        if currency and rate:
            rates.append({"quote_code": currency, "rate": rate})
    if not rates:
        raise ValueError("fx_feed_invalid")
    return {"rate_date": dated.get("time"), "rates": rates}


def post_finance(path: str, payload: dict, timeout: int = 30) -> dict:
    return _post(os.environ.get("FINANCE_API_URL", "http://127.0.0.1:8090"), path, payload, timeout)


def post_intelligence(path: str, payload: dict, timeout: int = 30) -> dict:
    return _post(os.environ.get("INTELLIGENCE_URL", "http://127.0.0.1:8091"), path, payload, timeout)


def _post(base: str, path: str, payload: dict, timeout: int) -> dict:
    token = os.environ.get("INTERNAL_TOKEN", "")
    request = urllib.request.Request(
        f"{base.rstrip('/')}{path}",
        data=json.dumps(payload).encode("utf8"),
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf8"))


def fetch_history(access_token: str, start_history_id: str) -> tuple[list[dict[str, str]], str | None]:
    ids: list[str] = []
    page_token: str | None = None
    latest_history_id: str | None = None
    while True:
        url = (
            "https://gmail.googleapis.com/gmail/v1/users/me/history"
            f"?startHistoryId={urllib.request.quote(str(start_history_id))}"
            "&historyTypes=messageAdded"
        )
        if page_token:
            url = f"{url}&pageToken={urllib.request.quote(page_token)}"
        page = _gmail_json(access_token, url)
        if isinstance(page.get("historyId"), (str, int)):
            latest_history_id = str(page["historyId"])
        for item in page.get("history") or []:
            for added in item.get("messagesAdded") or []:
                message_id = (added.get("message") or {}).get("id")
                if isinstance(message_id, str):
                    ids.append(message_id)
        page_token = page.get("nextPageToken")
        if not page_token:
            break
    return [_message(access_token, message_id) for message_id in ids], latest_history_id


def fetch_list(access_token: str, query: str) -> list[dict[str, str]]:
    ids: list[str] = []
    page_token: str | None = None
    while True:
        url = (
            "https://gmail.googleapis.com/gmail/v1/users/me/messages"
            f"?q={urllib.request.quote(query)}&maxResults=100"
        )
        if page_token:
            url = f"{url}&pageToken={urllib.request.quote(page_token)}"
        page = _gmail_json(access_token, url)
        for item in page.get("messages") or []:
            message_id = item.get("id")
            if isinstance(message_id, str):
                ids.append(message_id)
        page_token = page.get("nextPageToken")
        if not page_token:
            break
    return [_message(access_token, message_id) for message_id in ids]


def reconcile_forex_fees(payload: dict | None = None, poster: Callable[[str, dict], dict] | None = None, lock: Any | None = None) -> dict:
    body = payload or {}
    owner_id = body.get("owner_id") or None
    held = lock if lock is not None else _forex_lock(owner_id)
    if not held.acquire(blocking=True, blocking_timeout=5):
        return {"status": "skipped", "reason": "locked"}
    try:
        request = {} if owner_id is None else {"owner_id": owner_id}
        result = (poster or post_finance)("/v1/internal/forex/reconcile", request)
        return {"status": "success", "owner_id": owner_id, "linked": int(result.get("linked") or 0)}
    finally:
        release = getattr(held, "release", None)
        if release is not None:
            try:
                release()
            except Exception:
                pass


def evaluate_human_context(
    payload: dict | None = None,
    poster: Callable[[str, dict], dict] | None = None,
    evaluator: Callable[[str, dict], dict] | None = None,
    lock: Any | None = None,
) -> dict:
    owner_id = (payload or {}).get("owner_id") or None
    if not owner_id:
        return {"status": "skipped", "reason": "owner_missing"}
    held = lock if lock is not None else _human_lock(str(owner_id))
    if not held.acquire(blocking=True, blocking_timeout=5):
        return {"status": "skipped", "reason": "locked"}
    try:
        finance = poster or post_finance
        score = evaluator or post_intelligence
        pending = finance("/v1/internal/human/pending", {"owner_id": owner_id})
        evaluated = 0
        for fact in pending.get("transactions") or []:
            scored = score("/internal/evaluate-weights", fact)
            finance("/v1/internal/apply-human-context", scored)
            evaluated += 1
        return {"status": "success", "owner_id": owner_id, "evaluated": evaluated}
    finally:
        release = getattr(held, "release", None)
        if release is not None:
            try:
                release()
            except Exception:
                pass


def evaluate_decision_candidates(
    payload: dict | None = None,
    poster: Callable[[str, dict], dict] | None = None,
    evaluator: Callable[[str, dict], dict | list] | None = None,
    lock: Any | None = None,
) -> dict:
    body = payload or {}
    owner_id = body.get("owner_id") or None
    transaction_id = body.get("transaction_id") or None
    if not owner_id or not transaction_id:
        return {"status": "skipped", "reason": "payload_missing"}
    held = lock if lock is not None else _decision_lock(str(owner_id))
    if not held.acquire(blocking=True, blocking_timeout=5):
        return {"status": "skipped", "reason": "locked"}
    try:
        finance = poster or post_finance
        score = evaluator or post_intelligence
        context = finance("/v1/internal/decision-eval-context", {"transaction_id": transaction_id})
        ranked = score("/internal/evaluate-decisions", {
            "owner_id": owner_id,
            "transaction": context.get("transaction") or {},
            "user_weights": context.get("user_weights") or {},
        })
        candidates = ranked if isinstance(ranked, list) else []
        if not candidates:
            return {"status": "success", "candidates_generated": 0}
        top = candidates[0]
        finance("/v1/internal/apply-decision-evaluation", {
            "owner_id": owner_id,
            "transaction_id": transaction_id,
            "top_candidate": top,
            "evaluation_meta": {
                "all_evaluated_count": len(candidates),
                "idempotency_key": f"dec_eval:{transaction_id}:{top['decision_family_code']}",
            },
        })
        return {
            "status": "success",
            "candidates_generated": len(candidates),
            "decision_family": top["decision_family_code"],
            "fps_score": top["decision_score"],
        }
    finally:
        release = getattr(held, "release", None)
        if release is not None:
            try:
                release()
            except Exception:
                pass


def sweep_expired_snoozes(
    payload: dict | None = None,
    poster: Callable[[str, dict], dict] | None = None,
    lock: Any | None = None,
) -> dict:
    body = payload or {}
    owner_id = body.get("owner_id") if body.get("owner_id") is not None else None
    lock_name = str(owner_id) if owner_id else "global"
    held = lock if lock is not None else _decision_lock(f"sweep:{lock_name}")
    if not held.acquire(blocking=True, blocking_timeout=5):
        return {"status": "skipped", "reason": "locked"}
    try:
        finance = poster or post_finance
        result = finance("/v1/internal/decisions/sweep-expired", {"owner_id": owner_id})
        return {"status": "success", "swept": int(result.get("swept") or 0)}
    finally:
        release = getattr(held, "release", None)
        if release is not None:
            try:
                release()
            except Exception:
                pass


def reconcile_outcomes_mile(
    payload: dict | None = None,
    poster: Callable[[str, dict], dict] | None = None,
    evaluator: Callable[[str, dict], dict] | None = None,
    lock: Any | None = None,
) -> dict:
    body = payload or {}
    owner_id = body.get("owner_id") if body.get("owner_id") is not None else None
    # Global sweep uses a single lock; owner-scoped uses per-owner lock.
    lock_name = str(owner_id) if owner_id else "global"
    held = lock if lock is not None else _outcomes_lock(lock_name)
    if not held.acquire(blocking=True, blocking_timeout=5):
        return {"status": "skipped", "reason": "locked"}
    try:
        finance = poster or post_finance
        score = evaluator or post_intelligence
        pending = finance("/v1/internal/outcomes/pending", {"owner_id": owner_id})
        matches = pending.get("matches") or []
        processed = 0
        for match in matches:
            package = score("/internal/evaluate-outcome-mile", match)
            finance("/v1/internal/apply-outcomes-mile", {
                "owner_id": match.get("owner_id") or owner_id,
                "transaction_id": (match.get("transaction") or {}).get("id"),
                "package": package,
            })
            processed += 1
        return {"status": "success", "processed_matches": processed}
    finally:
        release = getattr(held, "release", None)
        if release is not None:
            try:
                release()
            except Exception:
                pass


def _human_lock(owner_id: str) -> Any:
    import redis

    client = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0"))
    return client.lock(f"lock:human_eval:owner:{owner_id}", timeout=120, blocking_timeout=5)


def _outcomes_lock(owner_id: str) -> Any:
    import redis

    client = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0"))
    return client.lock(f"lock:outcomes_mile:owner:{owner_id}", timeout=120, blocking_timeout=5)


def _decision_lock(owner_id: str) -> Any:
    import redis

    client = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0"))
    return client.lock(f"lock:decision_eval:owner:{owner_id}", timeout=120, blocking_timeout=5)


def _forex_lock(owner_id: str | None) -> Any:
    import redis

    client = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0"))
    name = f"lock:forex_recon:owner:{owner_id}" if owner_id else "lock:forex_recon:global"
    return client.lock(name, timeout=120, blocking_timeout=5)


def register(celery: Any) -> None:
    celery.task(name="app.tasks.intake_record")(intake_record)
    celery.task(name="app.tasks.gmail_history")(gmail_history)
    celery.task(name="app.tasks.gmail_backfill")(gmail_backfill)
    celery.task(name="app.tasks.renew_gmail_watch")(renew_gmail_watch)
    celery.task(name="app.tasks.fetch_fx_rates")(fetch_fx_rates)
    celery.task(name="app.tasks.normalize_domain")(normalize_domain)
    celery.task(
        name="app.tasks.reconcile_forex_fees",
        autoretry_for=(OSError, TimeoutError),
        retry_kwargs={"max_retries": 3, "countdown": 60},
        acks_late=True,
    )(reconcile_forex_fees)
    celery.task(
        name="app.tasks.evaluate_human_context",
        autoretry_for=(OSError, TimeoutError),
        retry_kwargs={"max_retries": 3, "countdown": 60},
        acks_late=True,
    )(evaluate_human_context)
    celery.task(
        name="app.tasks.evaluate_decision_candidates",
        autoretry_for=(OSError, TimeoutError),
        retry_kwargs={"max_retries": 3, "countdown": 60},
        acks_late=True,
    )(evaluate_decision_candidates)
    celery.task(
        name="app.tasks.reconcile_outcomes_mile",
        autoretry_for=(OSError, TimeoutError),
        retry_kwargs={"max_retries": 3, "countdown": 60},
        acks_late=True,
    )(reconcile_outcomes_mile)
    celery.task(
        name="app.tasks.sweep_expired_snoozes",
        autoretry_for=(OSError, TimeoutError),
        retry_kwargs={"max_retries": 3, "countdown": 60},
        acks_late=True,
    )(sweep_expired_snoozes)


def _store_messages(owner_id: str, messages: list[dict[str, str]], sender: Sender | None) -> int:
    stored = 0
    for message in messages:
        record = {
            "owner_id": owner_id,
            "source": "GMAIL",
            "channel_type": "SPOT_ALERT",
            "payload": {"raw_text": message["text"], "mime_headers": {"subject": message["subject"]}, "storage_ref": None},
            "idempotency_key": f"gmail_msg_{message['id']}",
        }
        try:
            domain, prepared = prepare_record(record)
        except NormalizeError:
            post_finance("/v1/internal/ingest", record)
            continue
        saved = post_finance("/v1/internal/ingest", record)
        if saved.get("inserted"):
            prepared["_id"] = saved["record"]["_id"]
            enqueue_task("normalize.domain", QUEUE_FOR_DOMAIN[domain], {"record": prepared}, sender=sender)
            stored += 1
    return stored


def _message(access_token: str, message_id: str) -> dict[str, str]:
    from app.gmail_body import extract_message_text

    detail = _gmail_json(access_token, f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}?format=full")
    headers = (detail.get("payload") or {}).get("headers") or []
    subject = next((header.get("value", "") for header in headers if str(header.get("name", "")).lower() == "subject"), "")
    text = extract_message_text(detail.get("payload"), snippet=str(detail.get("snippet") or ""), subject=subject)
    return {"id": message_id, "text": text, "subject": subject}


def _gmail_json(access_token: str, url: str) -> dict:
    request = urllib.request.Request(url, headers={"authorization": f"Bearer {access_token}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf8"))


def _private_key() -> bytes | None:
    raw = os.environ.get("AA_FIU_PRIVATE_KEY", "").strip()
    if not raw:
        return None
    return _b64(raw)


def _b64(value: str) -> bytes:
    import base64

    return base64.b64decode(value)
