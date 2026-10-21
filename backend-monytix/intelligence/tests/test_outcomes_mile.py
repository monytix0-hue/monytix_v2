"""D10-7 math and attribution contracts for the adapted A3 auto-match scorer."""

from app.outcomes_mile import OutcomeEvaluationInput, evaluate_outcome_mile


def _payload(**overrides):
    base = {
        "owner_id": "44444444-4444-4444-a444-444444444444",
        "transaction": {
            "id": "11111111-1111-4111-a111-111111111111",
            "amount": 2500.0,
            "flow": "OUT",
            "clean_merchant": "HDFC Liquid Fund",
            "category_id": "FINANCIAL_SERVICES",
            "posted_at": "2026-10-20T10:00:00Z",
            "currency_code": "INR",
        },
        "active_mission": {
            "mission_id": "22222222-2222-4222-a222-222222222222",
            "title": "Build an Emergency Buffer",
            "canonical_mission_code": "M01",
            "target_definition": {"default_target_inr": 250000},
        },
        "linked_decision": {
            "decision_id": "33333333-3333-4333-a333-333333333333",
            "state": "SELECTED",
        },
    }
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key] = {**base[key], **value}
        else:
            base[key] = value
    return base


def test_mile_formula_a3_for_m01_at_exact_magnitude_cap_edge():
    """
    Amount = 2500 → sqrt(2500/100) = 5.0 (at cap edge)
    Base MP = 12.0, significance = 1.0, attribution A3 = 0.5
    Expected MILE = 12 * 5 * 1 * 0.5 * 1 = 30.0
    """
    result = evaluate_outcome_mile(OutcomeEvaluationInput(**_payload()))
    assert result["outcome"]["outcome_family_code"] == "MP"
    assert result["outcome"]["verification_status"] == "A3_ASSOCIATED"
    assert result["outcome"]["observed_amount"] == 2500.0
    assert result["attribution"]["attribution_level"] == "A3"
    assert result["attribution"]["attribution_factor"] == 0.5
    assert result["impact"]["impact_type"] == "GOAL_FUNDED"
    assert result["impact"]["amount"] == 2500.0
    assert result["mile_event"]["base_value"] == 12.0
    assert result["mile_event"]["magnitude_factor"] == 5.0
    assert result["mile_event"]["significance_factor"] == 1.0
    assert result["mile_event"]["mile_awarded"] == 30.0
    assert result["impact"]["economic_impact_key"].startswith("impact:")
    assert result["mile_event"]["dedupe_key"].startswith("mile:")


def test_selected_decision_still_auto_matches_as_a3():
    """Accepting/SELECTED alone does not upgrade to A1; auto-match stays A3."""
    result = evaluate_outcome_mile(
        OutcomeEvaluationInput(**_payload(linked_decision={"state": "SELECTED"}))
    )
    assert result["attribution"]["attribution_level"] == "A3"
    assert result["attribution"]["attribution_factor"] == 0.5
    assert result["outcome"]["verification_status"] == "A3_ASSOCIATED"


def test_candidate_decision_also_stays_a3():
    result = evaluate_outcome_mile(
        OutcomeEvaluationInput(**_payload(linked_decision={"state": "CANDIDATE"}))
    )
    assert result["attribution"]["attribution_level"] == "A3"
    assert result["attribution"]["attribution_factor"] == 0.5
    assert result["mile_event"]["mile_awarded"] == 30.0


def test_magnitude_factor_capped_at_five_with_significance_boost():
    """
    Amount = 1_000_000 → raw sqrt = 100, capped at 5.0
    Significance >= 10000 → 1.2
    Expected MILE = 12 * 5 * 1.2 * 0.5 * 1 = 36.0
    """
    result = evaluate_outcome_mile(
        OutcomeEvaluationInput(**_payload(transaction={"amount": 1_000_000.0}))
    )
    assert result["mile_event"]["magnitude_factor"] == 5.0
    assert result["mile_event"]["significance_factor"] == 1.2
    assert result["mile_event"]["mile_awarded"] == 36.0


def test_m30_dining_maps_to_money_saved():
    result = evaluate_outcome_mile(
        OutcomeEvaluationInput(
            **_payload(
                transaction={"amount": 400, "category_id": "FOOD_DINING", "flow": "OUT"},
                active_mission={
                    "mission_id": "msn-m30",
                    "canonical_mission_code": "M30",
                    "title": "Stop Financial Leakage",
                },
                linked_decision={},
            )
        )
    )
    assert result["outcome"]["outcome_family_code"] == "MS"
    assert result["impact"]["impact_type"] == "SAVED"
    assert result["mile_event"]["base_value"] == 10.0
