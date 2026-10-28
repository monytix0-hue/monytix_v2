import assert from "node:assert/strict";
import test from "node:test";
import { buildFxReader, type FxReader, type RateSource } from "../src/money/fx.js";
import { convertRows, landedCostText, moneyText } from "../src/ledger/display.js";

/**
 * A rate source with a hole in it, so the "report the gap, never substitute"
 * rule is exercised rather than assumed.
 */
function fakeSource(rates: Record<string, Record<string, number>>): RateSource {
  return {
    async latest(code, date) {
      const table = rates[code];
      if (!table) return null;
      const candidates = Object.keys(table).filter((day) => day <= date).sort();
      const day = candidates.at(-1);
      if (!day) return null;
      return { rate: table[day], rateDate: day, source: "fx_rates" };
    },
  };
}

/** EUR -> USD, EUR -> INR, and nothing at all for AED. */
function reader(): FxReader {
  return buildFxReader(fakeSource({
    USD: { "2026-09-01": 1.10, "2026-10-01": 1.20 },
    INR: { "2026-09-01": 90, "2026-10-01": 84 },
  }));
}

test("convertRows converts each row at its own date, not at one spot rate", async () => {
  const fx = reader();
  const result = await convertRows(fx, [
    { amount: 100, currency: "USD", date: "2026-09-15" },
    { amount: 84_000, currency: "INR", date: "2026-10-15" },
  ], "EUR");
  // 100 USD at 1.10 -> 90.909..., then 84,000 INR at 84 -> 1,000 EUR.
  assert.equal(result.complete, true);
  assert.equal(result.missingRows, 0);
  assert.equal(result.total, 1090.91);
  // A single spot rate for the quarter would not produce this number: the two
  // rows were converted through different rate dates.
  assert.deepEqual(result.converted.map((row) => row.rateDate), ["2026-09-01", "2026-10-01"]);
});

test("convertRows treats a matching currency as identity without a rate lookup", async () => {
  const fx = reader();
  const result = await convertRows(fx, [{ amount: 250.5, currency: "INR", date: "2026-10-03" }], "INR");
  assert.equal(result.complete, true);
  assert.equal(result.total, 250.5);
  assert.equal(result.converted[0].rateDate, "2026-10-03");
});

test("convertRows reports a missing rate instead of substituting 1.0", async () => {
  const fx = reader();
  const result = await convertRows(fx, [
    { amount: 500, currency: "AED", date: "2026-10-15" },
    { amount: 100, currency: "USD", date: "2026-10-15" },
  ], "EUR");
  assert.equal(result.complete, false);
  assert.equal(result.missingRows, 1);
  // The unquoted row contributes nothing rather than silently adding 500.
  assert.equal(result.total, 83.33);
  assert.deepEqual(result.gaps, [{ from: "AED", to: "EUR", date: "2026-10-15", reason: "missing_rate" }]);
});

test("convertRows flags a row with no date rather than converting at today's rate", async () => {
  const fx = reader();
  const result = await convertRows(fx, [{ amount: 10, currency: "USD", date: null }], "EUR");
  assert.equal(result.complete, false);
  assert.equal(result.missingRows, 1);
  assert.equal(result.total, 0);
  assert.equal(result.gaps[0].date, "unknown");
});

test("a converted total reconciles: legs sum to the total, and formatting matches the ledger", async () => {
  const fx = reader();
  const rows = [
    { amount: 100, currency: "USD", date: "2026-10-15" },
    { amount: 100, currency: "USD", date: "2026-10-16" },
    { amount: 84, currency: "INR", date: "2026-10-16" },
  ];
  const result = await convertRows(fx, rows, "EUR");
  const legs = result.converted.reduce((sum, row) => sum + row.amount, 0);
  assert.equal(result.complete, true);
  assert.equal(moneyText(result.total), result.total.toFixed(2));
  assert.ok(Math.abs(legs - result.total) < 0.01);
});

test("landedCostText includes the forex markup and its tax", () => {
  // A pie chart built on the BASE leg alone would understate this by 350.
  const landed = landedCostText(10_000, 300, 50, "INR");
  assert.equal(landed.baseAmount, "10000.00");
  assert.equal(landed.fcyMarkup, "300.00");
  assert.equal(landed.gstTax, "50.00");
  assert.equal(landed.totalLanded, "10350.00");
  assert.equal(landed.currency, "INR");
});
