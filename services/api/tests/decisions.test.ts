import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { anonymousApp, signToken } from "./auth-fixture.js";

test("GET /decisions rejects an anonymous caller", async () => {
  const app = await anonymousApp();
  const response = await app.inject({ method: "GET", url: "/decisions" });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "unauthorized" });
  await app.close();
});

test("GET /v1/ui/decisions is empty until a decision is published", async () => {
  const signed = await signToken({ subject: "decisions-read", expiresIn: "1h" });
  const app = await buildApp(signed.options);
  const response = await app.inject({
    method: "GET",
    url: "/v1/ui/decisions",
    headers: {
      authorization: `Bearer ${signed.token}`,
      "x-monytix-owner-id": "owner-allowed",
    },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    contract: string;
    empty_state: boolean;
    active_decision_count: number;
    heaviest: { available: boolean };
    decisions: unknown[];
  };
  assert.equal(body.contract, "ui-decisions-v0.1");
  assert.equal(body.empty_state, true);
  assert.equal(body.active_decision_count, 0);
  assert.equal(body.heaviest.available, false);
  assert.deepEqual(body.decisions, []);
  assert.equal(JSON.stringify(body).includes("4000"), false);
  await app.close();
});

test("GET /v1/ui/decisions refuses a caller without an owner", async () => {
  const signed = await signToken({ subject: "decisions-no-owner", expiresIn: "1h" });
  const app = await buildApp(signed.options);
  const response = await app.inject({
    method: "GET",
    url: "/v1/ui/decisions",
    headers: { authorization: `Bearer ${signed.token}` },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test("GET /v1/ui/decisions/:id/weights is not found when nothing is published", async () => {
  const signed = await signToken({ subject: "decision-weights", expiresIn: "1h" });
  const app = await buildApp(signed.options);
  const response = await app.inject({
    method: "GET",
    url: "/v1/ui/decisions/missing/weights",
    headers: {
      authorization: `Bearer ${signed.token}`,
      "x-monytix-owner-id": "owner-allowed",
    },
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "not_found" });
  await app.close();
});
