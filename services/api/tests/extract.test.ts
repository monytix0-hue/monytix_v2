import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractionReport } from "../src/imports/extract.js";

test("a locked PDF result is PASSWORD_REJECTED with no rows", () => {
  assert.deepEqual(extractionReport("PASSWORD_REJECTED", 0, false), {
    code: "PASSWORD_REJECTED",
    rows: 0,
  });
});

test("pending unlock reads extraction_run", () => {
  const sql = readFileSync(new URL("../../../database/migrations/0029_gmail_pending_unlock.sql", import.meta.url), "utf8");
  assert.match(sql, /core\.extraction_run/);
  assert.equal(sql.includes("statement_imports"), false);
});
