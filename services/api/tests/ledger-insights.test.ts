import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { LedgerRead, InsightsInput } from "../src/ledger/read.js";
import { signToken } from "./auth-fixture.js";

function ledger(overrides: Partial<LedgerRead> = {}): LedgerRead {
  const seen: InsightsInput[] = [];
  const base: LedgerRead = {
    async listTransactions() {
      return { items: [], nextCursor: null };
    },
    async transactionFilters() {
      return { categories: [], weights: [] };
    },
    async accountSummaries() {
      return [];
    },
    async overview() {
      return { from: null, to: null, currencies: [] };
    },
    async insights(input) {
      seen.push(input);
      return {
        uncategorised: 4,
        currency: input.currency,
        displayCurrency: input.displayCurrency ?? null,
        totals: { credit: "1200.00", debit: "800.00", categorisedOutflow: "500.00", uncategorisedOutflow: "300.00" },
        monthlySummary: [
          { month: "2026-10", credit: "1200.00", debit: "800.00", openingBalance: "600.00", closingBalance: "1000.00" },
          { month: "2026-09", credit: "900.00", debit: "300.00", openingBalance: "0.00", closingBalance: "600.00" },
        ],
        spendingAnalysis: {
          categories: {
            FOOD: { name: "Food", totalAmount: "500.00", subcategories: { GROCERIES: "300.00", DINING: "200.00" }, subcategoryNames: { GROCERIES: "Groceries", DINING: "Dining" } },
            none: { name: "Not recorded", totalAmount: "300.00", subcategories: {}, subcategoryNames: {} },
          },
        },
      };
    },
    async close() {},
  };
  return Object.assign(base, overrides);
}

test("GET /v1/ledger/insights returns summaries, spending analysis, and passes filters", async () => {
  const signed = await signToken({ subject: "ledger-insights", expiresIn: "1h" });
  const app = await buildApp({ ...signed.options, ledger: ledger() });
  const response = await app.inject({
    method: "GET",
    url: "/v1/ledger/insights?from=2026-09-01&to=2026-10-31&currency=INR",
    headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": "owner-allowed" },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    contract: string;
    uncategorised: number;
    currency: string;
    monthlySummary: Array<{ month: string; credit: string; debit: string; openingBalance: string; closingBalance: string }>;
    totals: { credit: string; debit: string; categorisedOutflow: string; uncategorisedOutflow: string };
    spendingAnalysis: { categories: Record<string, { totalAmount: string; subcategories: Record<string, string> }> };
  };
  assert.equal(body.contract, "ledger-insights-v0.1");
  assert.equal(body.uncategorised, 4);
  assert.equal(body.currency, "INR");
  assert.equal(body.monthlySummary.length, 2);
  assert.equal(body.monthlySummary[0].month, "2026-10");
  assert.equal(body.spendingAnalysis.categories.FOOD.subcategories.DINING, "200.00");
  assert.equal(body.spendingAnalysis.categories.none.totalAmount, "300.00");
  // The pie chart slices must reconcile with the recorded debit total.
  const pieTotal = Object.values(body.spendingAnalysis.categories).reduce((sum, row) => sum + Number(row.totalAmount), 0);
  assert.equal(pieTotal, Number(body.totals.debit));
  assert.equal(Number(body.totals.categorisedOutflow) + Number(body.totals.uncategorisedOutflow), Number(body.totals.debit));
  await app.close();
});

test("GET /v1/ledger/insights validates date and currency parameters", async () => {
  const signed = await signToken({ subject: "ledger-insights-invalid", expiresIn: "1h" });
  const app = await buildApp({ ...signed.options, ledger: ledger() });
  for (const url of [
    "/v1/ledger/insights?from=2026-9-1",
    "/v1/ledger/insights?to=yesterday",
    "/v1/ledger/insights?currency=rupee",
  ]) {
    const response = await app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": "owner-allowed" },
    });
    assert.equal(response.statusCode, 422, url);
  }
  await app.close();
});

