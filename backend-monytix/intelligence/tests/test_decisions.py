from app.decisions import DecisionEvaluationRequest, evaluate_decision_candidates


def test_large_amazon_outflow_ranks_candidates():
    ranked = evaluate_decision_candidates(
        DecisionEvaluationRequest(
            owner_id="owner-1",
            transaction={
                "id": "txn-amazon",
                "amount": 15000,
                "flow": "OUT",
                "clean_merchant": "Amazon",
            },
            user_weights={"W02_COMFORT": 0.8, "W09_RESILIENCE": 0.4, "W08_ATTENTION": 0.7},
        )
    )
    assert ranked
    assert ranked[0]["decision_family_code"] in {"D1", "D2", "D10", "D13"}
    assert ranked[0]["decision_score"] >= ranked[-1]["decision_score"]
    assert all(item["priority_band"] in {"MODERATE", "HIGH", "CRITICAL"} for item in ranked)


def test_small_swiggy_outflow_produces_no_candidates():
    ranked = evaluate_decision_candidates(
        DecisionEvaluationRequest(
            owner_id="owner-1",
            transaction={"id": "txn-swiggy", "amount": 350, "flow": "OUT", "clean_merchant": "Swiggy"},
            user_weights={"W02_COMFORT": 1.0},
        )
    )
    assert ranked == []
