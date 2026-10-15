import assert from "node:assert/strict";
import test from "node:test";
import { redactedPaths } from "../src/app.js";
import { statementPasswordFromBody } from "../src/imports/routes.js";

test("a statement password is required, bounded, and redacted", () => {
  assert.equal(statementPasswordFromBody({ statement_password: "  bank-secret  " }), "bank-secret");
  assert.equal(statementPasswordFromBody({ statement_password: "" }), null);
  assert.equal(statementPasswordFromBody({ statement_password: "x".repeat(129) }), null);
  assert.equal(statementPasswordFromBody({ password: "bank-secret" }), null);
  assert.equal(redactedPaths.includes("*.statement_password"), true);
});
