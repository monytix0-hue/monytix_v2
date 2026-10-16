import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { CategoryChoiceResult } from "../src/transactions/category.js";
import { signToken } from "./auth-fixture.js";

test("category correction is one owner-scoped function and the route returns its body", async () => {
  const migration = readFileSync(new URL("../../../database/migrations/0028_gmail_statement_pull.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE OR REPLACE FUNCTION ops\.set_transaction_category/);
  assert.match(migration, /actor_can_access_owner/);
  assert.match(migration, /F10E-v1\.2/);
  assert.match(migration, /ix_category_choice_owner_token_explicit/);
  assert.equal(migration.includes("UPDATE intel.category_resolution"), false);
  assert.equal(migration.includes("DELETE FROM intel.category_resolution"), false);
  assert.equal(migration.includes("is_user_overridden"), false);

  const signed = await signToken({ subject: "user-1", expiresIn: "1h" });
  signed.options.identity = {
    async provisionActor() {
      return { actorId: "actor-1" };
    },
    async resolveOwner() {
      return "owner-1";
    },
    async ping() {},
    async close() {},
  };
  const calls: Array<{ applyToPast: boolean; matchScope: string }> = [];
  signed.options.categoryChoices = {
    async set(input) {
      calls.push({ applyToPast: input.applyToPast, matchScope: input.matchScope });
      const body: CategoryChoiceResult["body"] = {
        updated_transaction: { id: input.logicalTransactionId, category_id: input.categoryId, counterparty: "SWIGGY" },
        rule_created: { match_token: "SWIGGY", category_id: input.categoryId },
        retroactive_count: input.applyToPast ? 2 : 0,
      };
      return { outcome: "updated", body };
    },
    async close() {},
  };
  const app = await buildApp(signed.options);
  const logicalId = "00000000-0000-4000-8000-000000000010";
  const missing = await app.inject({
    method: "PATCH",
    url: `/v1/transactions/${logicalId}/category`,
    headers: { authorization: `Bearer ${signed.token}` },
    payload: {},
  });
  assert.equal(missing.statusCode, 400);

  const updated = await app.inject({
    method: "PATCH",
    url: `/v1/transactions/${logicalId}/category`,
    headers: { authorization: `Bearer ${signed.token}` },
    payload: { category_id: "FOOD_DINING", apply_to_past: true },
  });
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(updated.json(), {
    updated_transaction: { id: logicalId, category_id: "FOOD_DINING", counterparty: "SWIGGY" },
    rule_created: { match_token: "SWIGGY", category_id: "FOOD_DINING" },
    retroactive_count: 2,
  });
  assert.deepEqual(calls, [{ applyToPast: true, matchScope: "EXACT_MERCHANT" }]);
  await app.close();
});
