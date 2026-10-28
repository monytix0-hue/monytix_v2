import assert from "node:assert/strict";
import test from "node:test";
import { parseTransactionFromEmail, postedAtFromText } from "../src/gmail/alertParser.js";
import { localePackByCode, resolveLocalePack, searchQueryFor } from "../src/gmail/locales/index.js";
import { readDueDate } from "../src/gmail/reminders.js";

test("a German card alert parses with German vocabulary and a comma decimal", () => {
  const pack = resolveLocalePack({ country: "DE" });
  const parsed = parseTransactionFromEmail(
    "Ihre Kreditkarte wurde am 12.03.2026 mit 1.234,56 EUR bei REWE Markt belastet. Neuer Saldo: 4.567,89 EUR.",
    { locale: pack, defaultCurrency: "EUR", country: "DE" },
  );
  assert.ok(parsed);
  assert.equal(parsed.flow, "DEBIT");
  assert.equal(parsed.amount, "1234.56");
  assert.equal(parsed.currency, "EUR");
  assert.equal(parsed.currencyBasis, "EXPLICIT_ISO");
});

test("a German alert without a currency code still needs the German pack", () => {
  const body = "Ihre Kreditkarte wurde am 12.03.2026 mit 1.234,56 bei REWE Markt belastet.";
  const german = parseTransactionFromEmail(body, {
    locale: resolveLocalePack({ country: "DE" }),
    defaultCurrency: "EUR",
  });
  assert.ok(german);
  assert.equal(german.amount, "1234.56");
  assert.equal(german.currency, "EUR");
  // No symbol and no ISO code, so the currency is the owner default and must be
  // flagged for review rather than silently trusted.
  assert.equal(german.currencyBasis, "OWNER_DEFAULT");

  // The Indian pack cannot read it at all, which is the point of separate packs.
  assert.equal(
    parseTransactionFromEmail(body, { locale: resolveLocalePack({ country: "IN" }), defaultCurrency: "INR" }),
    null,
  );
});

test("a French alert reads the currency written after the number", () => {
  const pack = resolveLocalePack({ country: "FR" });
  const parsed = parseTransactionFromEmail(
    "Votre carte a été débitée de 45,90 EUR chez CARREFOUR le 05/04/2026.",
    { locale: pack, defaultCurrency: "EUR", country: "FR" },
  );
  assert.ok(parsed);
  assert.equal(parsed.flow, "DEBIT");
  assert.equal(parsed.amount, "45.90");
  assert.equal(parsed.currency, "EUR");
});

test("a Spanish alert resolves pesos from the country, not from the euro sign", () => {
  const pack = resolveLocalePack({ country: "MX" });
  const parsed = parseTransactionFromEmail(
    "Se ha debitado $1,250.00 de su tarjeta terminada en 4321 en OXXO el 12/03/2026.",
    { locale: pack, defaultCurrency: "MXN", country: "MX", accountCurrency: "MXN" },
  );
  assert.ok(parsed);
  assert.equal(parsed.amount, "1250.00");
  assert.equal(parsed.currency, "MXN");
});

test("a Portuguese alert stays in Brazilian reais", () => {
  const pack = resolveLocalePack({ country: "BR" });
  const parsed = parseTransactionFromEmail(
    "Compra aprovada no cartão terminado em 4321 no valor de R$ 89,90 em PADARIA SAO JOSE em 12/03/2026.",
    { locale: pack, defaultCurrency: "BRL", country: "BR" },
  );
  assert.ok(parsed);
  assert.equal(parsed.flow, "DEBIT");
  assert.equal(parsed.amount, "89.90");
  assert.equal(parsed.currency, "BRL");
});

test("an indian mailbox keeps the en-IN pack and its IST default", () => {
  const pack = resolveLocalePack({ country: "IN" });
  assert.equal(pack.code, "en-IN");
  assert.equal(pack.defaultTimezone, "Asia/Kolkata");
  assert.ok(pack.vpaPattern);

  const parsed = parseTransactionFromEmail(
    "Your A/C ending 4321 has been debited by INR 350.00 on 18-Oct-2026 10:45:12 via UPI ref 429182736451 to Swiggy.",
    { locale: pack },
  );
  assert.ok(parsed);
  assert.equal(parsed.postedAt, "2026-10-18T10:45:12+05:30");
});

test("the owner timezone overrides the market default", () => {
  assert.equal(
    postedAtFromText("debited on 18-Oct-2026 10:45:12", "Europe/London", localePackByCode("en-IN")),
    "2026-10-18T10:45:12+01:00",
  );
  assert.equal(
    postedAtFromText("debited on 18-Oct-2026 10:45:12", "America/New_York", localePackByCode("en-IN")),
    "2026-10-18T10:45:12-04:00",
  );
});

test("an unknown locale falls back to the historical Indian pack", () => {
  assert.equal(resolveLocalePack({ country: "ZZ", locale: "xx-YY" }).code, "en-IN");
  assert.equal(resolveLocalePack({}).code, "en-IN");
});

test("the language resolves when the country has no pack", () => {
  assert.equal(resolveLocalePack({ country: "NL", locale: "de-NL" }).code, "de");
  assert.equal(resolveLocalePack({ locale: "pt-PT" }).code, "pt");
});

test("the gmail query follows the locale and stays bounded", () => {
  const german = searchQueryFor(resolveLocalePack({ country: "DE" }));
  assert.match(german, /belastet/);
  assert.match(german, /newer_than:365d/);

  const indian = searchQueryFor(resolveLocalePack({ country: "IN" }));
  assert.match(indian, /UPI/);
  assert.ok(indian.length < 400);
});

test("a due notice carries its own currency and locale", () => {
  const pack = resolveLocalePack({ country: "DE" });
  const due = readDueDate("Zahlung fällig am 15.04.2026. Betrag 1.234,56 EUR.", {
    locale: pack,
    defaultCurrency: "EUR",
    country: "DE",
  });
  assert.ok(due);
  assert.equal(due.amount, "1234.56");
  assert.equal(due.currency, "EUR");
  assert.equal(due.dueDate, "2026-04-15");
});
