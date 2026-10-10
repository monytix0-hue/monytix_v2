import assert from "node:assert/strict";
import test from "node:test";
import { anonymousApp } from "./auth-fixture.js";

test("GET /sources rejects an anonymous caller", async () => {
  const app = await anonymousApp();
  const response = await app.inject({ method: "GET", url: "/sources" });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "unauthorized" });
  await app.close();
});
