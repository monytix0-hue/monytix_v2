"""Stateless F2 eligibility and F3 weight inference. This module does not open Postgres."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class TransactionEvaluationInput(BaseModel):
    transaction_id: str
    owner_id: str
    amount: float
    flow: str
    channel: str
    clean_merchant: str
    category_id: str
    subcategory_id: str | None = None
    fee_role: str | None = "BASE"


class WeightAssignment(BaseModel):
    weight_code: str
    is_primary: bool
    intensity: float = 1.0


def evaluate_f2_eligibility(txn: TransactionEvaluationInput) -> dict[str, Any]:
    fee_role = txn.fee_role or "BASE"
    category = (txn.category_id or "").upper()
    subcategory = (txn.subcategory_id or "").upper()
    if fee_role in ("FCY_MARKUP", "GST_TAX") or category == "BANK_FEES":
        return _eligibility("IGNORE", "SYSTEM_FEE_OR_TAX", {"fee_role": fee_role, "category": category})
    if txn.channel == "OWN_ACCOUNT_TRANSFER" or (category == "TRANSFER" and subcategory == "OWN_ACCOUNT"):
        return _eligibility("IGNORE", "INTERNAL_TRANSFER_EXCLUDED", {"channel": txn.channel})
    if subcategory == "MERCHANT_SETTLEMENT":
        return _eligibility("OBSERVE", "MERCHANT_SETTLEMENT", {"subcategory": subcategory})
    if txn.channel == "ATM" or txn.clean_merchant == "ATM Cash Withdrawal":
        return _eligibility("OBSERVE", "ATM_CASH", {"channel": txn.channel})
    if txn.flow == "IN" and category in ("INCOME", "SALARY"):
        return _eligibility("OBSERVE", "PASS_THROUGH_INCOME", {"flow": txn.flow, "category": category})
    if txn.flow == "OUT" and txn.amount >= 15000:
        return _eligibility("PROMOTE", "HIGH_MAGNITUDE_OUTFLOW", {"amount": txn.amount, "threshold": 15000})
    return _eligibility("WEIGHT", "DISCRETIONARY_CANDIDATE", {"category": category, "subcategory": txn.subcategory_id})


def evaluate_f3_weights(txn: TransactionEvaluationInput) -> tuple[dict[str, Any], list[WeightAssignment]]:
    category = (txn.category_id or "").upper()
    subcategory = (txn.subcategory_id or "").upper()
    primary = "W02_COMFORT"
    secondary: str | None = None
    confidence = 0.60
    rule_id = "R_DEFAULT_COMFORT"
    # Subcategory-specific rules before broad category fallbacks (groceries ≠ comfort takeout).
    if subcategory == "GROCERIES_SUPERMARKET":
        primary, secondary, confidence, rule_id = "W04_OBLIGATIONS", "W02_COMFORT", 0.94, "R_OBLIGATION_GROCERIES"
    elif subcategory in ("FOOD_DELIVERY", "COFFEE_AND_CAFES"):
        primary, secondary, confidence, rule_id = "W02_COMFORT", "W08_ATTENTION", 0.95, "R_COMFORT_DINING"
    elif category == "FOOD_DINING":
        primary, secondary, confidence, rule_id = "W02_COMFORT", "W08_ATTENTION", 0.90, "R_COMFORT_DINING"
    elif subcategory == "TRANSIT_CABS":
        primary, secondary, confidence, rule_id = "W01_TIME", "W02_COMFORT", 0.92, "R_TIME_TRANSIT"
    elif subcategory == "TRANSIT_FUEL" or category == "MOBILITY_TRANSPORT":
        primary, secondary, confidence, rule_id = "W04_OBLIGATIONS", None, 0.90, "R_OBLIGATION_MOBILITY"
    elif subcategory == "SIP_AUTO_DEBIT":
        primary, secondary, confidence, rule_id = "W09_RESILIENCE", "W07_OPPORTUNITY", 0.98, "R_RESILIENCE_INVESTMENT"
    elif subcategory in ("LOAN_EMI", "CREDIT_CARD_BILL"):
        primary, secondary, confidence, rule_id = "W04_OBLIGATIONS", None, 0.96, "R_OBLIGATION_DEBT"
    elif subcategory == "STREAMING_SUBSCRIPTIONS":
        primary, secondary, confidence, rule_id = "W02_COMFORT", None, 0.92, "R_COMFORT_STREAMING"
    elif subcategory == "SOFTWARE_SUBSCRIPTIONS":
        primary, secondary, confidence, rule_id = "W07_OPPORTUNITY", None, 0.90, "R_OPPORTUNITY_SOFTWARE"
    elif category == "TRANSFER" and subcategory == "PEER_TO_PEER":
        primary, secondary, confidence, rule_id = "W06_RELATIONSHIPS", None, 0.80, "R_RELATIONSHIP_P2P"
    inference = {
        "primary_inferred_weight": primary,
        "secondary_inferred_weight": secondary,
        "confidence_score": confidence,
        "rule_id": rule_id,
        "model_version": "f10_rulebook_v1.2",
    }
    assignments = [WeightAssignment(weight_code=primary, is_primary=True, intensity=1.0)]
    if secondary:
        assignments.append(WeightAssignment(weight_code=secondary, is_primary=False, intensity=0.6))
    return inference, assignments


def run_human_context_pipeline(txn: TransactionEvaluationInput) -> dict[str, Any]:
    eligibility = evaluate_f2_eligibility(txn)
    if eligibility["state"] in ("IGNORE", "OBSERVE"):
        return {
            "transaction_id": txn.transaction_id,
            "owner_id": txn.owner_id,
            "eligibility": eligibility,
            "inference_run": None,
            "weight_associations": [],
        }
    inference, assignments = evaluate_f3_weights(txn)
    return {
        "transaction_id": txn.transaction_id,
        "owner_id": txn.owner_id,
        "eligibility": eligibility,
        "inference_run": inference,
        "weight_associations": [item.model_dump() for item in assignments],
    }


def _eligibility(state: str, reason: str, evidence: dict[str, Any]) -> dict[str, Any]:
    return {"state": state, "reason_code": reason, "evidence": evidence}
