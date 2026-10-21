from datetime import date

import pytest

from app.normalize import extract_counterparty
from app.normalize.route import normalize_record

FOREX_TEST_CASES = [
    {
        "id": "hdfc_cc_github_usd",
        "input": "GITHUB INC USD 4.00 @ 84.12 SAN FRANCISCO US",
        "flow": "OUT",
        "expected_merchant": "GitHub",
        "expected_category": "TECHNOLOGY_SERVICES",
        "expected_subcategory": "SOFTWARE_SUBSCRIPTIONS",
    },
    {
        "id": "icici_cc_openai_dcc",
        "input": "OPENAI *CHATGPT DCC MARKUP FEE INCL USD 20.00 CONV RATE 85.10",
        "flow": "OUT",
        "expected_merchant": "OpenAI",
        "expected_category": "TECHNOLOGY_SERVICES",
        "expected_subcategory": "SOFTWARE_SUBSCRIPTIONS",
    },
    {
        "id": "sbi_card_fcy_markup_line",
        "input": "FCY MARK UP FEE 00000000000000000456",
        "flow": "OUT",
        "expected_merchant": "Foreign Exchange Fee",
        "expected_category": "BANK_FEES",
        "expected_subcategory": "FOREX_MARKUP",
    },
    {
        "id": "axis_igst_on_fcy_fee",
        "input": "IGST DB ON FCY FEE @ 18% FOR REF 49201928374",
        "flow": "OUT",
        "expected_merchant": "Bank Taxes",
        "expected_category": "BANK_FEES",
        "expected_subcategory": "TAXES_AND_SURCHARGES",
    },
    {
        "id": "dubai_duty_free_dcc",
        "input": "DUBAI DUTY FREE AED 250.00 @ 22.80 DUBAI AE",
        "flow": "OUT",
        "expected_merchant": "Dubai Duty Free",
        "expected_category": "TRAVEL",
        "expected_subcategory": "DUTY_FREE",
    },
]


@pytest.mark.parametrize("case", FOREX_TEST_CASES, ids=[case["id"] for case in FOREX_TEST_CASES])
def test_forex_and_dcc_resolution(case):
    result = extract_counterparty(raw_text=case["input"], flow=case["flow"])
    assert result["clean_merchant"] == case["expected_merchant"]
    assert result["category_id"] == case["expected_category"]
    assert result["subcategory_id"] == case["expected_subcategory"]


def test_fee_roles_on_ledger_rows():
    markup = normalize_record(_row("FCY MARK UP FEE debited Rs 8.40"), fiu_private_key=None, today=date(2026, 10, 19))
    tax = normalize_record(_row("IGST DB ON FCY FEE debited Rs 1.51"), fiu_private_key=None, today=date(2026, 10, 19))
    spend = normalize_record(_row("GITHUB INC USD 4.00 debited Rs 336.48"), fiu_private_key=None, today=date(2026, 10, 19))
    assert markup["ledger"][0]["fee_role"] == "FCY_MARKUP"
    assert tax["ledger"][0]["fee_role"] == "GST_TAX"
    assert spend["ledger"][0]["clean_merchant"] == "GitHub"
    assert spend["ledger"][0]["fee_role"] == "BASE"


def _row(text: str) -> dict:
    return {
        "owner_id": "owner-1",
        "source": "GMAIL",
        "_id": "rec",
        "channel_type": "SPOT_ALERT",
        "payload": {"raw_text": text},
    }


def test_no_currency_code_bleed_in_merchant_name():
    result = extract_counterparty(raw_text="APPLE.COM/BILL EUR 9.99 @ 91.20 CORK IE", flow="OUT")
    assert "EUR" not in result["clean_merchant"]
    assert "9.99" not in result["clean_merchant"]
    assert result["clean_merchant"] == "Apple"
