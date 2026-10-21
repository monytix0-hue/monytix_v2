from app.tasks import (
    QUEUE_FOR_DOMAIN,
    enqueue_task,
    evaluate_decision_candidates,
    evaluate_human_context,
    intake_record,
    parse_ecb_daily,
    prepare_record,
    reconcile_forex_fees,
    reconcile_outcomes_mile,
    sweep_expired_snoozes,
)


def test_upi_alert_goes_to_cash():
    sent = []
    queue = intake_record(
        {"record": {"source": "GMAIL", "payload": {"raw_text": "debited Rs 350 via UPI/SWIGGY"}}},
        sender=lambda name, payload, queue_name: sent.append((name, queue_name, payload["record"]["source"])),
    )
    assert queue == "cash"
    assert sent == [("app.tasks.normalize_domain", "cash", "GMAIL")]


def test_due_date_goes_to_obligations_and_cas_to_holdings():
    assert QUEUE_FOR_DOMAIN["DUE_DATE"] == "obligations"
    domain, _record = prepare_record({"source": "PDF_UPLOAD", "payload": {"raw_text": "CAMS FOLIO 123 SCHEME Flexi UNITS 10"}})
    assert domain == "MUTUAL_FUND"
    assert QUEUE_FOR_DOMAIN[domain] == "holdings"


def test_enqueue_rejects_unknown_queue():
    try:
        enqueue_task("intake.record", "kafka", {}, sender=lambda *_args: None)
    except ValueError as error:
        assert str(error) == "unknown_queue"
    else:
        raise AssertionError("expected unknown_queue")


class _Lock:
    def __init__(self, acquired: bool) -> None:
        self.acquired = acquired
        self.released = False

    def acquire(self, blocking: bool = True, blocking_timeout: int = 5) -> bool:
        del blocking, blocking_timeout
        return self.acquired

    def release(self) -> None:
        self.released = True


def test_reconcile_posts_when_the_lock_is_free():
    calls = []

    def poster(path: str, body: dict) -> dict:
        calls.append((path, body))
        return {"linked": 2}

    lock = _Lock(True)
    result = reconcile_forex_fees({"owner_id": "owner-1"}, poster=poster, lock=lock)
    assert result == {"status": "success", "owner_id": "owner-1", "linked": 2}
    assert calls == [("/v1/internal/forex/reconcile", {"owner_id": "owner-1"})]
    assert lock.released is True


def test_human_evaluation_posts_when_the_lock_is_free():
    calls = []
    fact = {
        "transaction_id": "txn-1",
        "owner_id": "owner-1",
        "amount": 350,
        "flow": "OUT",
        "channel": "UPI",
        "clean_merchant": "Swiggy",
        "category_id": "FOOD_DINING",
        "subcategory_id": "FOOD_DELIVERY",
        "fee_role": "BASE",
    }
    scored = {"transaction_id": "txn-1", "owner_id": "owner-1", "eligibility": {"state": "WEIGHT", "reason_code": "DISCRETIONARY_CANDIDATE"}, "weight_associations": []}

    def poster(path: str, body: dict) -> dict:
        calls.append((path, body))
        if path == "/v1/internal/human/pending":
            return {"transactions": [fact]}
        return {"status": "APPLIED"}

    def evaluator(path: str, body: dict) -> dict:
        calls.append((path, body))
        return scored

    lock = _Lock(True)
    result = evaluate_human_context({"owner_id": "owner-1"}, poster=poster, evaluator=evaluator, lock=lock)
    assert result == {"status": "success", "owner_id": "owner-1", "evaluated": 1}
    assert calls == [
        ("/v1/internal/human/pending", {"owner_id": "owner-1"}),
        ("/internal/evaluate-weights", fact),
        ("/v1/internal/apply-human-context", scored),
    ]
    assert lock.released is True


