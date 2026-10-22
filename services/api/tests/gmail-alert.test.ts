import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTransactionFromEmail, spotIdempotencyKey } from "../src/gmail/alertParser.js";

const upiDebit = `
Dear Customer,
Your A/C ending 4321 has been debited by INR 350.00 on 18-Oct-2026 10:45:12
via UPI ref 429182736451 to Swiggy.
Avail Bal: INR 12,450.00.
`;

test("a UPI debit keeps the transaction amount and ignores the available balance", () => {
  const parsed = parseTransactionFromEmail(upiDebit);
  assert.equal(parsed?.flow, "DEBIT");
  assert.equal(parsed?.amount, "350.00");
  assert.equal(parsed?.accountLast4, "4321");
  assert.equal(parsed?.paymentRef, "429182736451");
  assert.equal(parsed?.channel, "UPI");
  assert.equal(parsed?.counterparty, "Swiggy");
  assert.equal(parsed?.postedAt, "2026-10-18T10:45:12+05:30");
  assert.equal(parsed?.rawExcerpt.includes("12,450.00"), true);
  assert.equal(spotIdempotencyKey("owner-1", parsed!, "msg-1"), "ref:429182736451");
});

test("a credit names the sender and a missing reference hashes the alert", () => {
  const parsed = parseTransactionFromEmail("INR 500.00 credited to your account from ACME Stores.");
  assert.equal(parsed?.flow, "CREDIT");
  assert.equal(parsed?.amount, "500.00");
  assert.equal(parsed?.channel, "OTHER");
  assert.equal(parsed?.counterparty, "ACME Stores");
  assert.equal(parsed?.paymentRef, undefined);
  assert.match(spotIdempotencyKey("owner-1", parsed!, "msg-1"), /^hash:[0-9a-f]{64}$/);
});

test("same amount on different gmail messages gets distinct hash keys", () => {
  const parsed = parseTransactionFromEmail("INR 50.00 debited via UPI to Coffee Shop on 21-Oct-2026.");
  assert.ok(parsed);
  const left = spotIdempotencyKey("owner-1", parsed!, "gmail-a");
  const right = spotIdempotencyKey("owner-1", parsed!, "gmail-b");
  assert.match(left, /^hash:/);
  assert.notEqual(left, right);
});

test("inward NEFT and refund of are treated as credits", () => {
  const neft = parseTransactionFromEmail("INR 25,000.00 Inward NEFT from Employer Pvt Ltd to A/C ending 4321 on 21-Oct-2026.");
  assert.equal(neft?.flow, "CREDIT");
  assert.equal(neft?.amount, "25000.00");
  const refund = parseTransactionFromEmail("Refund of INR 199.00 credited to your account from Amazon on 20-Oct-2026.");
  assert.equal(refund?.flow, "CREDIT");
  assert.equal(refund?.amount, "199.00");
});

test("html is readable and a balance-only notice is not a transaction", () => {
  const html = "<p>Your card ending 1111 was <b>credited</b> with INR 20.00 from Riya</p>";
  const parsed = parseTransactionFromEmail(html);
  assert.equal(parsed?.flow, "CREDIT");
  assert.equal(parsed?.amount, "20.00");
  assert.equal(parsed?.accountLast4, "1111");
  assert.equal(parsed?.channel, "CARD");
  assert.equal(parsed?.counterparty, "Riya");
  assert.equal(parseTransactionFromEmail("Your statement is ready"), null);
  assert.equal(parseTransactionFromEmail("Account debited. Avail Bal: INR 10.00"), null);
});

