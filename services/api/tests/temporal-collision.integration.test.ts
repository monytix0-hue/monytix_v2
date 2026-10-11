import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const historicalAccountId = "01a12b2d-3324-71e2-8fbd-4faf2ec90b2a";
const preservedToken = "overlap-1791734662543";

test("M3.15 enforces half-open identifier collisions without resolving identity", async (t) => {
  if (!databaseUrl || !adminUrl) {
    t.skip("local Postgres 17 is not configured");
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  const api = new pg.Client({ connectionString: databaseUrl });
  const left = new pg.Client({ connectionString: adminUrl });
  const right = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await api.connect();
  await left.connect();
  await right.connect();
  const stamp = Date.now().toString();
  const preservedBefore = await admin.query(
    `SELECT entity_identifier_id, ambiguity_status, effective_from, effective_to
       FROM intel.entity_identifier
      WHERE normalized_value = $1
      ORDER BY effective_from, entity_identifier_id`,
    [preservedToken],
  );
  const historicalBefore = await admin.query<{ logical_transaction_id: string }>(
    `SELECT logical_transaction_id FROM core.logical_transaction
      WHERE financial_account_id = $1 ORDER BY logical_transaction_id`,
    [historicalAccountId],
  );
  try {
    assert.equal(preservedBefore.rowCount, 2, "T12");
    assert.deepEqual(
      preservedBefore.rows.map((row) => row.ambiguity_status),
      ["UNIQUE", "UNIQUE"],
      "T12",
    );
    const ruleId = (
      await admin.query<{ entity_registry_rule_id: string }>(
        `SELECT entity_registry_rule_id FROM ref.entity_registry_rule
          WHERE registry_version = 'M3.11-v1' AND rule_code = 'FOUNDATION_ONLY'`,
      )
    ).rows[0]!.entity_registry_rule_id;

    async function entity() {
      const row = await admin.query<{ entity_id: string }>(
        `INSERT INTO intel.financial_entity (entity_nature, entity_registry_rule_id)
         VALUES ('ORGANIZATION', $1) RETURNING entity_id`,
        [ruleId],
      );
      return row.rows[0]!.entity_id;
    }

    async function statuses(token: string) {
      const rows = await admin.query<{ ambiguity_status: string }>(
        `SELECT ambiguity_status FROM intel.entity_identifier
          WHERE normalized_value = $1 ORDER BY effective_from, entity_identifier_id`,
        [token],
      );
      return rows.rows.map((row) => row.ambiguity_status);
    }

    const overlapA = await entity();
    const overlapB = await entity();
    const overlap = `t01-${stamp}`;
    await admin.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'BIC', 't01', $3, $4, timestamptz '2023-01-01', timestamptz '2024-01-01'),
         ($2, 'BIC', 't01', $3, $4, timestamptz '2023-06-01', timestamptz '2025-01-01')`,
      [overlapA, overlapB, overlap, ruleId],
    );
    assert.deepEqual(await statuses(overlap), ["AMBIGUOUS", "AMBIGUOUS"], "T01");

    const touchA = await entity();
    const touchB = await entity();
    const touch = `t02-${stamp}`;
    await admin.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'BIC', 't02', $3, $4, timestamptz '2023-01-01', timestamptz '2024-01-01'),
         ($2, 'BIC', 't02', $3, $4, timestamptz '2024-01-01', timestamptz '2025-01-01')`,
      [touchA, touchB, touch, ruleId],
    );
    assert.deepEqual(await statuses(touch), ["UNIQUE", "UNIQUE"], "T02");

    const openA = await entity();
    const openB = await entity();
    const open = `t03-${stamp}`;
    await admin.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES ($1, 'IFSC', 't03', $2, $3, timestamptz '2024-01-01', NULL)`,
      [openA, open, ruleId],
    );
    await admin.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES ($1, 'IFSC', 't03', $2, $3, timestamptz '2024-06-01', timestamptz '2024-12-31')`,
      [openB, open, ruleId],
    );
    assert.deepEqual(await statuses(open), ["AMBIGUOUS", "AMBIGUOUS"], "T03");

    const separatedA = await entity();
    const separatedB = await entity();
    const separated = `t04-${stamp}`;
    await admin.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'BANK_ID', 't04', $3, $4, timestamptz '2020-01-01', timestamptz '2020-06-01'),
         ($2, 'BANK_ID', 't04', $3, $4, timestamptz '2024-01-01', timestamptz '2024-06-01')`,
      [separatedA, separatedB, separated, ruleId],
    );
    assert.deepEqual(await statuses(separated), ["UNIQUE", "UNIQUE"], "T04");

    const scopeA = await entity();
    const scopeB = await entity();
    const scoped = `t05-${stamp}`;
    await admin.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'MERCHANT_ID', 'rail-a', $3, $4, timestamptz '2024-01-01', timestamptz '2024-12-31'),
         ($2, 'MERCHANT_ID', 'rail-b', $3, $4, timestamptz '2024-06-01', timestamptz '2025-06-01')`,
      [scopeA, scopeB, scoped, ruleId],
    );
    assert.deepEqual(await statuses(scoped), ["UNIQUE", "UNIQUE"], "T05");

    const typeA = await entity();
    const typeB = await entity();
    const typed = `t06-${stamp}`;
    await admin.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'MERCHANT_ID', 't06', $3, $4, timestamptz '2024-01-01', timestamptz '2024-12-31'),
         ($2, 'BILLER_ID', 't06', $3, $4, timestamptz '2024-06-01', timestamptz '2025-06-01')`,
      [typeA, typeB, typed, ruleId],
    );
    assert.deepEqual(await statuses(typed), ["UNIQUE", "UNIQUE"], "T06");

    const fromA = await entity();
    const fromB = await entity();
    const fromToken = `t07-${stamp}`;
    const fromRows = await admin.query<{ entity_identifier_id: string }>(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'TERMINAL_ID', 't07', $3, $4, timestamptz '2024-01-01', timestamptz '2024-04-01'),
         ($2, 'TERMINAL_ID', 't07', $3, $4, timestamptz '2024-08-01', timestamptz '2024-12-01')
       RETURNING entity_identifier_id`,
      [fromA, fromB, fromToken, ruleId],
    );
    assert.deepEqual(await statuses(fromToken), ["UNIQUE", "UNIQUE"], "T07");
    await admin.query(
      `UPDATE intel.entity_identifier SET effective_from = timestamptz '2024-03-01'
        WHERE entity_identifier_id = $1`,
      [fromRows.rows[1]!.entity_identifier_id],
    );
    assert.deepEqual(await statuses(fromToken), ["AMBIGUOUS", "AMBIGUOUS"], "T07");

    const toA = await entity();
    const toB = await entity();
    const toToken = `t08-${stamp}`;
    const toRows = await admin.query<{ entity_identifier_id: string }>(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'TERMINAL_ID', 't08', $3, $4, timestamptz '2024-01-01', timestamptz '2024-04-01'),
         ($2, 'TERMINAL_ID', 't08', $3, $4, timestamptz '2024-08-01', timestamptz '2024-12-01')
       RETURNING entity_identifier_id`,
      [toA, toB, toToken, ruleId],
    );
    await admin.query(
      `UPDATE intel.entity_identifier SET effective_to = timestamptz '2024-09-01'
        WHERE entity_identifier_id = $1`,
      [toRows.rows[0]!.entity_identifier_id],
    );
    assert.deepEqual(await statuses(toToken), ["AMBIGUOUS", "AMBIGUOUS"], "T08");

    await admin.query(
      `UPDATE intel.entity_identifier SET effective_to = timestamptz '2024-02-01'
        WHERE entity_identifier_id = $1`,
      [toRows.rows[0]!.entity_identifier_id],
    );
    assert.deepEqual(await statuses(toToken), ["AMBIGUOUS", "AMBIGUOUS"], "T09");
    assert.deepEqual(await statuses(toToken), ["AMBIGUOUS", "AMBIGUOUS"], "T20");

    const concurrentA = await entity();
    const concurrentB = await entity();
    const concurrent = `t10-${stamp}`;
    await left.query("BEGIN");
    await left.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES ($1, 'BIC', 't10', $2, $3, timestamptz '2023-01-01', timestamptz '2024-01-01')`,
      [concurrentA, concurrent, ruleId],
    );
    const waitingInsert = (async () => {
      await right.query("BEGIN");
      await right.query(
        `INSERT INTO intel.entity_identifier (
           entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
           effective_from, effective_to
         ) VALUES ($1, 'BIC', 't10', $2, $3, timestamptz '2023-06-01', timestamptz '2025-01-01')`,
        [concurrentB, concurrent, ruleId],
      );
    })();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await left.query("COMMIT");
    await waitingInsert;
    await right.query("COMMIT");
    assert.deepEqual(await statuses(concurrent), ["AMBIGUOUS", "AMBIGUOUS"], "T10");

    const updateA = await entity();
    const updateB = await entity();
    const updateToken = `t11-${stamp}`;
    const updateRows = await admin.query<{ entity_identifier_id: string }>(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'BANK_ID', 't11', $3, $4, timestamptz '2024-01-01', timestamptz '2024-03-01'),
         ($2, 'BANK_ID', 't11', $3, $4, timestamptz '2024-09-01', timestamptz '2024-12-01')
       RETURNING entity_identifier_id`,
      [updateA, updateB, updateToken, ruleId],
    );
    const lockKey = `BANK_ID|t11|${updateToken}`;
    await left.query("BEGIN");
    await left.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
    await left.query(
      `UPDATE intel.entity_identifier SET effective_to = timestamptz '2024-10-01'
        WHERE entity_identifier_id = $1`,
      [updateRows.rows[0]!.entity_identifier_id],
    );
    const waitingUpdate = (async () => {
      await right.query("BEGIN");
      await right.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
      await right.query(
        `UPDATE intel.entity_identifier SET effective_from = timestamptz '2024-02-01'
          WHERE entity_identifier_id = $1`,
        [updateRows.rows[1]!.entity_identifier_id],
      );
    })();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await left.query("COMMIT");
    await waitingUpdate;
    await right.query("COMMIT");
    assert.deepEqual(await statuses(updateToken), ["AMBIGUOUS", "AMBIGUOUS"], "T11");

    const preservedAfter = await admin.query(
      `SELECT entity_identifier_id, ambiguity_status, effective_from, effective_to
         FROM intel.entity_identifier
        WHERE normalized_value = $1
        ORDER BY effective_from, entity_identifier_id`,
      [preservedToken],
    );
    assert.deepEqual(preservedAfter.rows, preservedBefore.rows, "T12");

    const actor = (
      await admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", `m315-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const owner = (
      await admin.query<{ owner_id: string }>(
        `INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1) RETURNING owner_id`,
        [`m315-${stamp}`],
      )
    ).rows[0]!.owner_id;
    await admin.query(
      `INSERT INTO core.actor_owner_membership (actor_id, owner_id, membership_role, membership_status, is_default_owner)
       VALUES ($1, $2, 'OWNER', 'ACTIVE', true)`,
      [actor, owner],
    );
    const account = (
      await admin.query<{ financial_account_id: string }>(
        `INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
         VALUES ('SAVINGS', 'A', 'USD', 'ACTIVE') RETURNING financial_account_id`,
      )
    ).rows[0]!.financial_account_id;
    await admin.query(
      `INSERT INTO core.account_ownership (owner_id, financial_account_id, relationship_role, verification_state, relationship_status)
       VALUES ($1, $2, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE')`,
      [owner, account],
    );
    const logical = (
      await admin.query<{ logical_transaction_id: string }>(
        "INSERT INTO core.logical_transaction (financial_account_id) VALUES ($1) RETURNING logical_transaction_id",
        [account],
      )
    ).rows[0]!.logical_transaction_id;
    const version = (
      await admin.query<{ canonical_transaction_version_id: string }>(
        `INSERT INTO core.canonical_transaction_version (
           logical_transaction_id, version_no, is_current, financial_account_id,
           transaction_date, amount, direction, currency_code, raw_description,
           extraction_sequence, normalization_status, normalization_confidence,
           normalization_version, change_provenance, duplicate_outcome, reversal_indicator
         ) VALUES (
           $1, 1, false, $2, DATE '2026-06-01', 12.0000, 'OUT', 'USD', 'monthly emi',
           1, 'READY', 0, 'M3.15-test', 'MIGRATION_CORRECTION', 'DISTINCT', false
         ) RETURNING canonical_transaction_version_id`,
        [logical, account],
      )
    ).rows[0]!.canonical_transaction_version_id;
    await admin.query("SELECT core.activate_canonical_transaction_version($1::uuid, NULL)", [version]);
    const beforePipeline = await admin.query(
      `SELECT cv.amount::text AS amount, cv.direction
         FROM core.canonical_transaction_version cv
        WHERE cv.canonical_transaction_version_id = $1`,
      [version],
    );
    await api.query("SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
    await api.query("SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
    await api.query("SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
    await api.query("SELECT ops.resolve_transaction_party($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
    const pipeline = await admin.query<{
      amount: string;
      direction: string;
      event_family: string;
      category_code: string | null;
      party_status: string | null;
    }>(
      `SELECT cv.amount::text AS amount, cv.direction, e.event_family, c.category_code, p.resolution_status AS party_status
         FROM core.canonical_transaction_version cv
         JOIN intel.financial_event_resolution e ON e.logical_transaction_id = cv.logical_transaction_id AND e.is_current
         LEFT JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id AND c.is_current
         LEFT JOIN intel.transaction_party_resolution p ON p.logical_transaction_id = e.logical_transaction_id AND p.is_current
        WHERE cv.canonical_transaction_version_id = $1`,
      [version],
    );
    assert.equal(pipeline.rows[0]!.event_family, "LOAN_REPAYMENT", "T15");
    assert.equal(pipeline.rows[0]!.category_code, null, "T15");
    assert.deepEqual(
      { amount: pipeline.rows[0]!.amount, direction: pipeline.rows[0]!.direction },
      beforePipeline.rows[0],
      "T15",
    );
    assert.notEqual(pipeline.rows[0]!.party_status, "RESOLVED", "T14");
    const linked = await admin.query<{ hits: string }>(
      `SELECT count(*)::text AS hits
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'ops'
          AND p.proname IN ('resolve_transaction_party', 'publish_transaction_structure', 'interpret_financial_event', 'resolve_financial_use')
          AND pg_get_functiondef(p.oid) LIKE '%financial_entity%'`,
    );
    assert.equal(linked.rows[0]!.hits, "0", "T13");
    const resolver = await admin.query<{ names: string | null }>(
      `SELECT string_agg(p.proname, ',') AS names
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'ops'
          AND has_function_privilege('monytix_api', p.oid, 'EXECUTE')
          AND p.proname IN ('mark_governed_identifier_collision', 'resolve_governed_entity')`,
    );
    assert.equal(resolver.rows[0]!.names, null, "T13");

    for (const role of ["monytix_api", "monytix_intelligence"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const allowed = await admin.query<{ allowed: boolean }>(
          "SELECT has_table_privilege($1, 'intel.entity_identifier', $2) AS allowed",
          [role, privilege],
        );
        assert.equal(allowed.rows[0]!.allowed, false, `T16 ${role} ${privilege}`);
      }
    }
    await assert.rejects(api.query("SET ROLE monytix"), (error: { code?: string }) => error.code === "42501", "T16");
    const member = await admin.query<{ member: boolean }>(
      "SELECT pg_has_role('monytix_api', 'monytix', 'member') AS member",
    );
    assert.equal(member.rows[0]!.member, false, "T16");

    const definitionBefore = (
      await admin.query<{ definition: string }>(
        "SELECT pg_get_functiondef('ops.mark_governed_identifier_collision()'::regprocedure) AS definition",
      )
    ).rows[0]!.definition;
    await admin.query("BEGIN");
    await admin.query(`
      CREATE OR REPLACE FUNCTION ops.mark_governed_identifier_collision()
      RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RETURN NEW; END $fn$
    `);
    await admin.query("ROLLBACK");
    const definitionAfter = (
      await admin.query<{ definition: string }>(
        "SELECT pg_get_functiondef('ops.mark_governed_identifier_collision()'::regprocedure) AS definition",
      )
    ).rows[0]!.definition;
    assert.equal(definitionAfter, definitionBefore, "T17");
    const beforeRollback = await statuses(touch);
    await admin.query("BEGIN");
    await admin.query(
      `UPDATE intel.entity_identifier SET effective_to = timestamptz '2026-01-01'
        WHERE normalized_value = $1 AND effective_from = timestamptz '2023-01-01'`,
      [touch],
    );
    await admin.query("ROLLBACK");
    assert.deepEqual(await statuses(touch), beforeRollback, "T17");

    const numeric = await admin.query<{ columns: string }>(
      `SELECT count(*)::text AS columns
         FROM information_schema.columns
        WHERE table_schema = 'ref' AND table_name = 'entity_registry_rule'
          AND (data_type IN ('numeric', 'integer', 'bigint', 'real', 'double precision', 'smallint')
               OR column_name ~* 'threshold|confidence|cutoff|score')`,
    );
    assert.equal(numeric.rows[0]!.columns, "0", "T19");
    assert.equal(definitionAfter.includes("ambiguity_status := 'UNIQUE'"), false, "T20");
    assert.equal(definitionAfter.includes("infinity"), true, "T03");

    const historicalAfter = await admin.query<{ logical_transaction_id: string }>(
      `SELECT logical_transaction_id FROM core.logical_transaction
        WHERE financial_account_id = $1 ORDER BY logical_transaction_id`,
      [historicalAccountId],
    );
    assert.deepEqual(historicalAfter.rows, historicalBefore.rows, "T15");
  } finally {
    await admin.end();
    await api.end();
    await left.end();
    await right.end();
  }
});
