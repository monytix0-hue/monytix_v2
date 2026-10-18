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
  assert.equal(spotIdempotencyKey("owner-1", parsed!), "ref:429182736451");
});

test("a credit names the sender and a missing reference hashes the alert", () => {
  const parsed = parseTransactionFromEmail("INR 500.00 credited to your account from ACME Stores.");
  assert.equal(parsed?.flow, "CREDIT");
  assert.equal(parsed?.amount, "500.00");
  assert.equal(parsed?.channel, "OTHER");
  assert.equal(parsed?.counterparty, "ACME Stores");
  assert.equal(parsed?.paymentRef, undefined);
  assert.match(spotIdempotencyKey("owner-1", parsed!), /^hash:[0-9a-f]{64}$/);
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

test("the spot migration stages alerts and wakes the worker", () => {
  const migration = readFileSync(new URL("../../../database/migrations/0031_gmail_spot_transaction.sql", import.meta.url), "utf8");
  assert.match(migration, /core\.gmail_spot_transaction/);
  assert.match(migration, /pg_notify\('gmail_ingest'/);
  assert.match(migration, /initial_window_drained = false/);
  assert.match(migration, /not canonical ledger truth/);
});
