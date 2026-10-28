import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { TransactionEditStore } from "../src/transactions/edit.js";
import { signToken } from "./auth-fixture.js";

const logicalId = "00000000-0000-4000-8000-000000000010";
const versionId = "00000000-0000-4000-8000-0000000000aa";
const nextVersionId = "00000000-0000-4000-8000-0000000000bb";

test("the correction migration appends a version and deletes without a table-level grant", () => {
  const migration = readFileSync(
    new URL("../../../database/migrations/0058_transaction_correction.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE OR REPLACE FUNCTION ops\.correct_transaction/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION ops\.set_movement_weight/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION ops\.delete_transaction/);
  assert.match(migration, /core\.activate_canonical_transaction_version/);
  assert.match(migration, /'USER_CORRECTION'/);
  assert.match(migration, /'USER_SELECTED'/);
  assert.match(migration, /actor_can_access_owner/);
  // The ledger stays immutable, so nothing may rewrite a canonical row in place.
  assert.equal(/UPDATE core\.canonical_transaction_version/.test(migration), false);
  // monytix_api holds no DELETE grant, so the delete must stay inside the function.
  assert.equal(/GRANT DELETE ON/.test(migration), false);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION ops\.delete_transaction\(uuid, uuid, uuid, text\) TO monytix_api/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION ops\.correct_transaction\([^)]*\) TO monytix_api/);
});

test("a correction must carry an idempotency key, an owner, and a uuid path", async () => {
  const signed = await signToken({ subject: "user-1", expiresIn: "1h" });
  signed.options.identity = {
    async provisionActor() {
      return { actorId: "actor-1" };
    },
    async resolveOwner(_actorId, requestedOwnerId) {
      return requestedOwnerId;
    },
    async ping() {},
    async close() {},
  };
  const calls: unknown[] = [];
  signed.options.transactionEdit = {
    async correct(input) {
      calls.push(input);
      return {
        outcome: "updated",
        body: {
          logical_transaction_id: input.logicalTransactionId,
          canonical_transaction_version_id: nextVersionId,
          superseded_version_id: versionId,
          version_no: 2,
          amount: "1500.00",
          direction: "OUT",
          occurred_at: "2026-10-09T00:00:00Z",
          description: "Rent",
          category_code: "HOUSING",
          subcategory_code: "RENT",
          weight_code: "W02",
        },
      };
    },
    async remove(input) {
      calls.push(input);
      return { outcome: "deleted", body: { logical_transaction_id: input.logicalTransactionId } };
    },
    async close() {},
  };
  const app = await buildApp({ ...signed.options, logger: false });
  try {
    const unauthorized = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers: { "idempotency-key": "k1" },
      payload: { amount: "10.00" },
    });
    assert.equal(unauthorized.statusCode, 401);

    const missingKey = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": "owner-1" },
      payload: { amount: "10.00" },
    });
    assert.equal(missingKey.statusCode, 422);

    const noOwner = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers: { authorization: `Bearer ${signed.token}`, "idempotency-key": "k1" },
      payload: { amount: "10.00" },
    });
    assert.equal(noOwner.statusCode, 403);
    assert.equal(calls.length, 0);

    const headers = {
      authorization: `Bearer ${signed.token}`,
      "idempotency-key": "k1",
      "x-monytix-owner-id": "owner-1",
    };

    const emptyBody = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers,
      payload: {},
    });
    assert.equal(emptyBody.statusCode, 422);

    const badAmount = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers,
      payload: { amount: "-5" },
    });
    assert.equal(badAmount.statusCode, 422);

    const badDirection = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers,
      payload: { direction: "SIDEWAYS" },
    });
    assert.equal(badDirection.statusCode, 422);

    const badDate = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers,
      payload: { occurred_at: "yesterday" },
    });
    assert.equal(badDate.statusCode, 422);

    const orphanSubcategory = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers,
      payload: { subcategory_id: "RENT" },
    });
    assert.equal(orphanSubcategory.statusCode, 422);

    const badPath = await app.inject({
      method: "PATCH",
      url: "/v1/transactions/not-a-uuid",
      headers,
      payload: { amount: "10.00" },
    });
    assert.equal(badPath.statusCode, 422);
    assert.equal(calls.length, 0);

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers,
      payload: {
        expected_version_id: versionId,
        amount: "1500.00",
        direction: "OUT",
        occurred_at: "2026-10-09T00:00:00Z",
        description: "Rent",
        category_id: "HOUSING",
        subcategory_id: "RENT",
        weight_code: "W02",
      },
    });
    assert.equal(updated.statusCode, 200);
    const body = updated.json();
    assert.equal(body.outcome, "updated");
    assert.equal(body.data.version_no, 2);
    assert.equal(body.data.canonical_transaction_version_id, nextVersionId);
    assert.deepEqual(calls[0], {
      actorId: "actor-1",
      ownerId: "owner-1",
      logicalTransactionId: logicalId,
      idempotencyKey: "k1",
      expectedVersionId: versionId,
      amount: "1500.00",
      direction: "OUT",
      occurredAt: "2026-10-09T00:00:00Z",
      description: "Rent",
      categoryCode: "HOUSING",
      subcategoryCode: "RENT",
      weightCode: "W02",
    });
  } finally {
    await app.close();
  }
});

