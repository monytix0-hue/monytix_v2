import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const historicalAccountId = "01a12b2d-3324-71e2-8fbd-4faf2ec90b2a";

type Structure = {
  outcome: string;
  parse_status?: string;
  payment_rail?: string;
  matched_reason?: string;
  is_current?: boolean;
};

test("M3.6 publishes F10B structure without resolving identity", async (t) => {
  if (!databaseUrl || !adminUrl) {
    t.skip("local Postgres 17 is not configured");
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  const api = new pg.Client({ connectionString: databaseUrl });
  const left = new pg.Client({ connectionString: databaseUrl });
  const right = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  await api.connect();
  await left.connect();
  await right.connect();
  const stamp = Date.now().toString();
  const historicalBefore = await admin.query<{ logical_transaction_id: string }>(
    `SELECT logical_transaction_id FROM core.logical_transaction
      WHERE financial_account_id = $1 ORDER BY logical_transaction_id`,
    [historicalAccountId],
  );
  try {
    const actorA = (
      await admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", `m36-a-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const actorB = (
      await admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", `m36-b-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const owners = await admin.query<{ owner_id: string }>(
      `INSERT INTO core.owner (owner_type, display_name)
       VALUES ('PERSON', $1), ('BUSINESS', $2) RETURNING owner_id`,
      [`m36-a-${stamp}`, `m36-biz-${stamp}`],
    );
    const ownerA = owners.rows[0]!.owner_id;
    const ownerBiz = owners.rows[1]!.owner_id;
    await admin.query(
      `INSERT INTO core.actor_owner_membership (actor_id, owner_id, membership_role, membership_status, is_default_owner)
       VALUES ($1, $2, 'OWNER', 'ACTIVE', true), ($1, $3, 'OWNER', 'ACTIVE', false)`,
      [actorA, ownerA, ownerBiz],
    );
    const accounts = await admin.query<{ financial_account_id: string }>(
      `INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
       VALUES ('SAVINGS', 'A', 'USD', 'ACTIVE'), ('CURRENT', 'Biz', 'USD', 'ACTIVE')
       RETURNING financial_account_id`,
    );
    const accountA = accounts.rows[0]!.financial_account_id;
    const accountBiz = accounts.rows[1]!.financial_account_id;
    await admin.query(
      `INSERT INTO core.account_ownership (owner_id, financial_account_id, relationship_role, verification_state, relationship_status)
       VALUES ($1, $2, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE'),
              ($3, $4, 'BUSINESS_OWNER', 'VERIFIED', 'ACTIVE')`,
      [ownerA, accountA, ownerBiz, accountBiz],
    );

    async function seed(input: {
      ownerId?: string;
      accountId?: string;
      direction?: "IN" | "OUT";
      description?: string | null;
    }) {
      const logical = await admin.query<{ logical_transaction_id: string }>(
        "INSERT INTO core.logical_transaction (financial_account_id) VALUES ($1) RETURNING logical_transaction_id",
        [input.accountId ?? accountA],
      );
      const logicalId = logical.rows[0]!.logical_transaction_id;
      const version = await admin.query<{ canonical_transaction_version_id: string }>(
        `INSERT INTO core.canonical_transaction_version (
           logical_transaction_id, version_no, is_current, financial_account_id,
           transaction_date, amount, direction, currency_code, raw_description,
           extraction_sequence, normalization_status, normalization_confidence,
           normalization_version, change_provenance, duplicate_outcome, reversal_indicator
         ) VALUES (
           $1, 1, false, $2, DATE '2026-06-01', 25.0000, $3, 'USD', $4,
           1, 'READY', 0, 'M3.6-test', 'MIGRATION_CORRECTION', 'DISTINCT', false
         ) RETURNING canonical_transaction_version_id`,
        [logicalId, input.accountId ?? accountA, input.direction ?? "OUT", input.description ?? null],
      );
      const versionId = version.rows[0]!.canonical_transaction_version_id;
      await admin.query("SELECT core.activate_canonical_transaction_version($1::uuid, NULL)", [versionId]);
      return { logicalId, versionId };
    }

    async function publish(logicalId: string, version?: string, actor = actorA, owner = ownerA): Promise<Structure> {
      const result = await api.query<{ result: Structure }>(
        "SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, $4) AS result",
        [actor, owner, logicalId, version ?? null],
      );
      return result.rows[0]!.result;
    }

    const privileges = await admin.query<{ api_insert: boolean; api_execute: boolean; intel_execute: boolean }>(
      `SELECT has_table_privilege('monytix_api', 'intel.transaction_structure', 'INSERT') AS api_insert,
              has_function_privilege('monytix_api', 'ops.publish_transaction_structure(uuid,uuid,uuid,text)', 'EXECUTE') AS api_execute,
              has_function_privilege('monytix_intelligence', 'ops.publish_transaction_structure(uuid,uuid,uuid,text)', 'EXECUTE') AS intel_execute`,
    );
    assert.equal(privileges.rows[0]?.api_insert, false);
    assert.equal(privileges.rows[0]?.api_execute, true);
    assert.equal(privileges.rows[0]?.intel_execute, false);

    const upi = await seed({ description: "UPIOUT/123456789012/sample@testbank/note" });
    const before = await admin.query(
      `SELECT amount::text, direction, currency_code FROM core.canonical_transaction_version
        WHERE canonical_transaction_version_id = $1`,
      [upi.versionId],
    );
    const upiResult = await publish(upi.logicalId);
    assert.equal(upiResult.outcome, "created");
    assert.equal(upiResult.payment_rail, "UPI");
    assert.equal(upiResult.parse_status, "PARTIAL");
    assert.notEqual(upiResult.parse_status, "PARSED");
    const upiRows = await admin.query<{
      identifier_type: string;
      identifier_role: string;
      normalized_value: string;
      confidence: string | null;
      ambiguity_status: string;
      rail_confidence: string | null;
      structural_subtype: string | null;
    }>(
      `SELECT i.identifier_type, i.identifier_role, i.normalized_value, i.confidence::text,
              i.ambiguity_status, s.rail_confidence::text, s.structural_subtype
         FROM intel.transaction_identifier i
         JOIN intel.transaction_structure s ON s.transaction_structure_id = i.transaction_structure_id
        WHERE s.logical_transaction_id = $1 AND i.identifier_type = 'VPA'`,
      [upi.logicalId],
    );
    assert.equal(upiRows.rows[0]?.normalized_value, "sample@testbank");
    assert.equal(upiRows.rows[0]?.identifier_role, "UNKNOWN_VPA");
    assert.equal(upiRows.rows[0]?.ambiguity_status, "CANDIDATE");
    assert.equal(upiRows.rows[0]?.confidence, null);
    assert.equal(upiRows.rows[0]?.rail_confidence, null);
    assert.equal(upiRows.rows[0]?.structural_subtype, null);
    const leaked = await admin.query<{ payload: string }>(
      `SELECT event_payload::text AS payload FROM ops.outbox_event
        WHERE aggregate_id = $1 AND semantic_trigger_code = 'TRANSACTION_STRUCTURE_AVAILABLE'`,
      [upi.logicalId],
    );
    assert.equal(leaked.rows[0]?.payload.toLowerCase().includes("sample@testbank"), false);
    const after = await admin.query(
      `SELECT amount::text, direction, currency_code FROM core.canonical_transaction_version
        WHERE canonical_transaction_version_id = $1`,
      [upi.versionId],
    );
    assert.deepEqual(after.rows, before.rows);
    const replay = await publish(upi.logicalId);
    assert.equal(replay.outcome, "replay");

    const marker = await seed({ description: "UPI/P2M/123456789012/SAMPLE SHOP/NOTE/BANK" });
    const markerResult = await publish(marker.logicalId);
    assert.equal(markerResult.payment_rail, "UPI");
    assert.equal(markerResult.parse_status, "PARTIAL");
    const markerRow = await admin.query<{ observed_type_markers: string[]; structural_subtype: string | null }>(
      `SELECT observed_type_markers, structural_subtype
         FROM intel.transaction_structure WHERE logical_transaction_id = $1`,
      [marker.logicalId],
    );
    assert.equal(markerRow.rows[0]?.observed_type_markers.includes("P2M"), true);
    assert.equal(markerRow.rows[0]?.structural_subtype, null);

    const blank = await seed({ description: null });
    const blankResult = await publish(blank.logicalId);
    assert.equal(blankResult.parse_status, "UNPARSED");
    assert.equal(blankResult.payment_rail, "UNKNOWN");
    assert.equal(blankResult.matched_reason, "NO_RAIL_MATCH");

    const emi = await seed({ description: "PPR12345_EMI_010126_NAME" });
    const emiStructure = await publish(emi.logicalId);
    assert.equal(emiStructure.payment_rail, "UNKNOWN");
    assert.equal(emiStructure.parse_status, "UNPARSED");
    await api.query("SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL)", [actorA, ownerA, emi.logicalId]);
    await api.query("SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, NULL)", [actorA, ownerA, emi.logicalId]);
    await api.query("SELECT ops.resolve_transaction_party($1::uuid, $2::uuid, $3::uuid, NULL)", [actorA, ownerA, emi.logicalId]);
    const meaning = await admin.query<{ event_family: string | null; category_code: string | null; resolution_status: string }>(
      `SELECT e.event_family, c.category_code, p.resolution_status
         FROM intel.financial_event_resolution e
         JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id
         JOIN intel.transaction_party_resolution p ON p.logical_transaction_id = e.logical_transaction_id
        WHERE e.logical_transaction_id = $1 AND e.is_current AND c.is_current AND p.is_current`,
      [emi.logicalId],
    );
    assert.notEqual(meaning.rows[0]?.event_family, "MERCHANT_PURCHASE");
    assert.equal(meaning.rows[0]?.category_code, null);
    assert.notEqual(meaning.rows[0]?.resolution_status, "RESOLVED");

    const conflict = await seed({ direction: "OUT", description: "UPI IN/123456789012/sample@testbank/note" });
    const conflictResult = await publish(conflict.logicalId);
    assert.equal(conflictResult.parse_status, "CONFLICT");
    assert.equal(conflictResult.matched_reason, "DIRECTION_MARKER_CONFLICT");
    const conflictDirection = await admin.query<{ direction: string }>(
      `SELECT direction FROM core.canonical_transaction_version WHERE canonical_transaction_version_id = $1`,
      [conflict.versionId],
    );
    assert.equal(conflictDirection.rows[0]?.direction, "OUT");

    const policyVersion = `F10B-v2.1-${stamp}`;
    await admin.query("INSERT INTO ref.structure_policy (f10b_version) VALUES ($1)", [policyVersion]);
    const upgraded = await publish(upi.logicalId, policyVersion);
    assert.equal(upgraded.outcome, "created");
    const history = await admin.query<{ f10b_version: string; parse_status: string; is_current: boolean }>(
      `SELECT f10b_version, parse_status, is_current
         FROM intel.transaction_structure WHERE logical_transaction_id = $1 ORDER BY parsed_at`,
      [upi.logicalId],
    );
    assert.equal(history.rowCount, 2);
    assert.equal(history.rows[0]?.parse_status, "PARTIAL");
    assert.equal(history.rows[0]?.is_current, false);
    assert.equal(history.rows[1]?.f10b_version, policyVersion);
    assert.equal(history.rows[1]?.is_current, true);

    const concurrent = await seed({ description: "UPIOUT/123456789012/concurrent@testbank/note" });
    const pair = await Promise.all([
      left.query<{ result: Structure }>("SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, NULL) AS result", [actorA, ownerA, concurrent.logicalId]),
      right.query<{ result: Structure }>("SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, NULL) AS result", [actorA, ownerA, concurrent.logicalId]),
    ]);
    assert.deepEqual(pair.map((item) => item.rows[0]!.result.outcome).sort(), ["created", "replay"]);

    const rolled = await seed({ description: "UPIOUT/123456789012/rollback@testbank/note" });
    try {
      await api.query("BEGIN");
      const pending = await publish(rolled.logicalId);
      assert.equal(pending.outcome, "created");
      await api.query("ROLLBACK");
    } catch (error) {
      await api.query("ROLLBACK");
      throw error;
    }
    const rolledRows = await admin.query(
      "SELECT 1 FROM intel.transaction_structure WHERE logical_transaction_id = $1",
      [rolled.logicalId],
    );
    assert.equal(rolledRows.rowCount, 0);

    const forbidden = await publish(upi.logicalId, undefined, actorB, ownerA);
    assert.equal(forbidden.outcome, "forbidden");
    const business = await seed({ ownerId: ownerBiz, accountId: accountBiz, description: "UPIOUT/123456789012/biz@testbank/note" });
    const businessResult = await publish(business.logicalId, undefined, actorA, ownerBiz);
    assert.equal(businessResult.outcome, "business_isolated");
    const structureWriter = await admin.query<{ definition: string }>(
      "SELECT pg_get_functiondef('ops.publish_transaction_structure(uuid,uuid,uuid,text)'::regprocedure) AS definition",
    );
    assert.equal(structureWriter.rows[0]!.definition.includes("financial_entity"), false);

    const historicalAfter = await admin.query<{ logical_transaction_id: string }>(
      `SELECT logical_transaction_id FROM core.logical_transaction
        WHERE financial_account_id = $1 ORDER BY logical_transaction_id`,
      [historicalAccountId],
    );
    assert.deepEqual(historicalAfter.rows, historicalBefore.rows);
  } finally {
    await admin.end();
    await api.end();
    await left.end();
    await right.end();
  }
});
