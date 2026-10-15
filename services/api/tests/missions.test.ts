import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { anonymousApp, signToken } from "./auth-fixture.js";

test("GET /missions rejects an anonymous caller", async () => {
  const app = await anonymousApp();
  const response = await app.inject({ method: "GET", url: "/missions" });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "unauthorized" });
  await app.close();
});

test("GET /v1/ui/missions is empty until a mission is published", async () => {
  const signed = await signToken({ subject: "missions-read", expiresIn: "1h" });
  const app = await buildApp(signed.options);
  const response = await app.inject({
    method: "GET",
    url: "/v1/ui/missions",
    headers: {
      authorization: `Bearer ${signed.token}`,
      "x-monytix-owner-id": "owner-allowed",
    },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    contract: string;
    empty_state: boolean;
    active_mission_count: number;
    summary: { available: boolean };
    active: unknown[];
    completed: unknown[];
  };
  assert.equal(body.contract, "ui-missions-v0.1");
  assert.equal(body.empty_state, true);
  assert.equal(body.active_mission_count, 0);
  assert.equal(body.summary.available, false);
  assert.deepEqual(body.active, []);
  assert.deepEqual(body.completed, []);
  assert.equal(JSON.stringify(body).includes("Goa"), false);
  await app.close();
});

test("GET /v1/ui/missions refuses a caller without an owner", async () => {
  const signed = await signToken({ subject: "missions-no-owner", expiresIn: "1h" });
  const app = await buildApp(signed.options);
  const response = await app.inject({
    method: "GET",
    url: "/v1/ui/missions",
    headers: { authorization: `Bearer ${signed.token}` },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test("mission detail, journal, and completion are not found when nothing is published", async () => {
  const signed = await signToken({ subject: "mission-detail", expiresIn: "1h" });
  const app = await buildApp(signed.options);
  const headers = {
    authorization: `Bearer ${signed.token}`,
    "x-monytix-owner-id": "owner-allowed",
  };
  for (const url of [
    "/v1/ui/missions/missing",
    "/v1/ui/missions/missing/journal",
    "/v1/ui/missions/missing/completion",
  ]) {
    const response = await app.inject({ method: "GET", url, headers });
    assert.equal(response.statusCode, 404, url);
    assert.deepEqual(response.json(), { error: "not_found" });
  }
  await app.close();
});
