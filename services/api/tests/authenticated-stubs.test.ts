import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { signToken } from "./auth-fixture.js";

const routes = [
  ["/users", "users"],
  ["/accounts", "accounts"],
  ["/transactions", "transactions"],
  ["/sources", "sources"],
  ["/statements", "statements"],
  ["/personal", "personal"],
  ["/business", "business"],
  ["/decisions", "decisions"],
  ["/missions", "missions"],
  ["/nudges", "nudges"],
  ["/projections", "projections"],
] as const;

test("authenticated GET routes still return module stubs", async () => {
  const { token, options } = await signToken({ subject: "user-ok", expiresIn: "1h" });
  const app = await buildApp(options);
  for (const [url, module] of routes) {
    const response = await app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 200, url);
    assert.deepEqual(response.json(), { module, status: "stub" });
  }
  await app.close();
});
