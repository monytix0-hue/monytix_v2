import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("a statement binds one personal account before mapping and can clear an unresolved row", () => {
  const migration = readFileSync(new URL("../../../database/migrations/0027_statement_account_bind.sql", import.meta.url), "utf8");
  const extract = readFileSync(new URL("../src/imports/extract.ts", import.meta.url), "utf8");
  const decisions = readFileSync(new URL("../src/decisions/routes.ts", import.meta.url), "utf8");
  assert.match(migration, /ops\.bind_statement_for_mapping/);
  assert.match(migration, /'SAVINGS', 'Personal account', 'INR'/);
  assert.match(migration, /v_count > 1/);
  assert.match(migration, /ACCOUNT_UNRESOLVED/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION ops\.bind_statement_for_mapping\(uuid\) TO monytix_api/);
  assert.equal(extract.includes("SELECT ops.bind_statement_for_mapping($1::uuid)"), true);
  const bindAt = extract.indexOf("bind_statement_for_mapping");
  const mapAt = extract.indexOf("map_statement_extraction");
  assert.ok(bindAt > 0 && bindAt < mapAt);
  assert.equal(decisions.includes("decisions: []"), true);
  assert.equal(decisions.includes("app.patch"), false);
  assert.equal(decisions.includes("app.delete"), false);
});
