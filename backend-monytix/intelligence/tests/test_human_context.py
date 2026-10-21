from app.human_context import TransactionEvaluationInput, run_human_context_pipeline


def evaluate(**fields):
    payload = {
        "transaction_id": "txn-1",
        "owner_id": "owner-1",
        "amount": 100.0,
        "flow": "OUT",
        "channel": "UPI",
        "clean_merchant": "Shop",
        "category_id": "OTHER_MERCHANT",
        "subcategory_id": None,
        "fee_role": "BASE",
    }
    payload.update(fields)
    return run_human_context_pipeline(TransactionEvaluationInput(**payload))


def test_bank_fee_is_ignored():
    result = evaluate(category_id="BANK_FEES", subcategory_id="FOREX_MARKUP", fee_role="FCY_MARKUP", clean_merchant="Foreign Exchange Fee")
    assert result["eligibility"]["state"] == "IGNORE"
    assert result["eligibility"]["reason_code"] == "SYSTEM_FEE_OR_TAX"
    assert result["inference_run"] is None
    assert result["weight_associations"] == []


def test_own_account_channel_is_ignored():
    result = evaluate(channel="OWN_ACCOUNT_TRANSFER", category_id="TRANSFER", subcategory_id="PEER_TO_PEER")
    assert result["eligibility"]["state"] == "IGNORE"
    assert result["eligibility"]["reason_code"] == "INTERNAL_TRANSFER_EXCLUDED"
    assert result["weight_associations"] == []


def test_large_outflow_is_promoted_and_still_weighted():
    result = evaluate(amount=15000, clean_merchant="Amazon", category_id="SHOPPING_RETAIL", subcategory_id="ECOMMERCE")
    assert result["eligibility"]["state"] == "PROMOTE"
    assert result["eligibility"]["reason_code"] == "HIGH_MAGNITUDE_OUTFLOW"
    assert result["inference_run"]["primary_inferred_weight"] == "W02_COMFORT"
    assert result["inference_run"]["model_version"] == "f10_rulebook_v1.2"
    assert [item["weight_code"] for item in result["weight_associations"]] == ["W02_COMFORT"]


def test_small_swiggy_row_is_comfort_and_attention():
    result = evaluate(amount=350, clean_merchant="Swiggy", category_id="FOOD_DINING", subcategory_id="FOOD_DELIVERY")
    assert result["eligibility"]["state"] == "WEIGHT"
    codes = [(item["weight_code"], item["is_primary"], item["intensity"]) for item in result["weight_associations"]]
    assert codes == [("W02_COMFORT", True, 1.0), ("W08_ATTENTION", False, 0.6)]


def test_peer_transfer_is_only_relationships():
    result = evaluate(clean_merchant="Rahul Sharma", category_id="TRANSFER", subcategory_id="PEER_TO_PEER", flow="IN")
    assert result["eligibility"]["state"] == "WEIGHT"
    assert [item["weight_code"] for item in result["weight_associations"]] == ["W06_RELATIONSHIPS"]
