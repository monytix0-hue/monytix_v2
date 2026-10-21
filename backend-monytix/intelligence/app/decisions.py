"""Stateless D1-D30 ranking for PROMOTE ledger rows. Does not open Postgres."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DecisionEvaluationRequest(BaseModel):
    owner_id: str
    transaction: dict[str, Any]
    user_weights: dict[str, float] = Field(default_factory=dict)


FAMILIES: dict[str, dict[str, Any]] = {
    "D1": {
        "name": "Emergency Fund Allocation",
        "group": "SAFETY",
        "primary_weights": {"W09_RESILIENCE": 1.0, "W03_RISK": 0.8},
        "requires_low_resilience": True,
    },
    "D2": {
        "name": "Cash Buffer Top-Up",
        "group": "SAFETY",
        "primary_weights": {"W09_RESILIENCE": 0.9, "W01_TIME": 0.5},
        "requires_low_resilience": False,
    },
    "D10": {
        "name": "Expense Spike Review",
        "group": "CASHFLOW",
        "primary_weights": {"W02_COMFORT": 0.9, "W08_ATTENTION": 0.7},
        "requires_low_resilience": False,
    },
    "D13": {
        "name": "Savings Rate Lift",
        "group": "SAVINGS",
        "primary_weights": {"W09_RESILIENCE": 1.0, "W07_OPPORTUNITY": 0.9},
        "requires_low_resilience": False,
    },
}

_OPTIONS = [
    {"id": "OPT_1", "label": "Weigh trade-off", "action": "CONSIDER"},
    {"id": "OPT_2", "label": "Offset with mission reserve", "action": "OFFSET"},
    {"id": "OPT_3", "label": "Acknowledge & continue", "action": "DISMISS"},
]


def evaluate_decision_candidates(req: DecisionEvaluationRequest) -> list[dict[str, Any]]:
    txn = req.transaction or {}
    weights = req.user_weights or {}
    flow = str(txn.get("flow") or "")
    amount = float(txn.get("amount") or 0)
    if flow != "OUT" or amount < 15000:
        return []

    candidates: list[dict[str, Any]] = []
    for code, family in FAMILIES.items():
        if family["requires_low_resilience"] and float(weights.get("W09_RESILIENCE", 0.5)) >= 0.6:
            continue
        base_fit = 0.0
        for weight_code, relevance in family["primary_weights"].items():
            base_fit += float(weights.get(weight_code, 0.5)) * float(relevance)
        urgency = 1.3 if amount >= 50000 else 1.1
        confidence = 0.95
        context_modifier = 1.2 if float(weights.get("W02_COMFORT", 0)) > 0.7 else 1.0
        score = base_fit * urgency * confidence * context_modifier
        if score >= 2.0:
            band = "CRITICAL"
        elif score >= 1.4:
            band = "HIGH"
        else:
            band = "MODERATE"
        candidates.append({
            "decision_family_code": code,
            "display_name": family["name"],
            "decision_group": family["group"],
            "base_weight_fit": round(base_fit, 4),
            "urgency_multiplier": urgency,
            "confidence_multiplier": confidence,
            "context_modifier": context_modifier,
            "decision_score": round(score, 4),
            "priority_band": band,
            "trigger_summary": {
                "source_transaction_id": txn.get("id") or txn.get("transaction_id"),
                "amount": amount,
                "clean_merchant": txn.get("clean_merchant") or "Unknown",
            },
            "option_set": list(_OPTIONS),
        })
    candidates.sort(key=lambda item: item["decision_score"], reverse=True)
    return candidates
