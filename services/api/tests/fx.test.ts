import assert from "node:assert/strict";
import test from "node:test";
import { buildFxReader, type RateSource } from "../src/money/fx.js";

/** EUR-based quotes only, the way `finance.fx_rates` stores them. */
function fakeSource(quotes: Record<string, Array<[string, number]>>, manual: Record<string, Array<[string, number]>> = {}): RateSource {
  return {
    latest: async (code, date) => {
      const candidates = [
        ...(manual[code] ?? []).map(([d, r]) => ({ d, r, source: "manual_fx_rates", priority: 0 })),
        ...(quotes[code] ?? []).map(([d, r]) => ({ d, r, source: "fx_rates", priority: 1 })),
      ].filter((row) => row.d <= date);
      if (candidates.length === 0) return null;
      candidates.sort((left, right) => (left.d === right.d ? left.priority - right.priority : left.d < right.d ? 1 : -1));
      const best = candidates[0]!;
      return { rate: best.r, rateDate: best.d, source: best.source };
    },
  };
}

const quotes = {
  USD: [["2026-03-01", 1.08], ["2026-02-01", 1.07]] as Array<[string, number]>,
  INR: [["2026-03-01", 90.0]] as Array<[string, number]>,
  GBP: [["2026-03-01", 0.85]] as Array<[string, number]>,
};

test("a direct ECB pair converts through EUR", async () => {
  const fx = buildFxReader(fakeSource(quotes));
  // EUR->INR 90.0 / EUR->USD 1.08 = 83.33 INR per USD
  const result = await fx.convert(14, "USD", "INR", "2026-03-05");
  assert.ok(result.ok);
  assert.equal(result.rate.toFixed(4), "83.3333");
  assert.equal(result.amount, "1166.67");
  assert.equal(result.rateDate, "2026-03-01");
});

test("the latest row on or before the date is used", async () => {
  const fx = buildFxReader(fakeSource(quotes));
  const early = await fx.rate("EUR", "USD", "2026-02-15");
  assert.ok(early.ok);
  assert.equal(early.rate.rate, 1.07);
  assert.equal(early.rate.rateDate, "2026-02-01");
});

test("the cross rate takes the older of the two leg dates", async () => {
  const fx = buildFxReader(fakeSource({
    USD: [["2026-03-01", 1.08]],
    INR: [["2026-02-20", 90.0]],
  }));
  const result = await fx.rate("USD", "INR", "2026-03-05");
  assert.ok(result.ok);
  assert.equal(result.rate.rateDate, "2026-02-20");
});

test("a missing pair is flagged, never substituted with 1.0", async () => {
  const fx = buildFxReader(fakeSource({ USD: [["2026-03-01", 1.08]] }));
  const result = await fx.convert(100, "USD", "INR", "2026-03-05");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "missing_rate");
  }
});

test("same currency is an identity conversion with no lookup", async () => {
  let called = false;
  const fx = buildFxReader({
    latest: async () => {
      called = true;
      return { rate: 1, rateDate: "2026-03-01", source: "fx_rates" };
    },
  });
  const result = await fx.convert(1180, "INR", "INR", "2026-03-05");
  assert.ok(result.ok);
  assert.equal(result.amount, "1180.00");
  assert.equal(called, false);
});

test("manual rates win for pegged currencies the ECB does not quote", async () => {
  const manual = { AED: [["2026-03-01", 4.02]] as Array<[string, number]> };
  const fx = buildFxReader(fakeSource({ INR: [["2026-03-01", 90.0]] }, manual));
  const result = await fx.convert(100, "AED", "INR", "2026-03-05");
  assert.ok(result.ok);
  // One leg is an ECB quote and the other a pinned rate, so the cross reports both.
  assert.equal(result.source, "mixed");
  assert.equal(result.amount, (100 * (90 / 4.02)).toFixed(2));
});

test("an updated manual rate beats a stale ECB quote on the same date", async () => {
  const manual = { AED: [["2026-03-01", 4.02]] as Array<[string, number]> };
  const fx = buildFxReader(fakeSource({ AED: [["2026-03-01", 3.67]] }, manual));
  const result = await fx.rate("EUR", "AED", "2026-03-05");
  assert.ok(result.ok);
  assert.equal(result.rate.rate, 4.02);
  assert.equal(result.rate.source, "manual_fx_rates");
});

test("repeated lookups are served from the bounded cache", async () => {
  let calls = 0;
  const fx = buildFxReader({
    latest: async (code) => {
      calls += 1;
      return { rate: quotes[code as "USD"]?.[0]?.[1] ?? 1, rateDate: "2026-03-01", source: "fx_rates" };
    },
  });
  await fx.rate("USD", "INR", "2026-03-05");
  const before = calls;
  await fx.rate("USD", "INR", "2026-03-05");
  assert.equal(calls, before);
});

test("malformed codes are rejected instead of querying", async () => {
  const fx = buildFxReader(fakeSource(quotes));
  const result = await fx.rate("US", "INR", "2026-03-05");
  assert.equal(result.ok, false);
});
