import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import { buildApp, productionLogger } from "../src/app.js";
import { openPool } from "../src/db/pool.js";
import type { LedgerRead } from "../src/ledger/read.js";
import { signToken } from "./auth-fixture.js";

const ledger: LedgerRead = {
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

test("read routes reject missing, expired, malformed, and oversized requests", async () => {
  const signed = await signToken({ subject: "security-read", expiresIn: "1h" });
  const expired = await signToken({ subject: "security-expired", expiresIn: "-1h" });
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const app = await buildApp({
    ...signed.options,
    logger: { ...productionLogger(), stream },
    ledger,
    rateLimit: { limit: 3, windowMs: 60_000 },
  });
  const headers = {
    authorization: `Bearer ${signed.token}`,
    "content-type": "application/json",
    "x-monytix-owner-id": "owner-allowed",
    "x-request-id": "req-security-1",
  };

  const missing = await app.inject({ method: "GET", url: "/v1/transactions" });
  assert.equal(missing.statusCode, 401);
  const stale = await app.inject({
    method: "GET",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${expired.token}`, "x-monytix-owner-id": "owner-allowed" },
  });
  assert.equal(stale.statusCode, 401);
  const cursor = await app.inject({ method: "GET", url: "/v1/transactions?cursor=not-a-cursor", headers });
  assert.equal(cursor.statusCode, 422);
  assert.equal(cursor.headers["x-request-id"], "req-security-1");
  const malformed = await app.inject({
    method: "POST",
    url: "/v1/molybot/ask",
    headers,
    payload: JSON.stringify({ question: 12 }),
  });
  assert.equal(malformed.statusCode, 200);
  assert.equal(malformed.json().available, false);
  const first = await app.inject({ method: "GET", url: "/v1/accounts/summaries", headers });
  assert.equal(first.statusCode, 200);
  const limited = await app.inject({ method: "GET", url: "/v1/finance/overview", headers });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error, "rate_limited");
  const health = await app.inject({ method: "GET", url: "/platform/health" });
  assert.deepEqual(health.json(), { module: "platform", status: "ok" });
  const ready = await app.inject({
    method: "GET",
    url: "/platform/ready",
    headers: { "x-request-id": "ready-check-1" },
  });
  assert.equal(ready.statusCode, 503);
  assert.equal(ready.json().status, "unconfigured");
  assert.equal(ready.json().checks.database, "unconfigured");
  assert.equal(ready.json().checks.auth, "unconfigured");
  const logged = lines.join("");
  assert.equal(logged.includes(signed.token), false);
  await app.close();

  const sized = await buildApp({ ...signed.options, ledger, rateLimit: { limit: 20, windowMs: 60_000 } });
  const huge = await sized.inject({
    method: "POST",
    url: "/v1/molybot/ask",
    headers,
    payload: JSON.stringify({ question: "x".repeat(1_200_000) }),
  });
  assert.equal(huge.statusCode, 413);
  await sized.close();
});

test("an idle database client error does not escape the pool", () => {
  const pool = openPool("postgres://monytix_api:monytix_api_local@127.0.0.1:5432/monytix");
  assert.doesNotThrow(() => {
    pool.emit("error", Object.assign(new Error("connection reset"), { code: "57P01" }));
  });
  return pool.end();
});
