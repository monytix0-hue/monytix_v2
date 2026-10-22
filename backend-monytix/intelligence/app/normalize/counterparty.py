from __future__ import annotations

import re

from app.normalize.clearing import CLEARING_REGEX, TRANSFER_TYPE_RULES, VPA_REGEX
from app.normalize.forex import FOREX_FEE_STANDALONE_REGEX, FOREX_MARKER_REGEX, FOREX_STRIP_REGEX
from app.normalize.merchant import known_brand, legal_entity, resolve_taxonomy, sanitize_merchant

_NOISE = {"TRANSACTION", "TRANSFER", "DEFERRED", "PAYMENT", "UNKNOWN"}


_GATEWAY = re.compile(r"\b(RAZORPAY|PAYU)\s*[*]", re.IGNORECASE)
_GATEWAY_NAMES = {"RAZORPAY": "Razorpay", "PAYU": "PayU"}


def extract_counterparty(raw_text: str, flow: str) -> dict[str, str | None]:
    cleaned = (raw_text or "").strip()
    return _annotate(_resolve(cleaned, flow), cleaned)


def _resolve(cleaned: str, flow: str) -> dict[str, str | None]:
    if not cleaned:
        return _flow_fallback(flow)

    if FOREX_FEE_STANDALONE_REGEX.search(cleaned):
        if re.search(r"\b(IGST|CGST|SGST)\b", cleaned, re.IGNORECASE):
            return _hit("Bank Taxes", "BANK_FEES", "TAXES_AND_SURCHARGES")
        return _hit("Foreign Exchange Fee", "BANK_FEES", "FOREX_MARKUP")

    is_p2m = bool(re.search(r"\bP2M\b|DEFERRED", cleaned, re.IGNORECASE))
    is_p2p = bool(re.search(r"\bP2P\b", cleaned, re.IGNORECASE))
    fund = _mutual_fund(cleaned)
    if fund:
        return fund

    vpa = VPA_REGEX.search(cleaned)
    if vpa:
        username = vpa.group(1)
        branded = known_brand(username)
        if branded:
            return _hit(*branded)
        if _terminal_vpa_local(username):
            return _rail_fallback(is_p2p, is_p2m, flow)
        merchant = sanitize_merchant(username)
        category, subcategory = resolve_taxonomy(merchant, cleaned)
        if category != "OTHER_MERCHANT":
            return _hit(merchant, category, subcategory)
        if is_p2p:
            return _hit(_person_name(username), "TRANSFER", "PEER_TO_PEER")

    text = CLEARING_REGEX.sub(" ", cleaned)
    text = FOREX_STRIP_REGEX.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    branded = known_brand(text) or known_brand(cleaned)
    if branded:
        return _hit(*branded)
    fund = _mutual_fund(text)
    if fund:
        return fund

    candidate = sanitize_merchant(text)
    if _meaningless(candidate):
        if re.search(r"\b(?:FUEL|PETROL|DIESEL)\b", cleaned, re.IGNORECASE):
            return _hit("Fuel Station", "MOBILITY_TRANSPORT", "TRANSIT_FUEL")
        if re.search(r"\b(?:HOSPITAL|CLINIC|PHARMACY|LABS)\b", cleaned, re.IGNORECASE):
            return _hit("Healthcare", "HEALTH_MEDICAL", "PHARMACY")
        return _rail_fallback(is_p2p, is_p2m, flow)
    category, subcategory = resolve_taxonomy(candidate, cleaned)
    if category == "OTHER_MERCHANT" and FOREX_MARKER_REGEX.search(cleaned):
        return _hit(candidate if candidate != "Unknown" else "International Merchant", "OTHER_PAYMENT", "INTERNATIONAL_SPEND")
    return _hit(candidate, category, subcategory)


def _mutual_fund(raw: str) -> dict[str, str | None] | None:
    upper = raw.upper()
    compact = re.sub(r"[^A-Z0-9]", "", upper)
    if "HDFCMF" in compact and ("SIP" in compact or "AMC" in compact):
        return _hit("HDFC Mutual Fund", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT")
    if "SIP" in compact and any(marker in compact for marker in ("MUTUALFUND", "AMC", "NMF", "CAMS", "KFINTECH")):
        branded = known_brand(raw)
        if branded and branded[1] == "FINANCIAL_SERVICES":
            return _hit(*branded)
        return _hit(sanitize_merchant(raw), "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT")
    if "HDFC" in upper and "MUTUAL FUND" in upper:
        return _hit("HDFC Mutual Fund", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT")
    return None


def _person_name(username: str) -> str:
    parts = [part.capitalize() for part in re.split(r"[._\-]+", username) if part and not part.isdigit()]
    return " ".join(parts) or TRANSFER_TYPE_RULES["P2P"]["default_name"]


def _terminal_vpa_local(username: str) -> bool:
    token = (username or "").strip()
    if not token or len(token) <= 4:
        return True
    return bool(re.fullmatch(r"[0-9a-fA-F]+", token) or re.fullmatch(r"\d+", token))


def _meaningless(candidate: str) -> bool:
    if not candidate or candidate == "Unknown" or len(candidate) < 3:
        return True
    return candidate.upper() in _NOISE


def _rail_fallback(is_p2p: bool, is_p2m: bool, flow: str) -> dict[str, str | None]:
    if is_p2p:
        rule = TRANSFER_TYPE_RULES["P2P"]
        return _hit(rule["default_name"], rule["category"], rule["subcategory"])
    if is_p2m:
        rule = TRANSFER_TYPE_RULES["P2M"]
        return _hit(rule["default_name"], rule["category"], rule["subcategory"])
    return _flow_fallback(flow)


def _flow_fallback(flow: str) -> dict[str, str | None]:
    if flow == "IN":
        return _hit("UPI Transfer", "OTHER_PAYMENT", "MISCELLANEOUS")
    return _hit("General Spend", "OTHER_PAYMENT", "MISCELLANEOUS")


def _hit(merchant: str, category: str, subcategory: str | None) -> dict[str, str | None]:
    return {"clean_merchant": merchant, "category_id": category, "subcategory_id": subcategory}


def _annotate(hit: dict[str, str | None], raw: str) -> dict[str, str | None]:
    gateway = _GATEWAY.search(raw or "")
    hit["gateway"] = _GATEWAY_NAMES.get(gateway.group(1).upper()) if gateway else None
    hit["legal_entity"] = legal_entity(hit.get("clean_merchant"))
    hit["operating_country"] = "OVERSEAS" if raw and FOREX_MARKER_REGEX.search(raw) else "IN"
    return hit
