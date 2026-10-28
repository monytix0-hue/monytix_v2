import assert from "node:assert/strict";
import test from "node:test";
import { classifySeparators, findAmounts, normalizeDigits, parseNumericToken } from "../src/money/parse.js";
import { countryFromSender, detectCurrency, needsReview, readMoney } from "../src/money/detect.js";

test("decimal mark is the last separator", () => {
  assert.equal(parseNumericToken("1.234,56")?.value, 1234.56);
  assert.equal(parseNumericToken("1,234.56")?.value, 1234.56);
  assert.equal(parseNumericToken("1.50")?.value, 1.5);
  assert.equal(parseNumericToken("1,500")?.value, 1500);
});

test("indian lakh grouping does not become a decimal", () => {
  assert.equal(parseNumericToken("1,50,000.00")?.value, 150000);
  assert.equal(classifySeparators("1,50,000"), "unknown");
});

test("european grouping with a decimal comma", () => {
  assert.equal(parseNumericToken("1.234.567,89")?.value, 1234567.89);
  assert.equal(classifySeparators("1.234,56"), "comma");
});

test("non-latin digits fold before parsing", () => {
  assert.equal(normalizeDigits("١٢٣٤"), "1234");
  assert.equal(normalizeDigits("१२३४"), "1234");
  assert.equal(parseNumericToken("٤٥٠")?.value, 450);
});

test("adjacent figures are not merged across whitespace", () => {
  const hits = findAmounts("Your card was charged USD 14.00 and posted INR 1,180.00");
  assert.deepEqual(hits.map((hit) => hit.amount), ["14.00", "1180.00"]);
});

test("a bare reference number is not money", () => {
  const hits = findAmounts("Ref 123456789012 credited");
  assert.equal(hits.length, 0);
});

test("explicit ISO beats a stray THE", () => {
  const detection = detectCurrency({ text: "THE AMOUNT IS USD 14.00 AT THE STORE" });
  assert.equal(detection.code, "USD");
  assert.equal(detection.basis, "EXPLICIT_ISO");
});

test("non-currency three letter tokens are ignored", () => {
  const detection = detectCurrency({ text: "VPA THE ATM TXN OF ALL", ownerDefaultCurrency: "INR" });
  assert.equal(detection.code, "INR");
  assert.equal(detection.basis, "OWNER_DEFAULT");
});

test("every dollar variant resolves from country, not a hardcoded USD", () => {
  assert.equal(detectCurrency({ text: "You spent $25.00", institutionCountry: "US" }).code, "USD");
  assert.equal(detectCurrency({ text: "You spent $25.00", senderAddress: "alerts@rbc.ca" }).code, "CAD");
  assert.equal(detectCurrency({ text: "You spent A$25.00" }).code, "AUD");
  assert.equal(detectCurrency({ text: "You spent CA$25.00" }).code, "CAD");
  assert.equal(detectCurrency({ text: "You spent SG$25.00" }).code, "SGD");
  assert.equal(detectCurrency({ text: "You spent HK$25.00" }).code, "HKD");
  assert.equal(detectCurrency({ text: "You spent NZ$25.00" }).code, "NZD");
  assert.equal(detectCurrency({ text: "You spent MX$25.00" }).code, "MXN");
  assert.equal(detectCurrency({ text: "You spent R$25.00" }).code, "BRL");
});

test("a dollar in a non-dollar country does not assert a code", () => {
  const detection = detectCurrency({
    text: "You spent $25.00",
    institutionCountry: "IN",
    ownerDefaultCurrency: "INR",
  });
  assert.equal(detection.code, "INR");
  assert.equal(detection.basis, "TLD_OR_COUNTRY");
  assert.equal(needsReview(detection), true);
});

test("rupee sign separates India from Pakistan by country signal", () => {
  assert.equal(detectCurrency({ text: "Rs ₹1,180 debited", institutionCountry: "IN" }).code, "INR");
  assert.equal(detectCurrency({ text: "Rs ₹1,180 debited", institutionCountry: "PK" }).code, "PKR");
});

test("unambiguous symbols survive without any country", () => {
  assert.equal(detectCurrency({ text: "You paid £12.99" }).code, "GBP");
  assert.equal(detectCurrency({ text: "You paid €12,99" }).code, "EUR");
  assert.equal(detectCurrency({ text: "You paid ₩12000" }).code, "KRW");
  assert.equal(detectCurrency({ text: "You paid ฿450" }).code, "THB");
  assert.equal(detectCurrency({ text: "You paid ₦4,500" }).code, "NGN");
});

test("sender tld resolves the country", () => {
  assert.equal(countryFromSender("alerts@hdfcbank.co.in"), "IN");
  assert.equal(countryFromSender("alerts@bank.de"), "DE");
  assert.equal(countryFromSender("alerts@bank.co.uk"), "GB");
  assert.equal(countryFromSender("not-an-address"), null);
});

test("low confidence asks for review instead of guessing", () => {
  assert.equal(needsReview(detectCurrency({ text: "amount debited" })), true);
  assert.equal(needsReview(detectCurrency({ text: "USD 14 debited" })), false);
});

test("a card alert splits booked from stated", () => {
  const reading = readMoney(
    "Your card ending 1234 was charged USD 14.00 on 12 Mar. A total of INR 1,180.00 has been debited from your account.",
    { text: "", accountCurrency: "INR", ownerDefaultCurrency: "INR" },
  );
  assert.ok(reading);
  assert.equal(reading.booked.amount, "1180.00");
  assert.equal(reading.booked.currency.code, "INR");
  assert.equal(reading.stated?.amount, "14.00");
  assert.equal(reading.stated?.currency.code, "USD");
});

test("a single currency alert has no stated pair", () => {
  const reading = readMoney("INR 1,180.00 debited from your account", {
    text: "",
    accountCurrency: "INR",
    ownerDefaultCurrency: "INR",
  });
  assert.ok(reading);
  assert.equal(reading.stated, null);
});
