import pytest

from app.normalize import extract_counterparty

CLEARING_TEST_CASES = [
    {
        "id": "npci_p2m_deferred_plain",
        "input": "UPI/CR/429182736451/P2m Transactions Above Deferred",
        "flow": "IN",
        "expected_merchant": "Merchant Payment",
        "expected_category": "PAYMENTS",
        "expected_subcategory": "MERCHANT_SETTLEMENT",
    },
    {
        "id": "npci_p2m_deferred_with_vpa",
        "input": "UPI/DR/102938475610/P2M TRANSACTIONS ABOVE DEFERRED/swiggy@icici/BUNDL TECHNOLOGIES",
        "flow": "OUT",
        "expected_merchant": "Swiggy",
        "expected_category": "FOOD_DINING",
        "expected_subcategory": "FOOD_DELIVERY",
    },
    {
        "id": "upi_p2p_transfer_person",
        "input": "UPI/CR/998877665544/UPI P2P rahul.sharma@okhdfcbank/PAYMENT",
        "flow": "IN",
        "expected_merchant": "Rahul Sharma",
        "expected_category": "TRANSFER",
        "expected_subcategory": "PEER_TO_PEER",
    },
    {
        "id": "billdesk_online_clearing",
        "input": "BIL/ONL/000918273645/ZOMATO LIMITED/MUMBAI",
        "flow": "OUT",
        "expected_merchant": "Zomato",
        "expected_category": "FOOD_DINING",
        "expected_subcategory": "FOOD_DELIVERY",
    },
    {
        "id": "ach_clearing_mutual_fund",
        "input": "ACH/D-BIL/INFT-HDFC00998811-HDFC MUTUAL FUND SIP",
        "flow": "OUT",
        "expected_merchant": "HDFC Mutual Fund",
        "expected_category": "FINANCIAL_SERVICES",
        "expected_subcategory": "SIP_AUTO_DEBIT",
    },
    {
        "id": "pure_rail_noise_p2p",
        "input": "TRANSFER UPI P2P DEFERRED NET SETTLEMENT",
        "flow": "OUT",
        "expected_merchant": "Peer Transfer",
        "expected_category": "TRANSFER",
        "expected_subcategory": "PEER_TO_PEER",
    },
]


@pytest.mark.parametrize("case", CLEARING_TEST_CASES, ids=[case["id"] for case in CLEARING_TEST_CASES])
def test_clearing_phrase_resolution(case):
    result = extract_counterparty(raw_text=case["input"], flow=case["flow"])
    assert result["clean_merchant"] == case["expected_merchant"]
    assert result["category_id"] == case["expected_category"]
    assert result["subcategory_id"] == case["expected_subcategory"]


def test_empty_or_whitespace_input():
    result = extract_counterparty(raw_text="   ", flow="OUT")
    assert result["clean_merchant"] == "General Spend"
    assert result["category_id"] == "OTHER_PAYMENT"


def test_case_insensitivity_clearing_patterns():
    result = extract_counterparty(raw_text="upi/cr/123456789012/p2m transactions above deferred", flow="IN")
    assert result["clean_merchant"] == "Merchant Payment"
    assert result["category_id"] == "PAYMENTS"
    assert result["subcategory_id"] == "MERCHANT_SETTLEMENT"


def test_terminal_vpa_local_falls_back_to_merchant_payment():
    result = extract_counterparty(raw_text="UPI/DR/429182736451/0807@pty/Payment", flow="OUT")
    assert result["clean_merchant"] == "General Spend"
    assert result["category_id"] == "OTHER_PAYMENT"
    assert "0807" not in (result["clean_merchant"] or "")


def test_banking_corp_suffix_is_stripped():
    from app.normalize.merchant import sanitize_merchant

    cleaned = sanitize_merchant("American Express Banking Corp Ltd")
    assert cleaned == "American Express"
    assert "Banking" not in cleaned
