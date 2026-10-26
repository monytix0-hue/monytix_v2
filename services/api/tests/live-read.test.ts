import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { LedgerRead, TransactionPage } from "../src/ledger/read.js";
import { signToken } from "./auth-fixture.js";

const emptyPage: TransactionPage = { items: [], nextCursor: null };

function ledger(overrides: Partial<LedgerRead> = {}): LedgerRead {
  return {
    async listTransactions() {
      return emptyPage;
    },
    async transactionFilters() {
      return { categories: [] };
    },
    async accountSummaries() {
      return [];
    },
    async overview() {
      return { from: "2026-10-01", to: "2026-10-31", currencies: [] };
    },
    async close() {},
    ...overrides,
  };
}

test("GET /v1/live returns recorded flow and leaves unmapped widgets unavailable", async () => {
  const signed = await signToken({ subject: "live-read", expiresIn: "1h" });
  const app = await buildApp({
    ...signed.options,
    ledger: ledger({
      async overview() {
        return {
          from: "2026-10-01",
          to: "2026-10-31",
          currencies: [
            {
              currency: "INR",
              inflow: "1500.00",
              outflow: "400.00",
              ordinaryOutflow: "400.00",
              transactionCount: 2,
              events: [],
              uses: [],
              transactionsWithoutEvent: 0,
              transactionsWithoutUse: 0,
            },
          ],
        };
      },
      async listTransactions() {
        return {
          items: [
            {
              logicalTransactionId: "lt-1",
              canonicalTransactionVersionId: "cv-1",
              accountId: "ac-1",
              amount: "10.00",
              currency: "INR",
              direction: "OUT",
              transactionDate: "2026-10-02",
              description: null,
              duplicateOutcome: "UNIQUE",
              changeProvenance: "SOURCE",
              financialEvent: null,
              financialUse: null,
              party: null,
            },
          ],
          nextCursor: null,
        };
      },
    }),
  });
  const response = await app.inject({
    method: "GET",
    url: "/v1/live",
    headers: {
      authorization: `Bearer ${signed.token}`,
      "x-monytix-owner-id": "owner-allowed",
    },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    contract: string;
    recordedFlow: { available: boolean; currencies: Array<{ currency: string; inflow: string; outflow: string }> };
    transactions: { available: boolean; hasRecorded: boolean };
    needsContext: { available: boolean };
    missions: { available: boolean };
    decisions: { available: boolean };
    attention: { available: boolean };
    cashFlow: { available: boolean };
    weights: { available: boolean };
    mile: { available: boolean };
    greetingName: { available: boolean };
  };
  assert.equal(body.contract, "live-read-v0.1");
  assert.equal(body.recordedFlow.available, true);
  assert.deepEqual(body.recordedFlow.currencies, [{ currency: "INR", inflow: "1500.00", outflow: "400.00" }]);
  assert.equal(body.transactions.hasRecorded, true);
  assert.equal(body.needsContext.available, false);
  assert.equal(body.missions.available, false);
  assert.equal(body.decisions.available, false);
  assert.equal(body.attention.available, false);
  assert.equal(body.cashFlow.available, false);
  assert.equal(body.weights.available, false);
  assert.equal(body.mile.available, false);
  assert.equal(body.greetingName.available, false);
  assert.equal(JSON.stringify(body).includes("41400"), false);
  assert.equal(JSON.stringify(body).includes("Sandeep"), false);
  await app.close();
});

test("GET /v1/ui/live returns recorded money and leaves unpublished projections unavailable", async () => {
  const signed = await signToken({ subject: "ui-live", expiresIn: "1h" });
  const app = await buildApp({
    ...signed.options,
    ledger: ledger({
      async overview() {
        return {
          from: "2026-10-01",
          to: "2026-10-31",
          currencies: [
            {
              currency: "INR",
              inflow: "1500.00",
              outflow: "400.00",
              ordinaryOutflow: "400.00",
              transactionCount: 1,
              events: [],
              uses: [],
              transactionsWithoutEvent: 0,
              transactionsWithoutUse: 0,
            },
          ],
        };
      },
      async accountSummaries() {
        return [
          {
            accountId: "ac-1",
            displayName: null,
            currency: "INR",
            transactionCount: 1,
            totals: [],
            availableBalance: { amount: "2200.00", currency: "INR", observedAt: "2026-10-02T00:00:00.000Z" },
          },
        ];
      },
      async listTransactions() {
        return {
          items: [
            {
              logicalTransactionId: "lt-1",
              canonicalTransactionVersionId: "cv-1",
              accountId: "ac-1",
              amount: "10.00",
              currency: "INR",
              direction: "OUT",
              transactionDate: "2026-10-02",
              description: "Recorded row",
              accountName: "HDFC Bank credit card ending in 1044",
              weightName: "Opportunity",
              duplicateOutcome: "UNIQUE",
              changeProvenance: "SOURCE",
              financialEvent: null,
              financialUse: null,
              party: null,
            },
          ],
          nextCursor: null,
        };
      },
    }),
  });
  const response = await app.inject({
    method: "GET",
    url: "/v1/ui/live",
    headers: {
      authorization: `Bearer ${signed.token}`,
      "x-monytix-owner-id": "owner-allowed",
    },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    contract: string;
    recordedFlow: { available: boolean; currencies: Array<{ inflow: string }> };
    summary: { available_balance: { available: boolean; amount?: string; currency?: string } };
    transactions_preview: Array<{ id: string; amount: string | null; description: string | null; accountName: string | null; weightName: string | null }>;
    today_decisions: { available: boolean };
    weight_summary: { available: boolean };
    reflection_summary: { available: boolean };
    active_mission: { available: boolean };
    mile: { available: boolean };
  };
  assert.equal(body.contract, "ui-live-v0.1");
  assert.equal(body.recordedFlow.available, true);
  assert.equal(body.recordedFlow.currencies[0].inflow, "1500.00");
  assert.equal(body.summary.available_balance.available, true);
  assert.equal(body.summary.available_balance.amount, "2200.00");
  assert.equal(body.summary.available_balance.currency, "INR");
  assert.equal(body.transactions_preview.length, 1);
  assert.equal(body.transactions_preview[0].id, "lt-1");
  assert.equal(body.transactions_preview[0].accountName, "HDFC Bank credit card ending in 1044");
  assert.equal(body.transactions_preview[0].weightName, "Opportunity");
  assert.equal(body.today_decisions.available, false);
  assert.equal(body.weight_summary.available, false);
  assert.equal(body.reflection_summary.available, false);
  assert.equal(body.active_mission.available, false);
  assert.equal(body.mile.available, false);
  const text = JSON.stringify(body);
  assert.equal(text.includes("4000"), false);
  assert.equal(text.includes("Emergency"), false);
  await app.close();
});

test("GET /v1/ui/live leaves balance unavailable when more than one snapshot exists", async () => {
  const signed = await signToken({ subject: "ui-live-balances", expiresIn: "1h" });
  const app = await buildApp({
    ...signed.options,
    ledger: ledger({
      async accountSummaries() {
        return [
          {
            accountId: "ac-1",
            displayName: null,
            currency: "INR",
            transactionCount: 0,
            totals: [],
            availableBalance: { amount: "1.00", currency: "INR", observedAt: "2026-10-02T00:00:00.000Z" },
          },
          {
            accountId: "ac-2",
            displayName: null,
            currency: "INR",
            transactionCount: 0,
            totals: [],
            availableBalance: { amount: "2.00", currency: "INR", observedAt: "2026-10-02T00:00:00.000Z" },
          },
        ];
      },
    }),
  });
  const response = await app.inject({
    method: "GET",
    url: "/v1/ui/live",
    headers: {
      authorization: `Bearer ${signed.token}`,
      "x-monytix-owner-id": "owner-allowed",
    },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { summary: { available_balance: { available: boolean } } };
  assert.equal(body.summary.available_balance.available, false);
  await app.close();
});

test("GET /v1/live refuses a caller without an owner", async () => {
  const signed = await signToken({ subject: "live-no-owner", expiresIn: "1h" });
  const app = await buildApp({ ...signed.options, ledger: ledger() });
  const response = await app.inject({
    method: "GET",
    url: "/v1/live",
    headers: { authorization: `Bearer ${signed.token}` },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});
