import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { categoryForMerchant, cleanCounterparty, overlayParsedNarration, readNarration } from "../src/ingestion/bank-narration.js";

const fixtures: Array<[string, string, string | null, string | null, string | null]> = [
  ["HDFC", "UPI-SWIGGY-SWIGGY@HDFCBANK-HDFC0000240-428910293847-PAYMENT", "UPI", "428910293847", "SWIGGY"],
  ["HDFC", "UPI-428999888111-RAHUL SHARMA-HDFCBANK-TRANSFER", "UPI", "428999888111", "RAHUL SHARMA"],
  ["HDFC", "IMPS-P2A-401928374615-AMAZON PAY-HDFC", "IMPS", "401928374615", "AMAZON PAY"],
  ["HDFC", "NEFT CR-HDFC0000060-ZERODHA BROKING LTD-N102938475610293", "NEFT", "N102938475610293", "ZERODHA BROKING LTD"],
  ["HDFC", "POS 4111XXXXXXXX1234 STARBUCKS COFFEE MUMBAI", "POS", null, "STARBUCKS COFFEE"],
  ["HDFC", "ECOM 4111XXXXXXXX1234", "POS", null, null],
  ["HDFC", "NWD-ATM4019-BANDRA WEST MUMBAI", "ATM", "ATM4019", null],
  ["HDFC", "ACH D- HDFC00998811- HDFC MUTUAL FUND", "ACH", null, "HDFC MUTUAL FUND"],
  ["ICICI", "/UPI/412345678901/Zomato/zomato@icici/ICICI Bank", "UPI", "412345678901", "Zomato"],
  ["ICICI", "MMID/IMPS/419283746102/FLIPKART INTERNET", "IMPS", "419283746102", "FLIPKART INTERNET"],
  ["ICICI", "INF/NEFT/ICICN00192837461/TATA CONSULTANCY SERVICES/ICIC0000001", "NEFT", "ICICN00192837461", "TATA CONSULTANCY SERVICES"],
  ["ICICI", "INF/RTGS/ICICR00192837461/TATA CONSULTANCY SERVICES/ICIC0000001", "RTGS", "ICICR00192837461", "TATA CONSULTANCY SERVICES"],
  ["ICICI", "VPS/SHELL PETROL PUMP/BANGALORE/14-03-24", "POS", null, "SHELL PETROL PUMP"],
  ["ICICI", "NFS/CASH WDL/S1NA0012/KORAMANGALA BLR", "ATM", "S1NA0012", null],
  ["ICICI", "CMS/NACH/HDFC MUTUAL FUND", "NACH", null, "HDFC MUTUAL FUND"],
  ["SBI", "TRANSFER-UPI/DR/439281726354/PAYTM-MERCHANT/SBI", "UPI", "439281726354", "SBI"],
  ["SBI", "TRANSFER-INB IMPS429182736451/9876543210/DEEPAK", "IMPS", "429182736451", "9876543210"],
  ["SBI", "ATM WDL ATM S10A0091 MG ROAD BANGALORE", "ATM", "S10A0091", null],
  ["SBI", "POS DEBIT-RELIANCE SMART", "POS", null, "RELIANCE SMART"],
  ["SBI", "NEFT/SBIN123456789012/SALARY", "NEFT", "SBIN123456789012", "SALARY"],
  ["AXIS", "UPI/409182736451/Uber Rides/uber@axisbank/AXIS", "UPI", "409182736451", "Uber Rides"],
  ["AXIS", "IMPS/P2A/419283746192/RELIANCE RETAIL/UTIB", "IMPS", "419283746192", "RELIANCE RETAIL"],
  ["AXIS", "ECOM PUR/AMAZON INDIA/BANGALORE", "POS", null, "AMAZON INDIA"],
  ["AXIS", "POS PUR/CAFE COFFEE DAY", "POS", null, "CAFE COFFEE DAY"],
  ["AXIS", "EDC/SWIGGY", "POS", null, "SWIGGY"],
  ["AXIS", "NEFT AX1234567890ABCDEF ZERODHA BROKING", "NEFT", "1234567890ABCDEF", "ZERODHA BROKING"],
];

