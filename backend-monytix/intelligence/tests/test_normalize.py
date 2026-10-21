import json
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.aa.crypto import encrypt_for_fiu, generate_keypair
from app.main import app
from app.normalize.merchant import sanitize_merchant
from app.normalize.route import normalize_record

TODAY = date(2026, 10, 19)
OWNER = "owner-1"


def record(source: str, text: str, channel: str = "SPOT_ALERT") -> dict:
    return {
        "owner_id": OWNER,
        "source": source,
        "_id": "rec",
        "channel_type": channel,
        "payload": {"raw_text": text, "mime_headers": {}, "storage_ref": None},
    }


def test_merchants():
    assert sanitize_merchant("UPI/41234/SWIGGY-BANGALORE") == "Swiggy"
    assert sanitize_merchant("UPI-SWIGGY-BANGALORE-429182") == "Swiggy"
    assert sanitize_merchant("POS 4111xxxx STARBUCKS BLR") == "Starbucks"
    assert sanitize_merchant("ACH/HDFCMF/SIP/109283") == "HDFC AMC"


def test_matrix_separates_domains():
    cases = {
        "swiggy": (
            "Your A/C ending 4321 debited by Rs 350.00 on 19-Oct-2026 via UPI/41234/SWIGGY-BANGALORE",
            "LEDGER",
            "Swiggy",
            "FOOD_DINING",
            "FOOD_DELIVERY",
        ),
        "starbucks": (
            "POS 4111xxxx STARBUCKS BLR debited Rs 180.00 on 19-Oct-2026",
            "LEDGER",
            "Starbucks",
            "FOOD_DINING",
            "COFFEE_AND_CAFES",
        ),
        "sip": (
            "ACH/HDFCMF/SIP/109283 debited Rs 2000.00 on 19-Oct-2026",
            "LEDGER",
            "HDFC AMC",
            "FINANCIAL_SERVICES",
            "SIP_AUTO_DEBIT",
        ),
    }
    for text, domain, merchant, category, subcategory in cases.values():
        result = normalize_record(record("GMAIL", text), fiu_private_key=None, today=TODAY)
        assert result["domain"] == domain
        assert result["ledger"][0]["clean_merchant"] == merchant
        assert result["ledger"][0]["category_id"] == category
        assert result["ledger"][0]["subcategory_id"] == subcategory
        assert result["ledger"][0]["flow"] == "OUT"
        assert float(result["ledger"][0]["amount"]) > 0
        assert result["due"] is None
        assert result["mutual_funds"] == []
        assert result["debts"] == []
        assert result["policies"] == []

    due = normalize_record(
        record("GMAIL", "HDFC Card\nAmount due: Rs 4,500. Due: 28-Oct"),
        fiu_private_key=None,
        today=TODAY,
    )
    assert due["domain"] == "DUE_DATE"
    assert due["ledger"] == []
    assert due["due"]["biller_name"] == "HDFC Card"
    assert due["due"]["due_date"] == "2026-10-28"
    assert due["due"]["instrument_type"] == "CREDIT_CARD"

    cas = normalize_record(record("PDF_UPLOAD", CAS, "STATEMENT_PDF"), fiu_private_key=None, today=TODAY)
    assert cas["domain"] == "MUTUAL_FUND"
    assert cas["ledger"] == []
    assert cas["mutual_funds"][0]["folio_number"] == "109283"
    assert cas["mutual_funds"][0]["transactions"][0]["type"] == "SIP"

    loan = normalize_record(record("PDF_UPLOAD", LOAN, "STATEMENT_PDF"), fiu_private_key=None, today=TODAY)
    assert loan["domain"] == "DEBT"
    assert loan["ledger"] == []
    assert loan["debts"][0]["account_or_loan_number"] == "99128"

    policy = normalize_record(record("PDF_UPLOAD", POLICY, "STATEMENT_PDF"), fiu_private_key=None, today=TODAY)
    assert policy["domain"] == "INSURANCE"
    assert policy["ledger"] == []
    assert policy["policies"][0]["policy_number"] == "HL123456"