test("quoted-printable soft breaks and numeric html entities are decoded", () => {
  const body =
    "Your A/C ending 6544 has been debited by INR 59.00 via CARD to us: &#160; American Express Banking Corp.";
  const parsed = parseTransactionFromEmail(body);
  assert.equal(parsed?.channel, "CARD");
  assert.match(parsed?.counterparty ?? "", /American Express/i);
  assert.equal(parsed?.counterparty?.includes("&#160;"), false);

  const qp =
    "INR 1,044.00 was debited from A/C ending 4321 via UPI to Merchant=20Cafe on 20-Oct-2026.";
  const qpParsed = parseTransactionFromEmail(qp);
  assert.equal(qpParsed?.counterparty, "Merchant Cafe");
});

test("bank disclaimer boilerplate is not a spot transaction", () => {
  const disclaimer =
    "Beware of unauthorised and fraudule= nt calls. Never share your OTP. INR 1044.00 was debited.";
  assert.equal(parseTransactionFromEmail(disclaimer), null);
});

test("terminal VPA handles become a merchant label instead of the raw handle", () => {
  const body =
    "Your A/C ending 4321 has been debited by INR 27.00 on 21-Oct-2026 via UPI to 0f7c@pty.";
  const parsed = parseTransactionFromEmail(body);
  assert.equal(parsed?.channel, "UPI");
  assert.equal(parsed?.counterparty, "UPI merchant (@pty)");
  assert.equal(parsed?.counterparty.includes("0f7c@pty"), false);
});

test("OTP, login, and e-statement mail is not a spot even when the body has an amount", () => {
  const credited = "INR 500.00 has been credited to your account ending 6544.";
  assert.equal(parseTransactionFromEmail(credited, { subject: "Your OTP for netbanking" }), null);
  assert.equal(parseTransactionFromEmail(credited, { subject: "One Time Password" }), null);
  assert.equal(parseTransactionFromEmail(credited, { subject: "Your account statement is ready" }), null);
  assert.equal(parseTransactionFromEmail(credited, { subject: "Logged in to HDFC Bank" }), null);
  assert.equal(parseTransactionFromEmail(credited, { subject: "KYC update required" }), null);
  assert.equal(parseTransactionFromEmail("482913 is your OTP for HDFC Bank. INR 10.00 was credited."), null);
  assert.equal(parseTransactionFromEmail("You have successfully logged in to netbanking. INR 10.00 was credited."), null);
  assert.equal(parseTransactionFromEmail("Your CIBIL score is 750. INR 10.00 was credited to your account."), null);
});

test("a real debit with an OTP footer still names the merchant", () => {
  const body = `
Dear Customer, INR 2,076.00 has been debited from your HDFC Bank account ending in 6544
towards Swiggy on 21-Oct-2026. Avail Bal: INR 10,000.00.
Never share your OTP. Do not share this OTP with anyone.
We are here to support you in every step of the way.
`;
  const parsed = parseTransactionFromEmail(body, { subject: "Alert: INR 2076.00 debited" });
  assert.equal(parsed?.flow, "DEBIT");
  assert.equal(parsed?.amount, "2076.00");
  assert.equal(parsed?.counterparty, "Swiggy");
});

test("HDFC towards-merchant wins over footer support slogan", () => {
  const body = `
Dear Customer, INR 2,076.00 has been debited from your HDFC Bank account ending in 6544
towards Swiggy on 21-Oct-2026. Avail Bal: INR 10,000.00.
We are here to support you in every step of the way.
`;
  const parsed = parseTransactionFromEmail(body);
  assert.equal(parsed?.flow, "DEBIT");
  assert.equal(parsed?.amount, "2076.00");
  assert.equal(parsed?.accountLast4, "6544");
  assert.equal(parsed?.counterparty, "Swiggy");
  assert.equal(parsed?.counterparty.includes("support you"), false);
});

test("inward credit prefers sender over own account ending phrase", () => {
  const body = `
INR 5,000.00 credited to your HDFC Bank account ending in 6544 from ACME Payroll on 21-Oct-2026.
We are here to support you in every step of the way.
`;
  const parsed = parseTransactionFromEmail(body);
  assert.equal(parsed?.flow, "CREDIT");
  assert.equal(parsed?.amount, "5000.00");
  assert.equal(parsed?.counterparty, "ACME Payroll");
  assert.equal(/account ending in/i.test(parsed?.counterparty ?? ""), false);
});

