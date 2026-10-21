from __future__ import annotations

import re

_DEBIT = re.compile(r"\b(?:debited|debit|spent|paid|withdrawn)\b|(?:UPI|IMPS|NEFT|RTGS)[/\-]DR\b", re.IGNORECASE)
_CREDIT = re.compile(r"\b(?:credited|credit)\b|(?:UPI|IMPS|NEFT|RTGS)[/\-]CR\b", re.IGNORECASE)
_ATM = re.compile(r"ATM[- ]WDL|CASH WDL|NFS\*|NWD-", re.IGNORECASE)
_LABELED_REF = re.compile(r"\b(?:ref(?:erno)?|rrn|utr|txn\s*id)[:\s]*([A-Za-z0-9]{6,})\b", re.IGNORECASE)


def detect_payment_rail(narration: str) -> dict[str, str | None]:
    text = narration or ""
    upper = text.upper()
    flow = _flow(upper)
    channel, payment_ref = _channel(upper)
    network = re.search(r"\b(VISA|MASTERCARD|RUPAY|AMEX)\b", upper)
    return {
        "flow": flow,
        "channel": channel,
        "payment_ref": payment_ref,
        "payment_network": network.group(1) if network else None,
    }


def payment_reference(narration: str, rail_ref: str | None) -> str | None:
    labeled = _LABELED_REF.search(narration or "")
    if labeled:
        return labeled.group(1)
    return rail_ref


def _flow(upper: str) -> str:
    if _DEBIT.search(upper) or _ATM.search(upper):
        return "OUT"
    if _CREDIT.search(upper):
        return "IN"
    return "OUT"


def _channel(upper: str) -> tuple[str, str | None]:
    intent = _upi_intent(upper)
    if intent:
        return intent, _first(r"\b\d{12}\b", upper)
    if "IMPS" in upper:
        return "IMPS", _first(r"\b\d{10,12}\b", upper)
    if "NEFT" in upper:
        return "NEFT", _first(r"\b[A-Z0-9]{16}\b", upper)
    if "RTGS" in upper:
        return "RTGS", _first(r"\b[A-Z0-9]{16,22}\b", upper)
    if re.search(r"\bPOS\b|/POS/|VPS/|IPS/", upper):
        return "CARD_POS", None
    if "ECOM" in upper or ".COM" in upper or "WWW." in upper:
        return "CARD_ECOMMERCE", None
    if _ATM.search(upper):
        return "ATM", None
    if re.search(r"\b(?:ACH|NACH|ECS)\b|CMS/NACH", upper):
        return "ACH_NACH", None
    if re.search(r"\b(?:CHEQUE|CHQ)\b", upper):
        return "CHEQUE", None
    return "OTHER", None


def _upi_intent(upper: str) -> str | None:
    has_upi = bool(upper.startswith("UPI") or "/UPI/" in upper or "-UPI-" in upper or re.search(r"\bUPI\b", upper))
    has_p2p = bool(re.search(r"\bP2P\b", upper))
    has_p2m = bool(re.search(r"\bP2M\b", upper))
    deferred = bool(re.search(r"P2M TRANSACTIONS ABOVE DEFERRED|P2M TRANSACTION DEFERRED|DEFERRED NET SETTLEMENT", upper))
    if re.search(r"\b(?:MANDATE|AUTOPAY)\b", upper) and not re.search(r"\b(?:ACH|NACH|ECS|IMPS|NEFT|RTGS|POS)\b", upper):
        return "UPI_MANDATE"
    if has_p2p:
        return "UPI_P2P"
    if (has_p2m and "DEFERRED" in upper) or deferred:
        return "UPI_P2M_DEFERRED"
    if has_p2m:
        return "UPI_P2M"
    if has_upi:
        return "UPI"
    return None


def _first(pattern: str, text: str) -> str | None:
    match = re.search(pattern, text)
    return match.group(0) if match else None
