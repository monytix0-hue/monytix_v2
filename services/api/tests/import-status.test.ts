import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractionFailureFields } from "../src/imports/store.js";

const root = new URL("../../../", import.meta.url);

test("import status names a stored extraction failure and an empty parse", () => {
  assert.deepEqual(extractionFailureFields({
    extraction_status: "FAILED",
    extraction_failure: "PASSWORD_REJECTED",
  }), {
    extraction_status: "FAILED",
    extraction_failure: "PASSWORD_REJECTED",
    stage: "FAILED PASSWORD_REJECTED",
  });
  assert.deepEqual(extractionFailureFields({
    extraction_status: "FAILED",
    extraction_failure: null,
  }), {
    extraction_status: "FAILED",
    extraction_failure: "NO_ROWS",
    stage: "FAILED no rows",
  });
  assert.equal(extractionFailureFields({ extraction_status: "COMPLETED" }).stage, undefined);
});

test("the API service receives the Gmail connect settings", () => {
  const compose = readFileSync(new URL("docker-compose.yml", root), "utf8");
  const migration = readFileSync(new URL("database/migrations/0026_extraction_failure.sql", root), "utf8");
  for (const name of [
    "GMAIL_CLIENT_ID",
    "GMAIL_CLIENT_SECRET",
    "GMAIL_REDIRECT_URI",
    "GMAIL_TOKEN_URI",
    "GMAIL_TOKEN_ENCRYPTION_KEY",
  ]) {
    assert.match(compose, new RegExp(`${name}:\\s\\$\\{${name}:-\\}`));
  }
  assert.match(migration, /reason_codes\[1\]/);
  assert.match(migration, /'NO_ROWS'/);
  assert.match(migration, /'extraction_failure', v_failure/);
});
