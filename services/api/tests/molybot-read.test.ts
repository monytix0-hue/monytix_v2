import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { LedgerRead, TransactionPage } from "../src/ledger/read.js";
import { signToken } from "./auth-fixture.js";

test("MolyBot refuses a partial loan answer when more than one page matches", async () => {
  const signed = await signToken({ subject: "molybot-limit", expiresIn: "1h" });
  const ledger: LedgerRead = {
    async transactionFilters() {
      return { categories: [] };
    },
    async listTransactions(input): Promise<TransactionPage> {
      if (input.eventFamily === "LOAN_REPAYMENT") {
        return { items: [], nextCursor: "more" };
      }
      return { items: [], nextCursor: null };
    },
    async accountSummaries() {
      return [];
    },
    async overview() {
      return { from: null, to: null, currencies: [] };
    },
    async insights() {
      return {
        uncategorised: 0,
        currency: null,
        totals: { credit: "0.00", debit: "0.00", categorisedOutflow: "0.00", uncategorisedOutflow: "0.00" },
        monthlySummary: [],
        spendingAnalysis: { categories: {} },
      };
    },
    async close() {},
  };
  const app = await buildApp({ ...signed.options, ledger });
  const response = await app.inject({
    method: "POST",
    url: "/v1/molybot/ask",
    headers: {
      authorization: `Bearer ${signed.token}`,
      "content-type": "application/json",
      "x-monytix-owner-id": "owner-allowed",
    },
    payload: JSON.stringify({ question: "What were my loan repayments?" }),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { available: boolean; complete: boolean; items: unknown[]; answer: string };
  assert.equal(body.available, false);
  assert.equal(body.complete, false);
  assert.deepEqual(body.items, []);
  assert.match(body.answer, /complete answer is not available/);
  await app.close();
});