test("footer-only to-support phrase does not become the merchant", () => {
  const body =
    "INR 99.00 debited via UPI on 21-Oct-2026. We are here to support you in every step of the way.";
  const parsed = parseTransactionFromEmail(body);
  assert.equal(parsed?.amount, "99.00");
  assert.equal(parsed?.counterparty, "General Spend");
});

test("HDFC towards-VPA parenthetical and card at-MERCHANT win", () => {
  const upi =
    "Rs.40.00 is debited from your account ending 6544 towards VPA vyapar.178518066034@hdfcbank (SIP AND PUFF ADDA) on 06-09-26.";
  const upiParsed = parseTransactionFromEmail(upi);
  assert.equal(upiParsed?.counterparty, "SIP AND PUFF ADDA");

  const card =
    "Rs.1649.00 is debited from your HDFC Bank Debit Card ending 1514 at APPLESERVICES on 02 Oct, 2026.";
  const cardParsed = parseTransactionFromEmail(card);
  assert.equal(cardParsed?.counterparty, "APPLESERVICES");
});

test("Paytm QR VPAs collapse to Paytm and soft-break slogans are rejected", () => {
  const paytm =
    "INR 120.00 debited via UPI to paytm-72650807@pty on 21-Oct-2026.";
  assert.equal(parseTransactionFromEmail(paytm)?.counterparty, "Paytm");

  const soft =
    "INR 50.00 debited via UPI to 0807@pty. We are here to support you in every st= ep of the way.";
  const softParsed = parseTransactionFromEmail(soft);
  assert.equal(softParsed?.counterparty, "UPI merchant (@pty)");
  assert.equal(/support you/i.test(softParsed?.counterparty ?? ""), false);

  const qVpa = "INR 10.00 debited via UPI to q739954992@ybl on 21-Oct-2026.";
  assert.equal(parseTransactionFromEmail(qVpa)?.counterparty, "UPI merchant (@ybl)");
});

test("the spot migration stages alerts and wakes the worker", () => {
  const migration = readFileSync(new URL("../../../database/migrations/0031_gmail_spot_transaction.sql", import.meta.url), "utf8");
  assert.match(migration, /core\.gmail_spot_transaction/);
  assert.match(migration, /pg_notify\('gmail_ingest'/);
  assert.match(migration, /initial_window_drained = false/);
  assert.match(migration, /not canonical ledger truth/);
});

test("promotion writes a positive ledger amount through a financial account", () => {
  const migration = readFileSync(new URL("../../../database/migrations/0032_gmail_spot_promote.sql", import.meta.url), "utf8");
  assert.match(migration, /ops\.promote_gmail_spot/);
  assert.match(migration, /INSERT INTO core\.financial_account/);
  assert.match(migration, /normalization_status, normalization_confidence/);
  assert.match(migration, /'READY', 1/);
  assert.match(migration, /v_spot\.amount, v_direction, 'INR'/);
  assert.match(migration, /THEN 'OUT' ELSE 'IN'/);
  assert.doesNotMatch(migration, /INSERT INTO accounts\b/);
  assert.doesNotMatch(migration, /normalisation_status/);
});

test("clean-title promote stores counterparty without channel slash prefix", () => {
  const migration = readFileSync(new URL("../../../database/migrations/0042_gmail_spot_promote_clean_title.sql", import.meta.url), "utf8");
  assert.match(migration, /GMAIL-SPOT-CLEAN-TITLE/);
  assert.match(migration, /v_title/);
  assert.match(migration, /GMAIL-SPOT-v2/);
  assert.doesNotMatch(migration, /concat_ws\(' \/ ', v_spot\.channel/);
});
