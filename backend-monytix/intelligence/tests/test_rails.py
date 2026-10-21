from datetime import date

from app.normalize.route import normalize_record

TODAY = date(2026, 10, 19)


def row(text: str) -> dict:
    result = normalize_record(
        {
            "owner_id": "owner-1",
            "source": "GMAIL",
            "_id": "rec",
            "channel_type": "SPOT_ALERT",
            "payload": {"raw_text": text},
        },
        fiu_private_key=None,
        today=TODAY,
    )
    assert result["domain"] == "LEDGER"
    return result["ledger"][0]


def test_upi_swiggy_keeps_the_twelve_digit_reference():
    ledger = row("debited Rs 350.00 via UPI/429182736451/SWIGGY-BANGALORE")
    assert ledger["flow"] == "OUT"
    assert ledger["channel"] == "UPI"
    assert ledger["payment_ref"] == "429182736451"
    assert ledger["clean_merchant"] == "Swiggy"
    assert ledger["category_id"] == "FOOD_DINING"
    assert ledger["subcategory_id"] == "FOOD_DELIVERY"


def test_imps_credit_is_an_inflow():
    ledger = row("IMPS/123456789012 credited Rs 1500.00")
    assert ledger["flow"] == "IN"
    assert ledger["channel"] == "IMPS"
    assert ledger["payment_ref"] == "123456789012"


def test_atm_withdrawal_uses_the_cash_label():
    ledger = row("ATM WDL debited Rs 2000.00")
    assert ledger["flow"] == "OUT"
    assert ledger["channel"] == "ATM"
    assert ledger["clean_merchant"] == "ATM Cash Withdrawal"


def test_nach_mutual_fund_sip():
    ledger = row("NACH/HDFC MUTUAL FUND SIP debited Rs 2000.00")
    assert ledger["channel"] == "ACH_NACH"
    assert ledger["clean_merchant"] == "HDFC Mutual Fund"
    assert ledger["category_id"] == "FINANCIAL_SERVICES"
    assert ledger["subcategory_id"] == "SIP_AUTO_DEBIT"


def test_upi_subrails_gateway_and_card_network():
    peer = row("credited Rs 500.00 via UPI/P2P/rahul.sharma@okaxis")
    deferred = row("credited Rs 10.00 UPI/CR/429182736451/P2m Transactions Above Deferred")
    mandate = row("UPI MANDATE NETFLIX debited Rs 199.00")
    gateway = row("debited Rs 350.00 RAZORPAY*SWIGGY")
    card = row("VISA ECOM AMAZON debited Rs 1299.00")
    assert peer["channel"] == "UPI_P2P"
    assert deferred["channel"] == "UPI_P2M_DEFERRED"
    assert deferred["clean_merchant"] == "Merchant Payment"
    assert deferred["category_id"] == "PAYMENTS"
    assert deferred["subcategory_id"] == "MERCHANT_SETTLEMENT"
    assert mandate["channel"] == "UPI_MANDATE"
    assert mandate["clean_merchant"] == "Netflix"
    assert gateway["clean_merchant"] == "Swiggy"
    assert gateway["gateway"] == "Razorpay"
    assert gateway["legal_entity"] == "Bundl Technologies Private Limited"
    assert gateway["operating_country"] == "IN"
    assert card["channel"] == "CARD_ECOMMERCE"
    assert card["payment_network"] == "VISA"
    assert card["clean_merchant"] == "Amazon"


def test_brand_catalog_covers_groceries_travel_shopping_and_telecom():
    groceries = row("debited Rs 240.00 via UPI BLINKIT")
    travel = row("debited Rs 890.00 via UPI IRCTC")
    shopping = row("debited Rs 1299.00 via UPI AMAZON")
    telecom = row("debited Rs 399.00 via UPI JIO")
    assert (groceries["clean_merchant"], groceries["subcategory_id"]) == ("Blinkit", "GROCERIES_SUPERMARKET")
    assert (travel["clean_merchant"], travel["category_id"], travel["subcategory_id"]) == ("IRCTC", "TRAVEL", "TRAVEL_RAILWAYS")
    assert (shopping["clean_merchant"], shopping["subcategory_id"]) == ("Amazon", "ECOMMERCE")
    assert (telecom["clean_merchant"], telecom["subcategory_id"]) == ("Jio", "MOBILE_INTERNET")