def test_decision_evaluation_posts_when_the_lock_is_free():
    calls = []
    context = {
        "transaction": {"id": "txn-1", "amount": 15000, "flow": "OUT", "clean_merchant": "Amazon"},
        "user_weights": {"W02_COMFORT": 0.8, "W09_RESILIENCE": 0.4},
    }
    ranked = [{"decision_family_code": "D10", "decision_score": 1.8, "display_name": "Expense Spike Review"}]

    def poster(path: str, body: dict) -> dict:
        calls.append((path, body))
        if path == "/v1/internal/decision-eval-context":
            return context
        return {"status": "DECISION_COMMITTED"}

    def evaluator(path: str, body: dict):
        calls.append((path, body))
        return ranked

    lock = _Lock(True)
    result = evaluate_decision_candidates(
        {"owner_id": "owner-1", "transaction_id": "txn-1"},
        poster=poster,
        evaluator=evaluator,
        lock=lock,
    )
    assert result["status"] == "success"
    assert result["candidates_generated"] == 1
    assert result["decision_family"] == "D10"
    assert calls[0][0] == "/v1/internal/decision-eval-context"
    assert calls[1][0] == "/internal/evaluate-decisions"
    assert calls[2][0] == "/v1/internal/apply-decision-evaluation"
    assert lock.released is True


def test_decision_evaluation_skips_when_the_lock_is_held():
    result = evaluate_decision_candidates(
        {"owner_id": "owner-1", "transaction_id": "txn-1"},
        poster=lambda *_args: {},
        lock=_Lock(False),
    )
    assert result == {"status": "skipped", "reason": "locked"}


def test_outcomes_reconcile_posts_when_the_lock_is_free():
    calls = []
    match = {
        "owner_id": "owner-1",
        "transaction": {"id": "txn-1", "amount": 5000},
        "active_mission": {"mission_id": "msn-1", "canonical_mission_code": "M01"},
        "linked_decision": {},
    }

    def poster(path: str, body: dict) -> dict:
        calls.append((path, body))
        if path == "/v1/internal/outcomes/pending":
            return {"matches": [match]}
        return {"status": "APPLIED"}

    def evaluator(path: str, body: dict) -> dict:
        calls.append((path, body))
        return {"outcome": {"idempotency_key": "fo:1"}, "mile_event": {"dedupe_key": "mile:1"}, "attribution": {}, "impact": {}}

    result = reconcile_outcomes_mile({"owner_id": "owner-1"}, poster=poster, evaluator=evaluator, lock=_Lock(True))
    assert result == {"status": "success", "processed_matches": 1}
    assert calls[0][0] == "/v1/internal/outcomes/pending"
    assert calls[1][0] == "/internal/evaluate-outcome-mile"
    assert calls[2][0] == "/v1/internal/apply-outcomes-mile"


def test_outcomes_reconcile_skips_when_the_lock_is_held():
    result = reconcile_outcomes_mile({"owner_id": "owner-1"}, poster=lambda *_a: {}, lock=_Lock(False))
    assert result == {"status": "skipped", "reason": "locked"}


def test_sweep_expired_snoozes_posts_to_finance():
    calls = []

    def poster(path: str, body: dict) -> dict:
        calls.append((path, body))
        return {"swept": 2}

    result = sweep_expired_snoozes({"owner_id": None}, poster=poster, lock=_Lock(True))
    assert result == {"status": "success", "swept": 2}
    assert calls == [("/v1/internal/decisions/sweep-expired", {"owner_id": None})]


def test_sweep_expired_snoozes_skips_when_locked():
    result = sweep_expired_snoozes(None, poster=lambda *_a: {"swept": 9}, lock=_Lock(False))
    assert result == {"status": "skipped", "reason": "locked"}


def test_reconcile_skips_when_the_lock_is_held():
    result = reconcile_forex_fees(None, poster=lambda *_args: {"linked": 1}, lock=_Lock(False))
    assert result == {"status": "skipped", "reason": "locked"}


def test_ecb_daily_xml_parses_quote_rates():
    xml = """<?xml version="1.0"?>
    <gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
      <Cube><Cube time="2026-10-16">
        <Cube currency="USD" rate="1.0830"/>
        <Cube currency="INR" rate="90.1200"/>
      </Cube></Cube>
    </gesmes:Envelope>"""
    parsed = parse_ecb_daily(xml)
    assert parsed["rate_date"] == "2026-10-16"
    assert parsed["rates"][0] == {"quote_code": "USD", "rate": "1.0830"}
