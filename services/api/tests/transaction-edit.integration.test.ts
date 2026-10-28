import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { createPgIdentity } from "../src/auth/identity.js";
import { createFirebaseVerifier } from "../src/auth/verifier.js";
import { createManualTransactionStore } from "../src/transactions/manual.js";
import { createTransactionEditStore } from "../src/transactions/edit.js";
import { testKeys, testProjectId } from "./auth-fixture.js";

const apiUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const enabled = Boolean(apiUrl && adminUrl);

if (!enabled) {
  test("transaction edit integration requires Postgres 17", { skip: true }, () => {});
} else {
  const subject = `m2-edit-user-${Date.now()}`;
  let actorId = "";
  let owner = "";
  let otherOwner = "";
  let account = "";
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";

  test.before(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      const actor = await admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", subject, null],
      );
      actorId = actor.rows[0].provision_authenticated_actor;
      const owners = await admin.query<{ owner_id: string; display_name: string }>(
        `INSERT INTO core.owner (owner_type, display_name)
         VALUES ('PERSON', 'M2 Edit Owner'), ('PERSON', 'M2 Edit Other')
         RETURNING owner_id, display_name`,
      );
      owner = owners.rows.find((row) => row.display_name === "M2 Edit Owner")!.owner_id;
      otherOwner = owners.rows.find((row) => row.display_name === "M2 Edit Other")!.owner_id;
      const accounts = await admin.query<{ financial_account_id: string }>(
        `INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
         VALUES ('SAVINGS', 'M2 Edit Account', 'INR', 'ACTIVE')
         RETURNING financial_account_id`,
      );
      account = accounts.rows[0].financial_account_id;
      await admin.query(
        `INSERT INTO core.account_ownership (
           owner_id, financial_account_id, relationship_role, verification_state, relationship_status, verification_source
         ) VALUES ($1, $2, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE', 'M2-2')`,
        [owner, account],
      );
      await admin.query(
        `INSERT INTO core.actor_owner_membership (
           actor_id, owner_id, membership_role, membership_status, is_default_owner
         ) VALUES ($1, $2, 'OWNER', 'ACTIVE', true)`,
        [actorId, owner],
      );
    } finally {
      await admin.end();
    }
    const keys = await testKeys();
    token = await new SignJWT({ auth_time: Math.floor(Date.now() / 1000) })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(subject)
      .setIssuer(`https://securetoken.google.com/${testProjectId}`)
      .setAudience(testProjectId)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keys.privateKey);
    const verify = await createFirebaseVerifier({
      projectId: testProjectId,
      publicKeyPem: keys.publicKeyPem,
    });
    app = await buildApp({
      logger: false,
      auth: { configured: true, verify },
      identity: createPgIdentity(apiUrl!),
      manualTransactions: createManualTransactionStore(apiUrl!),
      transactionEdit: createTransactionEditStore(apiUrl!),
    });
  });

  test.after(async () => {
    if (app) {
      await app.close();
    }
  });

  test("a correction appends version n + 1 and keeps the old one", async () => {
    const created = await create(app, token, owner, account, "300.00");
    assert.equal(created.statusCode, 201);
    const logicalId = created.json().data.logical_transaction_id as string;
    const firstVersion = created.json().data.canonical_transaction_version_id as string;

    const corrected = await correct(app, token, owner, logicalId, "edit-1", {
      expected_version_id: firstVersion,
      amount: "450.75",
      direction: "IN",
      occurred_at: "2026-09-21T00:00:00Z",
      description: "Corrected rent refund",
    });
    assert.equal(corrected.statusCode, 200);
    const body = corrected.json().data;
    assert.equal(body.version_no, 2);
    assert.equal(body.superseded_version_id, firstVersion);
    assert.equal(body.amount, "450.75");
    assert.equal(body.direction, "IN");
    assert.notEqual(body.canonical_transaction_version_id, firstVersion);

    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      const versions = await admin.query<{ version_no: number; is_current: boolean; change_provenance: string; amount: string }>(
        `SELECT version_no, is_current, change_provenance, amount::text
           FROM core.canonical_transaction_version
          WHERE logical_transaction_id = $1
          ORDER BY version_no`,
        [logicalId],
      );
      assert.equal(versions.rowCount, 2);
      assert.equal(versions.rows[0].version_no, 1);
      assert.equal(versions.rows[0].is_current, false);
      assert.equal(versions.rows[0].change_provenance, "INITIAL");
      assert.equal(versions.rows[1].version_no, 2);
      assert.equal(versions.rows[1].is_current, true);
      assert.equal(versions.rows[1].change_provenance, "USER_CORRECTION");
      assert.equal(Number(versions.rows[1].amount), 450.75);

      const current = await admin.query<{ current_canonical_version_id: string }>(
        "SELECT current_canonical_version_id FROM core.logical_transaction WHERE logical_transaction_id = $1",
        [logicalId],
      );
      assert.equal(current.rows[0].current_canonical_version_id, body.canonical_transaction_version_id);

      const outbox = await admin.query(
        `SELECT 1 FROM ops.outbox_event
          WHERE aggregate_id = $1 AND semantic_trigger_code = 'TRANSACTION_CORRECTED'`,
        [logicalId],
      );
      assert.ok((outbox.rowCount ?? 0) >= 1);
    } finally {
      await admin.end();
    }
  });

  test("the corrected amount and date show up on the ledger", async () => {
    const created = await create(app, token, owner, account, "12.00");
    const logicalId = created.json().data.logical_transaction_id as string;
    const corrected = await correct(app, token, owner, logicalId, "edit-list", {
      amount: "77.25",
      occurred_at: "2026-08-02T00:00:00Z",
      description: "Listed after correction",
      direction: "OUT",
    });
    assert.equal(corrected.statusCode, 200);

    const page = await app.inject({
      method: "GET",
      url: "/v1/transactions",
      headers: { authorization: `Bearer ${token}`, "x-monytix-owner-id": owner },
    });
    assert.equal(page.statusCode, 200);
    const item = page.json().items.find((row: { logicalTransactionId: string }) => row.logicalTransactionId === logicalId);
    assert.ok(item, "corrected movement is listed");
    assert.equal(Number(item.amount), 77.25);
    assert.equal(item.direction, "OUT");
    assert.equal(item.transactionDate, "2026-08-02");
    assert.equal(item.changeProvenance, "USER_CORRECTION");
    assert.equal(item.canonicalTransactionVersionId, corrected.json().data.canonical_transaction_version_id);
  });

  test("a stale expected version writes nothing", async () => {
    const created = await create(app, token, owner, account, "20.00");
    const logicalId = created.json().data.logical_transaction_id as string;
    const staleVersion = created.json().data.canonical_transaction_version_id as string;
    const first = await correct(app, token, owner, logicalId, "edit-a", { amount: "21.00" });
    assert.equal(first.statusCode, 200);

    const stale = await correct(app, token, owner, logicalId, "edit-b", {
      expected_version_id: staleVersion,
      amount: "99.00",
    });
    assert.equal(stale.statusCode, 409);
    assert.deepEqual(stale.json(), { error: "stale_version" });

    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      const rows = await admin.query<{ amount: string; version_no: number }>(
        `SELECT amount::text, version_no
           FROM core.canonical_transaction_version
          WHERE logical_transaction_id = $1
          ORDER BY version_no DESC`,
        [logicalId],
      );
      assert.equal(rows.rows[0].version_no, 2);
      assert.equal(Number(rows.rows[0].amount), 21);
    } finally {
      await admin.end();
    }
  });

  test("a user-selected weight survives a later category change", async () => {
    const created = await create(app, token, owner, account, "60.00");
    const logicalId = created.json().data.logical_transaction_id as string;

    const weighted = await correct(app, token, owner, logicalId, "edit-weight", { weight_code: "W02" });
    assert.equal(weighted.statusCode, 200);

    const recategorised = await correct(app, token, owner, logicalId, "edit-cat", {
      category_id: "FOOD_DINING",
      subcategory_id: "GROCERIES",
    });
    assert.equal(recategorised.statusCode, 200);

    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      const weight = await admin.query<{ primary_weight_code: string; reason_code: string }>(
        `SELECT primary_weight_code::text, reason_code
           FROM core.movement_weight
          WHERE logical_transaction_id = $1`,
        [logicalId],
      );
      assert.equal(weight.rowCount, 1);
      assert.equal(weight.rows[0].primary_weight_code, "W02");
      assert.equal(weight.rows[0].reason_code, "USER_SELECTED");
    } finally {
      await admin.end();
    }
  });

  test("a delete removes the movement and keeps the ingestion source as audit", async () => {
    const created = await create(app, token, owner, account, "31.00");
    const logicalId = created.json().data.logical_transaction_id as string;

    const sourceRows = await sourceRecordIds(logicalId);
    assert.equal(sourceRows.length, 1);
    const sourceRecordId = sourceRows[0];

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/transactions/${logicalId}`,
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "delete-1",
        "x-monytix-owner-id": owner,
      },
    });
    assert.equal(removed.statusCode, 200);
    assert.equal(removed.json().deleted, true);

    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      const logical = await admin.query(
        "SELECT 1 FROM core.logical_transaction WHERE logical_transaction_id = $1",
        [logicalId],
      );
      assert.equal(logical.rowCount, 0);
      const versions = await admin.query(
        "SELECT 1 FROM core.canonical_transaction_version WHERE logical_transaction_id = $1",
        [logicalId],
      );
      assert.equal(versions.rowCount, 0);
      const source = await admin.query<{ disposition_logical: string | null; canonical_id: string | null }>(
        `SELECT d.logical_transaction_id AS disposition_logical, d.canonical_transaction_version_id AS canonical_id
           FROM core.source_record s
           LEFT JOIN core.source_record_disposition d ON d.source_record_id = s.source_record_id
          WHERE s.source_record_id = $1`,
        [sourceRecordId],
      );
      assert.equal(source.rowCount, 1, "source record survives the delete");
      assert.equal(source.rows[0].disposition_logical, null);
      assert.equal(source.rows[0].canonical_id, null);
      const outbox = await admin.query(
        `SELECT 1 FROM ops.outbox_event
          WHERE semantic_trigger_code = 'TRANSACTION_DELETED' AND aggregate_id = $1`,
        [logicalId],
      );
      assert.equal(outbox.rowCount, 1);
    } finally {
      await admin.end();
    }

    const page = await app.inject({
      method: "GET",
      url: "/v1/transactions",
      headers: { authorization: `Bearer ${token}`, "x-monytix-owner-id": owner },
    });
    assert.equal(page.statusCode, 200);
    assert.equal(
      page.json().items.some((row: { logicalTransactionId: string }) => row.logicalTransactionId === logicalId),
      false,
    );
  });

  test("a second delete of the same movement is a conflict on a fresh key and a replay on the same key", async () => {
    const created = await create(app, token, owner, account, "5.00");
    const logicalId = created.json().data.logical_transaction_id as string;
    const headers = {
      authorization: `Bearer ${token}`,
      "idempotency-key": "delete-replay",
      "x-monytix-owner-id": owner,
    };
    const first = await app.inject({ method: "DELETE", url: `/v1/transactions/${logicalId}`, headers });
    assert.equal(first.statusCode, 200);
    const replay = await app.inject({ method: "DELETE", url: `/v1/transactions/${logicalId}`, headers });
    assert.equal(replay.statusCode, 200);

    const freshKey = await app.inject({
      method: "DELETE",
      url: `/v1/transactions/${logicalId}`,
      headers: { ...headers, "idempotency-key": "delete-second" },
    });
    assert.equal(freshKey.statusCode, 404);
  });

  test("another owner cannot correct or delete the movement", async () => {
    const created = await create(app, token, owner, account, "9.00");
    const logicalId = created.json().data.logical_transaction_id as string;

    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `INSERT INTO core.actor_owner_membership (actor_id, owner_id, membership_role, membership_status)
         VALUES ($1, $2, 'OWNER', 'ACTIVE')`,
        [actorId, otherOwner],
      );
    } finally {
      await admin.end();
    }

    const patch = await correct(app, token, otherOwner, logicalId, "other-edit", { amount: "10.00" });
    assert.equal(patch.statusCode, 404);

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/transactions/${logicalId}`,
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "other-delete",
        "x-monytix-owner-id": otherOwner,
      },
    });
    assert.equal(removed.statusCode, 404);

    const admin2 = new pg.Client({ connectionString: adminUrl });
    await admin2.connect();
    try {
      const logical = await admin2.query(
        "SELECT 1 FROM core.logical_transaction WHERE logical_transaction_id = $1",
        [logicalId],
      );
      assert.equal(logical.rowCount, 1);
    } finally {
      await admin2.end();
    }
  });

  test("a caller without a membership is refused before any write", async () => {
    const created = await create(app, token, owner, account, "8.00");
    const logicalId = created.json().data.logical_transaction_id as string;
    const noMembership = "00000000-0000-4000-8000-0000000000ff";
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/transactions/${logicalId}`,
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "stranger-edit",
        "x-monytix-owner-id": noMembership,
      },
      payload: { amount: "10.00" },
    });
    assert.equal(patch.statusCode, 403);
  });
}

function create(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  ownerId: string,
  accountId: string,
  amount: string,
) {
  return app.inject({
    method: "POST",
    url: "/v1/transactions/manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": `seed-${amount}-${Math.random().toString(36).slice(2)}`,
      "x-monytix-owner-id": ownerId,
    },
    payload: JSON.stringify({
      financial_account_id: accountId,
      amount,
      currency: "INR",
      direction: "OUT",
      occurred_at: "2026-10-10T09:30:00Z",
      merchant_description: "Correction subject",
      category_code: "FOOD_DINING",
      subcategory_code: "GROCERIES",
    }),
  });
}

function correct(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  ownerId: string,
  logicalId: string,
  key: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "PATCH",
    url: `/v1/transactions/${logicalId}`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": key,
      "x-monytix-owner-id": ownerId,
    },
    payload: JSON.stringify(payload),
  });
}

async function sourceRecordIds(logicalId: string): Promise<string[]> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const rows = await admin.query<{ source_record_id: string }>(
      `SELECT DISTINCT cv.source_record_id
         FROM core.canonical_transaction_version cv
        WHERE cv.logical_transaction_id = $1 AND cv.source_record_id IS NOT NULL`,
      [logicalId],
    );
    return rows.rows.map((row) => row.source_record_id);
  } finally {
    await admin.end();
  }
}
