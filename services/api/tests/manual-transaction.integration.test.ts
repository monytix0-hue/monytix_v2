import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { createPgIdentity } from "../src/auth/identity.js";
import { createFirebaseVerifier } from "../src/auth/verifier.js";
import { createManualTransactionStore } from "../src/transactions/manual.js";
import { testKeys, testProjectId } from "./auth-fixture.js";

const apiUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const enabled = Boolean(apiUrl && adminUrl);

if (!enabled) {
  test("manual transaction integration requires Postgres 17", { skip: true }, () => {});
} else {
  const subject = `m2-manual-user-${Date.now()}`;
  let actorId = "";
  let personalOwner = "";
  let otherOwner = "";
  let businessOwner = "";
  let deniedBusiness = "";
  let personalAccount = "";
  let otherAccount = "";
  let businessAccount = "";
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
       VALUES ('PERSON', 'M2 Personal'), ('PERSON', 'M2 Other'), ('BUSINESS', 'M2 Business'), ('BUSINESS', 'M2 Denied Business')
       RETURNING owner_id, display_name`,
    );
    const ownerId = (name: string) => owners.rows.find((row) => row.display_name === name)!.owner_id;
    personalOwner = ownerId("M2 Personal");
    otherOwner = ownerId("M2 Other");
    businessOwner = ownerId("M2 Business");
    deniedBusiness = ownerId("M2 Denied Business");
    const accounts = await admin.query<{ financial_account_id: string; account_display_name: string }>(
      `INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
       VALUES ('SAVINGS', 'Personal', 'INR', 'ACTIVE'), ('SAVINGS', 'Other', 'INR', 'ACTIVE'), ('CURRENT', 'Business', 'INR', 'ACTIVE')
       RETURNING financial_account_id, account_display_name`,
    );
    const accountId = (name: string) => accounts.rows.find((row) => row.account_display_name === name)!.financial_account_id;
    personalAccount = accountId("Personal");
    otherAccount = accountId("Other");
    businessAccount = accountId("Business");
    await admin.query(
      `INSERT INTO core.account_ownership (
         owner_id, financial_account_id, relationship_role, verification_state, relationship_status, verification_source
       ) VALUES
         ($1, $2, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE', 'M2-2'),
         ($3, $4, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE', 'M2-2'),
         ($5, $6, 'BUSINESS_OWNER', 'VERIFIED', 'ACTIVE', 'M2-2')`,
      [personalOwner, personalAccount, otherOwner, otherAccount, businessOwner, businessAccount],
    );
    await admin.query(
      `INSERT INTO core.actor_owner_membership (
         actor_id, owner_id, membership_role, membership_status, is_default_owner
       ) VALUES
         ($1, $2, 'OWNER', 'ACTIVE', true),
         ($1, $3, 'OWNER', 'ACTIVE', false)`,
      [actorId, personalOwner, businessOwner],
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
    });
  });

  test.after(async () => {
    if (app) {
      await app.close();
    }
  });

  test("manual OUT and IN create a READY version and unverified evidence", async () => {
    const out = await post(app, token, personalOwner, "out-1", {
      financial_account_id: personalAccount,
      amount: "1250.50",
      currency: "INR",
      direction: "OUT",
      occurred_at: "2026-10-10T09:30:00Z",
      merchant_description: "Groceries'; DROP TABLE core.owner; --",
      category_code: "FOOD",
      subcategory_code: "GROCERIES",
      user_selected_weights: ["W01", "W03"],
    });
    assert.equal(out.statusCode, 201);
    const outBody = out.json();
    assert.equal(outBody.meta.ui_state, "WRITE_COMMITTED");
    assert.equal(outBody.meta.api_version, "v1.1");
    assert.equal(outBody.data.version_no, 1);
    assert.equal(outBody.data.normalization_status, "READY");
    assert.equal(outBody.data.amount, "1250.50");
    assert.equal(outBody.data.direction, "OUT");
    assert.equal(outBody.data.currency, "INR");
    assert.equal("recompute_status" in outBody.meta, false);
    assert.equal("category_code" in outBody.data, false);

    const income = await post(app, token, personalOwner, "in-1", {
      financial_account_id: personalAccount,
      amount: "5000",
      currency: "INR",
      direction: "IN",
      occurred_at: "2026-10-10T10:00:00Z",
      merchant_description: "Salary",
      category_code: "INCOME",
      subcategory_code: "SALARY",
    });
    assert.equal(income.statusCode, 201);
    assert.equal(income.json().data.direction, "IN");
    assert.notEqual(income.json().data.logical_transaction_id, outBody.data.logical_transaction_id);

    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
    const evidence = await admin.query<{ raw_record_payload: { taxonomy_verified: boolean; weights_verified: boolean; user_selected_weights: string[] }; raw_description: string }>(
      `SELECT raw_record_payload, raw_description
         FROM core.source_record
        WHERE raw_description LIKE 'Groceries%'`,
    );
    assert.equal(evidence.rows[0].raw_record_payload.taxonomy_verified, false);
    assert.equal(evidence.rows[0].raw_record_payload.weights_verified, false);
    assert.deepEqual(evidence.rows[0].raw_record_payload.user_selected_weights, ["W01", "W03"]);
    const version = await admin.query<{ is_current: boolean; amount: string; direction: string }>(
      `SELECT is_current, amount::text, direction
         FROM core.canonical_transaction_version
        WHERE canonical_transaction_version_id = $1`,
      [outBody.data.canonical_transaction_version_id],
    );
    assert.equal(version.rows[0].is_current, true);
    assert.equal(version.rows[0].direction, "OUT");
    assert.equal(Number(version.rows[0].amount), 1250.5);
    const outbox = await admin.query(
      `SELECT 1 FROM ops.outbox_event
        WHERE aggregate_id = $1 AND semantic_trigger_code = 'TRANSACTION_CREATED'`,
      [outBody.data.logical_transaction_id],
    );
    assert.equal(outbox.rowCount, 1);
    const stub = await admin.query("SELECT count(*)::int AS n FROM public.transactions");
    assert.equal(stub.rows[0].n, 0);
    const taxonomy = await admin.query("SELECT to_regclass('ref.taxonomy_node') AS name");
    assert.equal(taxonomy.rows[0].name, null);
    const weights = await admin.query("SELECT to_regclass('human_context.weight_master') AS name");
    assert.equal(weights.rows[0].name, null);
    const owners = await admin.query("SELECT count(*)::int AS n FROM core.owner");
    assert.ok(owners.rows[0].n >= 4);
    } finally {
      await admin.end();
    }
  });

  test("same idempotency key replays and a different payload conflicts", async () => {
    const first = await post(app, token, personalOwner, "same-key", manualBody(personalAccount, "10.00"));
    const replay = await post(app, token, personalOwner, "same-key", manualBody(personalAccount, "10.00"));
    assert.equal(replay.statusCode, 201);
    assert.equal(replay.json().data.logical_transaction_id, first.json().data.logical_transaction_id);
    assert.equal(replay.json().meta.request_id, first.json().meta.request_id);
    const conflict = await post(app, token, personalOwner, "same-key", manualBody(personalAccount, "11.00"));
    assert.equal(conflict.statusCode, 409);
    assert.deepEqual(conflict.json(), { error: "idempotency_conflict" });
  });

  test("concurrent same-key requests create one logical transaction", async () => {
    const payload = manualBody(personalAccount, "42.00");
    const [left, right] = await Promise.all([
      post(app, token, personalOwner, "concurrent-key", payload),
      post(app, token, personalOwner, "concurrent-key", payload),
    ]);
    assert.equal(left.statusCode, 201);
    assert.equal(right.statusCode, 201);
    assert.equal(left.json().data.logical_transaction_id, right.json().data.logical_transaction_id);
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      const rows = await admin.query(
        `SELECT count(*)::int AS n
           FROM ops.idempotency_record
          WHERE idempotency_key = 'concurrent-key'
            AND owner_id = $1`,
        [personalOwner],
      );
      assert.equal(rows.rows[0].n, 1);
    } finally {
      await admin.end();
    }
  });

  test("wrong owner, denied business, and another owner's account are forbidden", async () => {
    const wrongOwner = await post(app, token, otherOwner, "wrong-owner", manualBody(personalAccount, "1.00"));
    assert.equal(wrongOwner.statusCode, 403);
    const denied = await post(app, token, deniedBusiness, "denied-business", manualBody(businessAccount, "1.00"));
    assert.equal(denied.statusCode, 403);
    const cross = await post(app, token, personalOwner, "cross-account", manualBody(otherAccount, "1.00"));
    assert.equal(cross.statusCode, 403);
    assert.deepEqual(cross.json(), { error: "account_forbidden" });
  });

  test("authorized business membership can create a manual transaction", async () => {
    const response = await post(app, token, businessOwner, "business-ok", manualBody(businessAccount, "88.00"));
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().data.direction, "OUT");
  });

  test("invalid amount does not write and a rolled-back call leaves nothing", async () => {
    const before = await countLogical(personalAccount);
    const invalid = await post(app, token, personalOwner, "bad-amount", {
      ...manualBody(personalAccount, "1.00"),
      amount: "-5",
    });
    assert.equal(invalid.statusCode, 422);
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
    await admin.query("BEGIN");
    await admin.query(
      `SELECT ops.create_manual_transaction(
         $1::uuid, $2::uuid, $3::uuid, 'rollback-key', '3.00', 'INR', 'OUT',
         '2026-10-10T11:00:00Z', 'Rollback', 'FOOD', 'GROCERIES', NULL
       )`,
      [actorId, personalOwner, personalAccount],
    );
    await admin.query("ROLLBACK");
    const leftover = await admin.query(
      "SELECT count(*)::int AS n FROM ops.idempotency_record WHERE idempotency_key = 'rollback-key'",
    );
    assert.equal(leftover.rows[0].n, 0);
    } finally {
      await admin.end();
    }
    const after = await countLogical(personalAccount);
    assert.equal(after, before);
  });

  test("application roles cannot insert the ledger or read another owner", async () => {
    const api = new pg.Client({ connectionString: apiUrl });
    await api.connect();
    try {
    await assert.rejects(
      api.query(
        "INSERT INTO core.logical_transaction (financial_account_id) VALUES ($1)",
        [personalAccount],
      ),
    );
    await api.query("BEGIN");
    await api.query("SET LOCAL ROLE monytix_api");
    await api.query("SELECT set_config('app.owner_id', $1, true)", [otherOwner]);
    const hidden = await api.query(
      "SELECT count(*)::int AS n FROM core.logical_transaction WHERE financial_account_id = $1",
      [personalAccount],
    );
    assert.equal(hidden.rows[0].n, 0);
    await api.query("ROLLBACK");
    } finally {
      await api.end();
    }

    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
    await admin.query("BEGIN");
    await admin.query("SET LOCAL ROLE monytix_intelligence");
    await assert.rejects(
      admin.query(
        "INSERT INTO core.logical_transaction (financial_account_id) VALUES ($1)",
        [personalAccount],
      ),
    );
    await admin.query("ROLLBACK");
    await admin.query("BEGIN");
    await admin.query("SET LOCAL ROLE monytix_intelligence");
    await assert.rejects(
      admin.query(
        `SELECT ops.create_manual_transaction(
           $1::uuid, $2::uuid, $3::uuid, 'intel-key', '1.00', 'INR', 'OUT',
           '2026-10-10T11:00:00Z', 'Nope', 'FOOD', 'GROCERIES', NULL
         )`,
        [actorId, personalOwner, personalAccount],
      ),
    );
    await admin.query("ROLLBACK");
    } finally {
      await admin.end();
    }
  });
}

function manualBody(accountId: string, amount: string) {
  return {
    financial_account_id: accountId,
    amount,
    currency: "INR",
    direction: "OUT",
    occurred_at: "2026-10-10T09:30:00Z",
    merchant_description: "Manual",
    category_code: "FOOD",
    subcategory_code: "GROCERIES",
  };
}

function post(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  ownerId: string,
  key: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: "/v1/transactions/manual",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": key,
      "x-monytix-owner-id": ownerId,
    },
    payload: JSON.stringify(payload),
  });
}

async function countLogical(accountId: string): Promise<number> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const result = await admin.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM core.logical_transaction WHERE financial_account_id = $1",
    [accountId],
  );
  await admin.end();
  return result.rows[0].n;
}
