"""Stateless outcome + M.I.L.E. scoring. Does not open Postgres."""

from __future__ import annotations

import math
from typing import Any

from pydantic import BaseModel, Field

FAMILY_BASE = {
    "MP": 12.0,
    "MS": 10.0,
    "DR": 15.0,
    "WB": 12.0,
    "GF": 12.0,
    "FC": 15.0,
}


class OutcomeEvaluationInput(BaseModel):
    owner_id: str
    transaction: dict[str, Any]
    active_mission: dict[str, Any]
    linked_decision: dict[str, Any] = Field(default_factory=dict)


def evaluate_outcome_mile(req: OutcomeEvaluationInput) -> dict[str, Any]:
    txn = req.transaction or {}
    mission = req.active_mission or {}
    decision = req.linked_decision or {}
    amount = float(txn.get("amount") or 0)
    code = str(mission.get("canonical_mission_code") or "")
    txn_id = str(txn.get("id") or txn.get("transaction_id") or "")
    mission_id = str(mission.get("mission_id") or "")

    if code in {"M01", "M02", "M06"}:
        family, impact_type = "MP", "GOAL_FUNDED"
    elif code == "M30":
        family, impact_type = "MS", "SAVED"
    else:
        family, impact_type = "WB", "WEALTH_CONTRIBUTION"

    # Auto-matched ledger rows are A3. SELECTED alone does not mint MILE.
    attribution_level = "A3"
    attribution_factor = 0.5
    base_value = FAMILY_BASE.get(family, 10.0)
    magnitude_factor = min(math.sqrt(max(amount, 0) / 100.0), 5.0)
    significance_factor = 1.2 if amount >= 10000 else 1.0
    confidence_factor = 1.0
    mile_awarded = round(base_value * magnitude_factor * significance_factor * attribution_factor * confidence_factor, 2)

    return {
        "outcome": {
            "outcome_family_code": family,
            "outcome_type": "ECONOMIC_OUTCOME",
            "decision_id": decision.get("decision_id"),
            "mission_id": mission_id or None,
            "observed_amount": amount,
            "currency": txn.get("currency_code") or "INR",
            "verification_status": "A3_ASSOCIATED",
            "outcome_status": "FINALIZED",
            "economic_event_key": f"outcome:{txn_id}:{mission_id}",
            "idempotency_key": f"fo:{txn_id}:{mission_id}",
            "observed_at": txn.get("posted_at"),
            "reason_codes": [f"MISSION_MATCH_{code or 'UNKNOWN'}"],
        },
        "attribution": {
            "attribution_level": attribution_level,
            "attribution_factor": attribution_factor,
            "decision_id": decision.get("decision_id"),
            "mission_id": mission_id or None,
            "reason_codes": [f"MISSION_MATCH_{code or 'UNKNOWN'}"],
        },
        "impact": {
            "outcome_family_code": family,
            "impact_type": impact_type,
            "impact_basis": "ACTUAL",
            "amount": amount,
            "currency": txn.get("currency_code") or "INR",
            "attribution_level": attribution_level,
            "attribution_factor": attribution_factor,
            "economic_impact_key": f"impact:{txn_id}:{impact_type}",
            "status": "FINALIZED",
        },
        "mile_event": {
            "event_type": "OUTCOME",
            "outcome_family_code": family,
            "attribution_level": attribution_level,
            "base_value": base_value,
            "magnitude_factor": round(magnitude_factor, 4),
            "significance_factor": significance_factor,
            "confidence_factor": confidence_factor,
            "mile_awarded": mile_awarded,
            "status": "FINALIZED",
            "dedupe_key": f"mile:{txn_id}:{mission_id}",
            "economic_event_key": f"outcome:{txn_id}:{mission_id}",
            "occurred_at": txn.get("posted_at"),
            "decision_id": decision.get("decision_id"),
            "mission_id": mission_id or None,
        },
    }