test("GET /v1/ledger/insights requires an owner", async () => {
  const signed = await signToken({ subject: "ledger-insights-owner", expiresIn: "1h" });
  const app = await buildApp({ ...signed.options, ledger: ledger() });
  const response = await app.inject({
    method: "GET",
    url: "/v1/ledger/insights",
    headers: { authorization: `Bearer ${signed.token}` },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test("display_currency is passed through to the read model", async () => {
  const signed = await signToken({ subject: "ledger-insights-display", expiresIn: "1h" });
  const seen: InsightsInput[] = [];
  const app = await buildApp({
    ...signed.options,
    ledger: ledger({
      async insights(input) {
        seen.push(input);
        return {
          uncategorised: 0,
          currency: input.currency,
          displayCurrency: input.displayCurrency ?? null,
          totals: { credit: "0.00", debit: "0.00", categorisedOutflow: "0.00", uncategorisedOutflow: "0.00" },
          monthlySummary: [],
          spendingAnalysis: { categories: {} },
        };
      },
    }),
  });
  const response = await app.inject({
    method: "GET",
    url: "/v1/ledger/insights?currency=INR&display_currency=USD",
    headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": "owner-allowed" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(seen[0].currency, "INR");
  assert.equal(seen[0].displayCurrency, "USD");
  await app.close();
});

test("an invalid display_currency is rejected like any other currency", async () => {
  const signed = await signToken({ subject: "ledger-insights-display-bad", expiresIn: "1h" });
  const app = await buildApp({ ...signed.options, ledger: ledger() });
  const response = await app.inject({
    method: "GET",
    url: "/v1/ledger/insights?display_currency=dollars",
    headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": "owner-allowed" },
  });
  assert.equal(response.statusCode, 422);
  await app.close();
});

test("the owner's home currency is used when no display_currency is named", async () => {
  const signed = await signToken({ subject: "ledger-insights-home", expiresIn: "1h" });
  const seen: InsightsInput[] = [];
  const app = await buildApp({
    ...signed.options,
    ledger: ledger({
      async insights(input) {
        seen.push(input);
        return {
          uncategorised: 0,
          currency: input.currency,
          displayCurrency: input.displayCurrency ?? null,
          totals: { credit: "0.00", debit: "0.00", categorisedOutflow: "0.00", uncategorisedOutflow: "0.00" },
          monthlySummary: [],
          spendingAnalysis: { categories: {} },
        };
      },
    }),
    preferences: {
      async read() {
        return {
          defaultCurrencyCode: "EUR",
          timezoneName: "Europe/Berlin",
          countryCode: "DE",
          locale: "de-DE",
          updatedAt: null,
        };
      },
      async heldCurrencies() {
        return ["INR"];
      },
      async write() {
        throw new Error("not used");
      },
      async close() {},
    },
  });
  const response = await app.inject({
    method: "GET",
    url: "/v1/ledger/insights",
    headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": "owner-allowed" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(seen[0].displayCurrency, "EUR");
  await app.close();
});

test("GET /v1/finance/overview accepts display_currency alongside the booked filter", async () => {
  const signed = await signToken({ subject: "finance-overview-display", expiresIn: "1h" });
  const seen: Array<{ currency: string | null; displayCurrency?: string | null }> = [];
  const app = await buildApp({
    ...signed.options,
    ledger: ledger({
      async overview(input) {
        seen.push({ currency: input.currency, displayCurrency: input.displayCurrency });
        return { from: input.from, to: input.to, displayCurrency: input.displayCurrency ?? null, currencies: [] };
      },
    }),
  });
  const response = await app.inject({
    method: "GET",
    url: "/v1/finance/overview?currency=INR&display_currency=USD",
    headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": "owner-allowed" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen[0], { currency: "INR", displayCurrency: "USD" });
  await app.close();
});
