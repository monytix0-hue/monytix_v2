import assert from "node:assert/strict";
import test from "node:test";
import { identifyBank, identifyInstitution, institutions, senderCountry, statementBanks } from "../src/gmail/institutions.js";
import { normalizeDate } from "../src/ingestion/dates.js";

test("an Indian bank still resolves to its narration overlay", () => {
  const match = identifyInstitution("statement.pdf", "no-reply@hdfcbank.com");
  assert.ok(match);
  assert.equal(match.code, "HDFC");
  assert.equal(match.countryCode, "IN");
  assert.equal(match.statementBank, "HDFC");
  assert.equal(match.basis, "sender-domain");
  assert.equal(identifyBank("statement.pdf", "no-reply@hdfcbank.com"), "HDFC");
});

test("the sender domain beats a filename token", () => {
  // A file named after one bank, sent by another, must follow the sender.
  const match = identifyInstitution("icici-estatement.pdf", "alerts@hdfcbank.com");
  assert.ok(match);
  assert.equal(match.code, "HDFC");
});

test("an international sender resolves country without claiming a narration overlay", () => {
  const match = identifyInstitution("", "no-reply@alertsp.chase.com");
  assert.ok(match);
  assert.equal(match.code, "CHASE");
  assert.equal(match.countryCode, "US");
  // No hand-written overlay exists for Chase, so it parses generically.
  assert.equal(match.statementBank, null);
  assert.equal(identifyBank("", "no-reply@alertsp.chase.com"), null);
  assert.equal(senderCountry("no-reply@alertsp.chase.com"), "US");
});

test("a subdomain of a multi-label public suffix still matches", () => {
  assert.equal(senderCountry("alerts@ealerts.bankofamerica.com"), "US");
  assert.equal(senderCountry("statements@icicibank.co.in"), "IN");
});

test("British and German senders produce their own country", () => {
  assert.equal(senderCountry("alerts@monzomail.com"), "GB");
  assert.equal(senderCountry("service@n26.com"), "DE");
  assert.equal(senderCountry("avisos@bbva.es"), "ES");
  assert.equal(senderCountry("contato@nubank.com.br"), "BR");
});

test("an unrecognised mailbox resolves to nothing rather than a guess", () => {
  assert.equal(identifyInstitution("statement.pdf", "someone@example.org"), null);
  assert.equal(senderCountry("someone@example.org"), null);
});

test("two competing bank tokens are not decisive", () => {
  // `hdfc` and `icici` in one address is contradictory evidence.
  assert.equal(identifyInstitution("statement.pdf", "hdfc.icici@example.org"), null);
});

test("only the four overlaid banks are exported as statement banks", () => {
  assert.deepEqual(statementBanks, ["HDFC", "ICICI", "SBI", "AXIS"]);
  const overlaid = institutions.filter((entry) => entry.statementBank !== null).map((entry) => entry.code);
  assert.deepEqual(overlaid.sort(), [...statementBanks].sort());
});

test("every institution declares a two-letter country and at least one domain", () => {
  for (const entry of institutions) {
    assert.match(entry.countryCode, /^[A-Z]{2}$/, `${entry.code} country`);
    assert.ok(entry.domains.length > 0, `${entry.code} domains`);
    assert.ok(entry.tokens.length > 0, `${entry.code} tokens`);
  }
});

test("institution codes are unique so the map cannot silently drop one", () => {
  const codes = institutions.map((entry) => entry.code);
  assert.equal(new Set(codes).size, codes.length);
});

test("a month-first date resolves from the owner locale but day-first wins when forced", () => {
  // 03/04/2026 is ambiguous: March 4 in the US, 3 April elsewhere.
  assert.deepEqual(normalizeDate("03/04/2026", { monthFirst: true }), { value: "2026-03-04", resolved: true });
  assert.deepEqual(normalizeDate("03/04/2026", { monthFirst: false }), { value: "2026-04-03", resolved: true });
  // The default stays day-first, so existing statements do not shift.
  assert.deepEqual(normalizeDate("03/04/2026"), { value: "2026-04-03", resolved: true });
});

test("the numbers themselves outrank the locale setting", () => {
  // 15 cannot be a month, so this is day-first even in a month-first locale.
  assert.deepEqual(normalizeDate("15/03/2026", { monthFirst: true }), { value: "2026-03-15", resolved: true });
  // 25 cannot be a month, so this is month-first even in a day-first locale.
  assert.deepEqual(normalizeDate("03/25/2026", { monthFirst: false }), { value: "2026-03-25", resolved: true });
});

test("a month-first locale does not turn a named month into a failure", () => {
  assert.deepEqual(normalizeDate("15/Mar/2026", { monthFirst: true }), { value: "2026-03-15", resolved: true });
});
