import assert from "node:assert/strict";
import test from "node:test";
import { databaseUrl, parseEnv } from "../src/env.js";

test("env parser keeps the first equals and skips comments", () => {
  const pairs = parseEnv("# comment\n\nFIREBASE_PROJECT_ID=monytix\nDATABASE_URL=postgres://user:p=a@host/db\n");
  assert.deepEqual(pairs, [
    ["FIREBASE_PROJECT_ID", "monytix"],
    ["DATABASE_URL", "postgres://user:p=a@host/db"],
  ]);
});

test("finance database url prefers an explicit override", () => {
  assert.equal(databaseUrl({ FINANCE_DATABASE_URL: "postgres://finance", DATABASE_URL: "postgres://shared" }), "postgres://finance");
  assert.equal(databaseUrl({ DATABASE_URL: "postgres://shared" }), "postgres://shared");
});