test("bank narration fixtures keep the channel, reference, and counterparty", () => {
  for (const [bank, narration, channel, reference, counterparty] of fixtures) {
    const hit = readNarration(narration, bank as "HDFC");
    assert.equal(hit?.channel_type, channel, narration);
    assert.equal(hit?.reference ?? null, reference, narration);
    assert.equal(hit?.counterparty ?? null, counterparty, narration);
    const overlaid = overlayParsedNarration(narration, { fields: {} }, bank as "HDFC");
    const fields = overlaid.fields as { counterparty_name?: string; payment_reference?: string; upi_rrn?: string };
    assert.equal(overlaid.channel_type, channel, narration);
    assert.equal(fields.counterparty_name ?? null, counterparty, narration);
    assert.equal(fields.payment_reference ?? null, reference, narration);
    if (channel === "UPI" && reference) {
      assert.equal(fields.upi_rrn, reference, narration);
    }
  }
  const ecommerce = readNarration("ECOM 4111XXXXXXXX1234", "HDFC");
  assert.equal(ecommerce?.sub_type, "CARD_ECOMMERCE");
  assert.equal(ecommerce?.reference, null);
  assert.equal(readNarration("ECOM PUR/AMAZON INDIA/BANGALORE", "AXIS")?.sub_type, "CARD_ECOMMERCE");
  assert.equal(readNarration("VPS/SHELL PETROL PUMP/BANGALORE/14-03-24", "ICICI")?.sub_type, "POS");
  assert.equal(readNarration("UPI/409182736451/Uber Rides/uber@axisbank/AXIS", "HDFC"), null);
  assert.equal(readNarration("RTGS HDFC0001 NAME", null)?.channel_type, "RTGS");
  assert.equal(readNarration("NFS CASH", null)?.channel_type, "ATM");
  assert.equal(readNarration("ECS/HDFC MUTUAL FUND", null)?.channel_type, "ACH");
  assert.equal(readNarration("NET BANKING TRANSFER", null)?.channel_type, "NET_BANKING");
  assert.equal(readNarration("INET-IMPS NET BANKING", null), null);
});

test("cleaned merchant names map onto the current category codes", () => {
  assert.equal(cleanCounterparty("SWIGGY@HDFCBANK"), "SWIGGY");
  assert.equal(cleanCounterparty("ZERODHA BROKING LTD"), "ZERODHA BROKING");
  assert.equal(cleanCounterparty("AMAZON PAYU MUMBAI"), "AMAZON");
  assert.equal(categoryForMerchant("SWIGGY"), "FOOD_DINING");
  assert.equal(categoryForMerchant("ZOMATO"), "FOOD_DINING");
  assert.equal(categoryForMerchant("STARBUCKS COFFEE"), "FOOD_DINING");
  assert.equal(categoryForMerchant("MCDONALDS"), "FOOD_DINING");
  assert.equal(categoryForMerchant("UBER"), "MOBILITY_TRANSPORT");
  assert.equal(categoryForMerchant("HPCL PETROL"), "MOBILITY_TRANSPORT");
  assert.equal(categoryForMerchant("IRCTC"), "TRAVEL");
  assert.equal(categoryForMerchant("AIRTEL"), "UTILITIES_COMMUNICATION");
  assert.equal(categoryForMerchant("AMAZON"), "SHOPPING_RETAIL");
  assert.equal(categoryForMerchant("NETFLIX"), "ENTERTAINMENT_MEDIA");
  assert.equal(categoryForMerchant("APOLLO PHARMACY"), "HEALTH_MEDICAL");
  assert.equal(categoryForMerchant("ZERODHA BROKING"), null);
  const migration = readFileSync(new URL("../../../database/migrations/0028_gmail_statement_pull.sql", import.meta.url), "utf8");
  assert.match(migration, /overlay_bank_narration/);
  assert.match(migration, /INF\/RTGS/);
  assert.match(migration, /IF patched IS DISTINCT FROM src THEN/);
  assert.equal(migration.includes("structure rail patch did not apply"), false);
  assert.equal(migration.includes("INSERT INTO core.investment_holding"), false);
  assert.equal(migration.includes("INSERT INTO core.insurance_policy"), false);
});