test("stale versions, missing rows, and forbidden owners map to their own statuses", async () => {
  const signed = await signToken({ subject: "user-1", expiresIn: "1h" });
  signed.options.identity = {
    async provisionActor() {
      return { actorId: "actor-1" };
    },
    async resolveOwner(_actorId, requestedOwnerId) {
      return requestedOwnerId;
    },
    async ping() {},
    async close() {},
  };
  let outcome: Awaited<ReturnType<TransactionEditStore["correct"]>>["outcome"] = "stale";
  signed.options.transactionEdit = {
    async correct() {
      return { outcome };
    },
    async remove() {
      if (outcome === "missing") {
        return { outcome: "missing" };
      }
      if (outcome === "forbidden") {
        return { outcome: "forbidden" };
      }
      return { outcome: "deleted", body: { logical_transaction_id: logicalId } };
    },
    async close() {},
  };
  const app = await buildApp({ ...signed.options, logger: false });
  const headers = {
    authorization: `Bearer ${signed.token}`,
    "idempotency-key": "k1",
    "x-monytix-owner-id": "owner-1",
  };
  try {
    const stale = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers,
      payload: { amount: "10.00" },
    });
    assert.equal(stale.statusCode, 409);
    assert.deepEqual(stale.json(), { error: "stale_version" });

    outcome = "missing";
    const missing = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers,
      payload: { amount: "10.00" },
    });
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), { error: "not_found" });

    const deleteMissing = await app.inject({
      method: "DELETE",
      url: `/v1/transactions/${logicalId}`,
      headers,
    });
    assert.equal(deleteMissing.statusCode, 404);

    outcome = "forbidden";
    const forbidden = await app.inject({
      method: "DELETE",
      url: `/v1/transactions/${logicalId}`,
      headers,
    });
    assert.equal(forbidden.statusCode, 403);
    assert.deepEqual(forbidden.json(), { error: "owner_forbidden" });

    outcome = "incomplete";
    const incomplete = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers,
      payload: { amount: "10.00" },
    });
    assert.equal(incomplete.statusCode, 422);
    assert.deepEqual(incomplete.json(), { error: "incomplete_transaction" });

    outcome = "updated";
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/transactions/${logicalId}`,
      headers,
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().deleted, true);
    assert.equal(deleted.json().data.logical_transaction_id, logicalId);

    const noKey = await app.inject({
      method: "DELETE",
      url: `/v1/transactions/${logicalId}`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": "owner-1" },
    });
    assert.equal(noKey.statusCode, 422);
  } finally {
    await app.close();
  }
});

test("without an edit store the routes report themselves unavailable instead of crashing", async () => {
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
  signed.options.transactionEdit = null;
  const app = await buildApp({ ...signed.options, logger: false });
  try {
    const headers = {
      authorization: `Bearer ${signed.token}`,
      "idempotency-key": "k1",
      "x-monytix-owner-id": "owner-1",
    };
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers,
      payload: { amount: "10.00" },
    });
    assert.equal(patch.statusCode, 503);
    const remove = await app.inject({
      method: "DELETE",
      url: `/v1/transactions/${logicalId}`,
      headers,
    });
    assert.equal(remove.statusCode, 503);
  } finally {
    await app.close();
  }
});
