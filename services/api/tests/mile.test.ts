import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { anonymousApp, signToken } from "./auth-fixture.js";

const sample = ["426", "Emergency Buffer", "5029", "1284", "18400", "LAST 3 MONTHS", "2026"];

test("GET /v1/mile/summary rejects an anonymous caller", async () => {
  const app = await anonymousApp();
  const response = await app.inject({ method: "GET", url: "/v1/mile/summary" });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("GET /v1/mile/summary is empty until a mile is published", async () => {
  const signed = await signToken({ subject: "mile-read", expiresIn: "1h" });
  const app = await buildApp(signed.options);
  const response = await app.inject({
    method: "GET",
    url: "/v1/mile/summary",
    headers: {
      authorization: `Bearer ${signed.token}`,
      "x-monytix-owner-id": "owner-allowed",
    },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    contract: string;
    empty_state: boolean;
    period: { available: boolean };
    distance: { available: boolean };
    months: unknown[];
    impact: { available: boolean };
    outcomes: unknown[];
    movement: { available: boolean };
    report: { available: boolean };
    lifetime: { available: boolean };
  };
  assert.equal(body.contract, "mile-summary-v0.1");
  assert.equal(body.empty_state, true);
  assert.equal(body.period.available, false);
  assert.equal(body.distance.available, false);
  assert.deepEqual(body.months, []);
  assert.equal(body.impact.available, false);
  assert.deepEqual(body.outcomes, []);
  assert.equal(body.movement.available, false);
  assert.equal(body.report.available, false);
  assert.equal(body.lifetime.available, false);
  const encoded = JSON.stringify(body);
  for (const phrase of sample) {
    assert.equal(encoded.includes(phrase), false, phrase);
  }
  await app.close();
});

test("GET /v1/mile/events is empty and a missing event is not found", async () => {
  const signed = await signToken({ subject: "mile-events", expiresIn: "1h" });
  const app = await buildApp(signed.options);
  const headers = {
    authorization: `Bearer ${signed.token}`,
    "x-monytix-owner-id": "owner-allowed",
  };
  const list = await app.inject({ method: "GET", url: "/v1/mile/events", headers });
  assert.equal(list.statusCode, 200);
  const body = list.json() as { contract: string; events: unknown[] };
  assert.equal(body.contract, "mile-events-v0.1");
  assert.deepEqual(body.events, []);
  const detail = await app.inject({ method: "GET", url: "/v1/mile/events/missing", headers });
  assert.equal(detail.statusCode, 404);
  assert.deepEqual(detail.json(), { error: "not_found" });
  await app.close();
});

test("M.I.L.E. reads refuse a caller without an owner", async () => {
  const signed = await signToken({ subject: "mile-no-owner", expiresIn: "1h" });
  const app = await buildApp(signed.options);
  const headers = { authorization: `Bearer ${signed.token}` };
  for (const url of ["/v1/mile/summary", "/v1/mile/events", "/v1/mile/events/missing"]) {
    const response = await app.inject({ method: "GET", url, headers });
    assert.equal(response.statusCode, 403, url);
  }
  await app.close();
});
