"""Classify one raw inbound record into a single finance domain."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from app.aa.crypto import decrypt_rebit_payload
from app.normalize.counterparty import extract_counterparty
from app.normalize.rail import detect_payment_rail, payment_reference

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_AMOUNT = re.compile(r"(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*)", re.IGNORECASE)


class NormalizeError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def empty_result(domain: str, decrypted: dict | None = None) -> dict[str, Any]:
    return {
        "domain": domain,
        "ledger": [],
        "due": None,
        "mutual_funds": [],
        "investments": [],
        "assets": [],
        "debts": [],
        "policies": [],
        "decrypted_fi": decrypted,
    }


def normalize_record(record: dict[str, Any], *, fiu_private_key: bytes | None, today: date | None = None) -> dict[str, Any]:
    clock = today or date.today()
    payload = record.get("payload") or {}
    if record.get("source") == "ACCOUNT_AGGREGATOR":
        decrypted = payload.get("decrypted_fi")
        if isinstance(decrypted, dict):
            return _route_aa(str(payload.get("fi_type") or ""), decrypted)
        if fiu_private_key is None:
            raise NormalizeError("fiu_key_missing")
        nonce = _b64(payload["our_nonce"]) if payload.get("our_nonce") else None
        decoded = decrypt_rebit_payload(payload["encrypted_fi"], fiu_private_key, nonce)
        return _route_aa(str(payload.get("fi_type") or ""), decoded)
    text = str(payload.get("raw_text") or "")
    domain = detect_domain(text)
    if domain == "LEDGER":
        rows = bank_rows(text, clock)
        if not rows:
            raise NormalizeError("unrecognized_domain")
        result = empty_result("LEDGER")
        result["ledger"] = rows
        return result
    if domain == "DUE_DATE":
        due = due_alert(text, clock)
        if due is None:
            raise NormalizeError("unrecognized_domain")
        result = empty_result("DUE_DATE")
        result["due"] = due
        return result
    if domain == "MUTUAL_FUND":
        holding = mutual_fund(text)
        if holding is None:
            raise NormalizeError("unrecognized_domain")
        result = empty_result("MUTUAL_FUND")
        result["mutual_funds"] = [holding]
        return result
    if domain == "INSURANCE":
        policy = insurance_policy(text)
        if policy is None:
            raise NormalizeError("unrecognized_domain")
        result = empty_result("INSURANCE")
        result["policies"] = [policy]
        return result
    if domain == "DEBT":
        debt = debt_liability(text)
        if debt is None:
            raise NormalizeError("unrecognized_domain")
        result = empty_result("DEBT")
        result["debts"] = [debt]
        return result
    if domain == "INVESTMENT":
        position = investment_position(text)
        if position is None:
            raise NormalizeError("unrecognized_domain")
        result = empty_result("INVESTMENT")
        result["investments"] = [position]
        return result
    raise NormalizeError("unrecognized_domain")


def fee_role_of(subcategory: str | None) -> str:
    if subcategory == "FOREX_MARKUP":
        return "FCY_MARKUP"
    if subcategory == "TAXES_AND_SURCHARGES":
        return "GST_TAX"
    return "BASE"


def detect_domain(text: str) -> str:
    upper = text.upper()
    if any(token in upper for token in ("CAMS", "KFINTECH", "CONSOLIDATED CAS")) or re.search(r"\bFOLIO\b", upper):
        return "MUTUAL_FUND"
    if "POLICY SCHEDULE" in upper or "SUM INSURED" in upper or "SUM_INSURED" in upper:
        return "INSURANCE"
    if "HOME LOAN" in upper or "LOAN A/C" in upper or ("OUTSTANDING" in upper and "EMI" in upper):
        return "DEBT"
    if "CONTRACT NOTE" in upper or "DEMAT" in upper:
        return "INVESTMENT"
    if re.search(r"\bamount due\b|\bdue\s*:", text, re.IGNORECASE):
        return "DUE_DATE"
    if re.search(r"\b(debited|credited|debit|credit|UPI|POS|ACH|IMPS|NEFT|RTGS)\b", text, re.IGNORECASE):
        return "LEDGER"
    return "UNKNOWN"


def bank_rows(text: str, today: date) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    chunks = [line.strip() for line in text.splitlines() if line.strip()] or [text.strip()]
    line_no = 0
    for chunk in chunks:
        if not re.search(r"\b(debited|credited|debit|credit|UPI|POS|ACH|IMPS|NEFT)\b", chunk, re.IGNORECASE):
            continue
        amount = first_amount(chunk) or _plain_amount(chunk)
        if amount is None:
            continue
        line_no += 1
        rail = detect_payment_rail(chunk)
        party = _party(chunk, str(rail["flow"]), str(rail["channel"]))
        last4 = re.search(r"(?:ending|a/c|acct|account)\s*(?:no\.?)?\s*[*xX]*(\d{4})\b", chunk, re.IGNORECASE)
        rows.append({
            "line_no": line_no,
            "amount": amount,
            "flow": rail["flow"],
            "channel": rail["channel"],
            "payment_ref": payment_reference(chunk, rail["payment_ref"]),
            "payment_network": rail.get("payment_network"),
            "raw_narration": chunk[:500],
            "clean_merchant": party["clean_merchant"],
            "gateway": party.get("gateway"),
            "legal_entity": party.get("legal_entity"),
            "operating_country": party.get("operating_country") or "IN",
            "category_id": party["category_id"],
            "subcategory_id": party["subcategory_id"],
            "fee_role": fee_role_of(party["subcategory_id"]),
            "posted_at": parse_posted(chunk, today).isoformat(),
            "masked_account": last4.group(1) if last4 else "0000",
            "institution": None,
            "currency_code": "INR",
        })
    return rows


def due_alert(text: str, today: date) -> dict[str, Any] | None:
    amount = first_amount(text)
    if amount is None:
        return None
    named = re.search(r"due\s*:?\s*(\d{1,2})[-/\s]([A-Za-z]{3,9})(?:[-/\s](\d{4}))?", text, re.IGNORECASE)
    if not named or named.group(2)[:3].lower() not in _MONTHS:
        return None
    month = _MONTHS[named.group(2)[:3].lower()]
    year = int(named.group(3)) if named.group(3) else today.year
    due = date(year, month, int(named.group(1)))
    if named.group(3) is None and due < today - timedelta(days=30):
        due = date(year + 1, month, int(named.group(1)))
    upper = text.upper()
    if "CARD" in upper:
        instrument = "CREDIT_CARD"
    elif "INSURANCE" in upper or "PREMIUM" in upper:
        instrument = "INSURANCE_PREMIUM"
    elif "LOAN" in upper or "EMI" in upper:
        instrument = "LOAN_EMI"
    else:
        instrument = "UTILITY"
    biller = "HDFC Card" if "HDFC CARD" in upper else next((line.strip()[:128] for line in text.splitlines() if line.strip()), "Biller")
    return {
        "biller_name": biller,
        "amount_due": amount,
        "due_date": due.isoformat(),
        "instrument_type": instrument,
        "currency_code": "INR",
    }


def mutual_fund(text: str) -> dict[str, Any] | None:
    folio = _field(text, "FOLIO")
    scheme = _field(text, "SCHEME")
    units = _field(text, "UNITS")
    if not folio or not scheme or not units:
        return None
    transactions = []
    for line in text.splitlines():
        txn = re.match(
            r"TXN\s+(SIP|PURCHASE|REDEMPTION|STAMP_DUTY)\s+(\d{4}-\d{2}-\d{2})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)",
            line.strip(),
            re.IGNORECASE,
        )
        if txn:
            transactions.append({
                "type": txn.group(1).upper(),
                "transaction_date": txn.group(2),
                "amount": money_text(txn.group(3)),
                "units": txn.group(4),
                "nav": txn.group(5),
            })
    return {
        "folio_number": folio,
        "scheme_name": scheme,
        "isin": _field(text, "ISIN"),
        "units": units,
        "nav": _field(text, "NAV"),
        "nav_date": _field(text, "NAV_DATE"),
        "current_value": _field(text, "CURRENT"),
        "currency_code": "INR",
        "transactions": transactions,
    }


def insurance_policy(text: str) -> dict[str, Any] | None:
    number_match = re.search(r"^POLICY\s+([A-Z0-9-]+)\s*$", text, re.IGNORECASE | re.MULTILINE)
    number = number_match.group(1) if number_match else None
    if not number:
        return None
    provider = "HDFC Life" if "HDFC LIFE" in text.upper() else (_field(text, "PROVIDER") or "Insurer")
    return {
        "provider": provider[:128],
        "policy_number": number,
        "policy_type": (_field(text, "TYPE") or "HEALTH").upper(),
        "sum_insured": money_text(_field(text, "SUM_INSURED") or "0.01"),
        "premium_amount": money_text(_field(text, "PREMIUM") or "0.01"),
        "premium_frequency": (_field(text, "FREQUENCY") or "ANNUAL").upper(),
        "renewal_date": _field(text, "RENEWAL") or date.today().isoformat(),
        "policy_status": (_field(text, "STATUS") or "ACTIVE").upper(),
        "currency_code": "INR",
    }


def debt_liability(text: str) -> dict[str, Any] | None:
    number = re.search(r"A/C\s+([A-Za-z0-9]+)", text, re.IGNORECASE)
    outstanding = _field(text, "OUTSTANDING")
    if not number or not outstanding:
        return None
    return {
        "lender_name": "HDFC Bank" if "HDFC" in text.upper() else "Lender",
        "account_or_loan_number": number.group(1),
        "loan_type": "HOME_LOAN" if "HOME LOAN" in text.upper() else "PERSONAL_LOAN",
        "principal_amount": _optional_money(_field(text, "PRINCIPAL")),
        "outstanding_balance": money_text(outstanding),
        "emi_amount": _optional_money(_field(text, "EMI")),
        "interest_rate": _field(text, "RATE"),
        "next_emi_date": _field(text, "NEXT"),
        "currency_code": "INR",
    }


def investment_position(text: str) -> dict[str, Any] | None:
    isin = _field(text, "ISIN")
    name = _field(text, "NAME")
    if not isin or not name:
        return None
    asset = (_field(text, "CLASS") or "EQUITY").upper()
    if asset not in {"EQUITY", "BOND", "OTHER"}:
        asset = "OTHER"
    return {
        "instrument_name": name,
        "isin": isin,
        "asset_class": asset,
        "units": _field(text, "UNITS"),
        "price": _field(text, "PRICE"),
        "value": _optional_money(_field(text, "VALUE")),
        "as_of_date": _field(text, "AS_OF"),
        "currency_code": "INR",
    }


def _route_aa(fi_type: str, decoded: dict[str, Any]) -> dict[str, Any]:
    if fi_type == "DEPOSIT":
        result = empty_result("LEDGER", decoded)
        result["ledger"] = _aa_deposit(decoded)
        return result
    if fi_type == "MUTUAL_FUNDS":
        result = empty_result("MUTUAL_FUND", decoded)
        result["mutual_funds"] = _aa_funds(decoded)
        return result
    if fi_type == "INSURANCE":
        result = empty_result("INSURANCE", decoded)
        result["policies"] = [_aa_policy(policy) for policy in (decoded.get("insurance") or {}).get("policies") or []]
        return result
    if fi_type == "TERM_DEPOSIT":
        result = empty_result("ASSET", decoded)
        result["assets"] = [_aa_asset(account) for account in decoded.get("account") or []]
        return result
    if fi_type == "CREDIT":
        result = empty_result("DEBT", decoded)
        result["debts"] = [_aa_credit(account) for account in decoded.get("account") or []]
        return result
    raise NormalizeError("unrecognized_domain")


def _aa_deposit(decoded: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    line = 0
    for account in decoded.get("account") or []:
        for txn in (account.get("transactions") or {}).get("transaction") or []:
            line += 1
            narration = str(txn.get("narration") or "")
            rail = detect_payment_rail(narration)
            kind = str(txn.get("type") or "").upper()
            flow = "OUT" if kind == "DEBIT" else "IN" if kind == "CREDIT" else str(rail["flow"])
            party = _party(narration, flow, str(rail["channel"]))
            payment_ref = txn.get("reference") or txn.get("txnId") or payment_reference(narration, rail["payment_ref"])
            mode = str(txn.get("mode") or "")
            channel = detect_payment_rail(mode).get("channel") if mode else rail["channel"]
            if mode and channel == "OTHER":
                channel = rail["channel"]
            rows.append({
                "line_no": line,
                "amount": money_text(txn.get("amount")),
                "flow": flow,
                "channel": channel,
                "payment_ref": str(payment_ref) if payment_ref else None,
                "payment_network": rail.get("payment_network"),
                "raw_narration": narration[:500],
                "clean_merchant": party["clean_merchant"],
                "gateway": party.get("gateway"),
                "legal_entity": party.get("legal_entity"),
                "operating_country": party.get("operating_country") or "IN",
                "category_id": party["category_id"],
                "subcategory_id": party["subcategory_id"],
                "fee_role": fee_role_of(party["subcategory_id"]),
                "posted_at": parse_posted(str(txn.get("transactionTimestamp") or ""), date.today()).isoformat(),
                "masked_account": str(account.get("maskedAccNumber") or "0000"),
                "institution": account.get("bank"),
                "currency_code": str(txn.get("currency") or "INR"),
            })
    return rows


def _aa_funds(decoded: dict[str, Any]) -> list[dict[str, Any]]:
    holdings = []
    for fund in (decoded.get("mutualFunds") or {}).get("account") or []:
        transactions = []
        for txn in (fund.get("transactions") or {}).get("transaction") or []:
            kind = str(txn.get("type") or "PURCHASE").upper()
            if kind not in {"SIP", "PURCHASE", "REDEMPTION", "STAMP_DUTY"}:
                kind = "PURCHASE"
            transactions.append({
                "transaction_date": str(txn.get("date") or "")[:10],
                "type": kind,
                "amount": money_text(txn.get("amount")),
                "units": None if txn.get("units") is None else str(txn.get("units")),
                "nav": None if txn.get("nav") is None else str(txn.get("nav")),
            })
        holdings.append({
            "folio_number": str(fund.get("folioNo") or ""),
            "scheme_name": str(fund.get("schemeName") or ""),
            "isin": fund.get("isin"),
            "units": str(fund.get("closingUnits")),
            "nav": None if fund.get("nav") is None else str(fund.get("nav")),
            "nav_date": str(fund.get("navDate") or "")[:10] or None,
            "current_value": None if fund.get("currentValue") is None else str(fund.get("currentValue")),
            "currency_code": "INR",
            "transactions": transactions,
        })
    return holdings


def _aa_policy(policy: dict[str, Any]) -> dict[str, Any]:
    policy_type = str(policy.get("policyType") or "HEALTH").upper()
    if policy_type == "LIFE":
        policy_type = "TERM_LIFE"
    renewal = str(policy.get("expiryDate") or policy.get("nextDueDate") or "")[:10]
    return {
        "provider": str(policy.get("insurerName") or "Insurer")[:128],
        "policy_number": str(policy.get("policyNumber")),
        "policy_type": policy_type,
        "sum_insured": money_text(policy.get("sumAssured")),
        "premium_amount": money_text(policy.get("premiumAmount")),
        "premium_frequency": str(policy.get("premiumFrequency") or "ANNUAL").upper(),
        "renewal_date": renewal,
        "policy_status": str(policy.get("status") or "ACTIVE").upper(),
        "currency_code": "INR",
    }


def _aa_asset(account: dict[str, Any]) -> dict[str, Any]:
    return {
        "institution": account.get("bank"),
        "account_number": str(account.get("maskedAccNumber") or account.get("accountNumber")),
        "principal_amount": money_text(account.get("principalAmount")),
        "interest_rate": None if account.get("interestRate") is None else str(account.get("interestRate")),
        "maturity_date": str(account.get("maturityDate") or "")[:10] or None,
        "maturity_amount": None if account.get("maturityAmount") is None else money_text(account.get("maturityAmount")),
        "currency_code": "INR",
    }


def _aa_credit(account: dict[str, Any]) -> dict[str, Any]:
    return {
        "lender_name": str(account.get("bank") or "Lender"),
        "account_or_loan_number": str(account.get("maskedAccNumber") or account.get("accountNumber")),
        "loan_type": str(account.get("loanType") or "PERSONAL_LOAN").upper(),
        "principal_amount": None if account.get("principalAmount") is None else money_text(account.get("principalAmount")),
        "outstanding_balance": money_text(account.get("outstandingBalance")),
        "emi_amount": None if account.get("emiAmount") is None else money_text(account.get("emiAmount")),
        "interest_rate": None if account.get("interestRate") is None else str(account.get("interestRate")),
        "next_emi_date": str(account.get("nextEmiDate") or "")[:10] or None,
        "currency_code": "INR",
    }


def money_text(value: object) -> str:
    amount = Decimal(str(value).replace(",", "")).copy_abs().quantize(Decimal("0.01"))
    if amount <= 0:
        raise NormalizeError("amount")
    return format(amount, "f")


def first_amount(text: str) -> str | None:
    for match in _AMOUNT.finditer(text):
        window = text[max(0, match.start() - 40): match.start()]
        if re.search(r"\bbalance\b", window, re.IGNORECASE):
            continue
        try:
            return money_text(match.group(1))
        except NormalizeError:
            continue
    return None


def _party(text: str, flow: str, channel: str) -> dict[str, str | None]:
    if channel == "ATM":
        return {
            "clean_merchant": "ATM Cash Withdrawal",
            "category_id": "OTHER_PAYMENT",
            "subcategory_id": "MISCELLANEOUS",
            "gateway": None,
            "legal_entity": None,
            "operating_country": "IN",
        }
    return extract_counterparty(text, flow)


def channel_of(text: str) -> str:
    channel = str(detect_payment_rail(text)["channel"])
    if channel == "OTHER" and re.search(r"\bFT\b", text, re.IGNORECASE):
        return "FT"
    return channel


def parse_posted(value: str, fallback: date) -> datetime:
    named = re.search(r"(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{4})", value)
    if named and named.group(2)[:3].lower() in _MONTHS:
        return datetime(int(named.group(3)), _MONTHS[named.group(2)[:3].lower()], int(named.group(1)))
    iso = re.search(r"(\d{4})-(\d{2})-(\d{2})", value)
    if iso and "T" in value:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    if iso:
        return datetime(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
    return datetime(fallback.year, fallback.month, fallback.day)


def _plain_amount(chunk: str) -> str | None:
    match = re.search(r"\b(\d+\.\d{2})\b", chunk)
    if not match:
        return None
    try:
        return money_text(match.group(1))
    except NormalizeError:
        return None


def _field(text: str, label: str) -> str | None:
    match = re.search(rf"^{re.escape(label)}\s+(.+)$", text, re.IGNORECASE | re.MULTILINE)
    if not match:
        return None
    value = match.group(1).strip()
    return value or None


def _optional_money(value: str | None) -> str | None:
    if value is None:
        return None
    return money_text(value)


def _b64(value: str) -> bytes:
    import base64
    return base64.b64decode(value)