def test_aa_domains_roundtrip():
    fiu_private, fiu_public = generate_keypair()
    payloads = {
        "DEPOSIT": {"account": [{"maskedAccNumber": "XXXX4321", "bank": "HDFC", "transactions": {"transaction": [{
            "type": "DEBIT", "amount": "350.00", "narration": "UPI/41234/SWIGGY-BANGALORE",
            "mode": "UPI", "reference": "REF123456", "transactionTimestamp": "2026-10-19T06:15:00Z",
        }]}}]},
        "MUTUAL_FUNDS": {"mutualFunds": {"account": [{
            "folioNo": "F1", "schemeName": "Flexi", "isin": "INF179K01BB6", "closingUnits": "10",
            "nav": "45.12", "navDate": "2026-10-01", "currentValue": "451.20",
            "transactions": {"transaction": [{"date": "2026-09-01", "type": "SIP", "amount": "1000", "units": "10", "nav": "100"}]},
        }]}},
        "TERM_DEPOSIT": {"account": [{"maskedAccNumber": "XXXX9911", "bank": "HDFC", "principalAmount": "100000", "interestRate": "7.1", "maturityDate": "2027-10-19", "maturityAmount": "107100"}]},
        "CREDIT": {"account": [{"maskedAccNumber": "XXXX2222", "bank": "HDFC", "loanType": "PERSONAL_LOAN", "principalAmount": "200000", "outstandingBalance": "150000", "emiAmount": "8000", "interestRate": "12.5", "nextEmiDate": "2026-11-05"}]},
        "INSURANCE": {"insurance": {"policies": [{"insurerName": "HDFC Life", "policyNumber": "P1", "policyType": "HEALTH", "sumAssured": "500000", "premiumAmount": "12000", "premiumFrequency": "ANNUAL", "expiryDate": "2027-01-01", "status": "ACTIVE"}]}},
    }
    expected = {
        "DEPOSIT": "LEDGER",
        "MUTUAL_FUNDS": "MUTUAL_FUND",
        "TERM_DEPOSIT": "ASSET",
        "CREDIT": "DEBT",
        "INSURANCE": "INSURANCE",
    }
    for fi_type, body in payloads.items():
        eph_private, _public = generate_keypair()
        from app.aa.crypto import fresh_nonce
        fiu_nonce = fresh_nonce()
        eph_nonce = fresh_nonce()
        encrypted = encrypt_for_fiu(json.dumps(body).encode(), eph_private, eph_nonce, fiu_public, fiu_nonce)
        import base64
        result = normalize_record({
            "owner_id": OWNER,
            "source": "ACCOUNT_AGGREGATOR",
            "payload": {
                "fi_type": fi_type,
                "encrypted_fi": encrypted,
                "our_nonce": base64.b64encode(fiu_nonce).decode(),
            },
        }, fiu_private_key=fiu_private, today=TODAY)
        assert result["domain"] == expected[fi_type]
        populated = [name for name in ("ledger", "mutual_funds", "assets", "debts", "policies") if result[name]]
        assert populated == [{
            "LEDGER": "ledger",
            "MUTUAL_FUND": "mutual_funds",
            "ASSET": "assets",
            "DEBT": "debts",
            "INSURANCE": "policies",
        }[result["domain"]]]
        if fi_type == "DEPOSIT":
            assert result["ledger"][0]["flow"] == "OUT"
            assert result["ledger"][0]["amount"] == "350.00"
            assert result["decrypted_fi"]["account"][0]["bank"] == "HDFC"


def test_http_requires_internal_token(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("INTERNAL_TOKEN", "secret")
    client = TestClient(app)
    denied = client.post("/internal/normalize", json=record("GMAIL", "debited Rs 10.00 via UPI"))
    assert denied.status_code == 401
    allowed = client.post(
        "/internal/normalize",
        headers={"authorization": "Bearer secret"},
        json=record("GMAIL", "Your A/C ending 1111 debited by Rs 10.00 on 19-Oct-2026 via UPI SWIGGY"),
    )
    assert allowed.status_code == 200
    assert allowed.json()["domain"] == "LEDGER"
    classified = client.post(
        "/v1/internal/intelligence/classify",
        headers={"authorization": "Bearer secret"},
        json=record("GMAIL", "Your A/C ending 1111 debited by Rs 10.00 on 19-Oct-2026 via UPI SWIGGY"),
    )
    assert classified.status_code == 200
    assert classified.json()["domain"] == "LEDGER"


CAS = """CAMS Consolidated CAS PDF
FOLIO 109283
SCHEME HDFC Flexi Cap
ISIN INF179K01BB6
UNITS 12.5
NAV 45.12
NAV_DATE 2026-10-01
CURRENT 564.00
TXN SIP 2026-09-01 1000.00 22.16 45.12
"""

LOAN = """HDFC Home Loan A/C 99128
OUTSTANDING 2500000.00
EMI 25000.00
RATE 8.50
NEXT 2026-11-05
PRINCIPAL 3000000.00
"""

POLICY = """Policy Schedule HDFC Life
POLICY HL123456
TYPE HEALTH
SUM_INSURED 500000
PREMIUM 12000
FREQUENCY ANNUAL
RENEWAL 2027-01-01
STATUS ACTIVE
"""
