import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { anonymousApp, signToken } from "./auth-fixture.js";

const body = {
  financial_account_id: "018f5b2a-6c1e-7a3b-8d4e-5f6a7b8c9d0e",
  amount: "1250.50",
  currency: "INR",
  direction: "OUT",
  occurred_at: "2026-10-10T09:30:00Z",
  merchant_description: "Groceries",
  category_code: "FOOD",
  subcategory_code: "GROCERIES",
};

test("POST /v1/transactions/manual rejects a missing token", async () => {
  const app = await anonymousApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/transactions/manual",
    headers: { "idempotency-key": "key-1", "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "unauthorized" });
  await app.close();
});

test("POST /v1/transactions/manual rejects an expired token", async () => {
  const { token, options } = await signToken({ subject: "user-expired", expiresIn: "-1h" });
  const app = await buildApp(options);
  const response = await app.inject({
    method: "POST",
    url: "/v1/transactions/manual",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": "key-1", "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "unauthorized" });
  await app.close();
});

test("POST /v1/transactions/manual rejects an invalid token", async () => {
  const app = await anonymousApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/transactions/manual",
    headers: {
      authorization: "Bearer not-a-jwt",
      "idempotency-key": "key-1",
      "content-type": "application/json",
    },
    payload: JSON.stringify(body),
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "unauthorized" });
  await app.close();
});

test("POST /v1/transactions/manual rejects a revoked token", async () => {
  const { token, options } = await signToken({
    subject: "user-revoked",
    expiresIn: "1h",
    revokedSubjects: new Set(["user-revoked"]),
  });
  const app = await buildApp(options);
  const response = await app.inject({
    method: "POST",
    url: "/v1/transactions/manual",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": "key-1", "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "revoked" });
  await app.close();
});

test("POST /v1/transactions/manual rejects an invalid direction before any write", async () => {
  const { token, options } = await signToken({ subject: "user-ok", expiresIn: "1h" });
  let called = false;
  const app = await buildApp({
    ...options,
    manualTransactions: {
      async create() {
        called = true;
        throw new Error("must not be called");
      },
      async close() {},
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/transactions/manual",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "key-1",
      "content-type": "application/json",
      "x-monytix-owner-id": "owner-allowed",
    },
    payload: JSON.stringify({ ...body, direction: "EXPENSE" }),
  });
  assert.equal(response.statusCode, 422);
  assert.equal(called, false);
  const missingKey = await app.inject({
    method: "POST",
    url: "/v1/transactions/manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-monytix-owner-id": "owner-allowed",
    },
    payload: JSON.stringify(body),
  });
  assert.equal(missingKey.statusCode, 422);
  const badCurrency = await app.inject({
    method: "POST",
    url: "/v1/transactions/manual",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "key-2",
      "content-type": "application/json",
      "x-monytix-owner-id": "owner-allowed",
    },
    payload: JSON.stringify({ ...body, currency: "inr" }),
  });
  assert.equal(badCurrency.statusCode, 422);
  assert.equal(called, false);
  await app.close();
});
