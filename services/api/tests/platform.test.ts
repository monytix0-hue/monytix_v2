import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("GET /platform/health returns the service health", async () => {
  const app = await buildApp();
  const response = await app.inject({ method: "GET", url: "/platform/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { module: "platform", status: "ok" });
  await app.close();
});
