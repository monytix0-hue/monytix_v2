import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const historicalAccountId = "01a12b2d-3324-71e2-8fbd-4faf2ec90b2a";

test("M3.12 checks registry foundation integrity without resolving identity", async (t) => {
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
  const historicalBefore = await admin.query<{ logical_transaction_id: string }>(
    `SELECT logical_transaction_id FROM core.logical_transaction
      WHERE financial_account_id = $1 ORDER BY logical_transaction_id`,
    [historicalAccountId],
  );
  try {
    const ruleId = (
      await admin.query<{ entity_registry_rule_id: string }>(
        `SELECT entity_registry_rule_id FROM ref.entity_registry_rule
          WHERE registry_version = 'M3.11-v1' AND rule_code = 'FOUNDATION_ONLY'`,
      )
    ).rows[0]!.entity_registry_rule_id;
    const ruleCount = await admin.query<{ rows: string }>(
      `SELECT count(*)::text AS rows FROM ref.entity_registry_rule
        WHERE registry_version = 'M3.11-v1' AND rule_code = 'FOUNDATION_ONLY'`,
    );
    assert.equal(ruleCount.rows[0]!.rows, "1", "G8");

    async function entity() {
      const row = await admin.query<{ entity_id: string }>(
        `INSERT INTO intel.financial_entity (entity_nature, entity_registry_rule_id)
         VALUES ('ORGANIZATION', $1) RETURNING entity_id`,
        [ruleId],
      );
      return row.rows[0]!.entity_id;
    }

    const concurrentA = await entity();
    const concurrentB = await entity();
    const concurrentToken = `concurrent-${stamp}`;
    await left.query("BEGIN");
    await left.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id
       ) VALUES ($1, 'MERCHANT_ID', 'same-rail', $2, $3)`,
      [concurrentA, concurrentToken, ruleId],
    );
    const waiting = (async () => {
      await right.query("BEGIN");
      await right.query(
        `INSERT INTO intel.entity_identifier (
           entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id
         ) VALUES ($1, 'MERCHANT_ID', 'same-rail', $2, $3)`,
        [concurrentB, concurrentToken, ruleId],
      );
    })();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await left.query("COMMIT");
    await waiting;
    await right.query("COMMIT");
    const concurrent = await admin.query<{ ambiguity_status: string; entities: string }>(
      `SELECT ambiguity_status, count(DISTINCT entity_id)::text AS entities
         FROM intel.entity_identifier
        WHERE normalized_value = $1 AND effective_to IS NULL
        GROUP BY ambiguity_status`,
      [concurrentToken],
    );
    assert.deepEqual(concurrent.rows, [{ ambiguity_status: "AMBIGUOUS", entities: "2" }], "G1");

    const scopedA = await entity();
    const scopedB = await entity();
    const shared = `shared-${stamp}`;
    await admin.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id
       ) VALUES ($1, 'TERMINAL_ID', 'rail-a', $3, $4),
                ($2, 'TERMINAL_ID', 'rail-b', $3, $4)`,
      [scopedA, scopedB, shared, ruleId],
    );
    const scopes = await admin.query<{ ambiguity_status: string }>(
      `SELECT ambiguity_status FROM intel.entity_identifier
        WHERE normalized_value = $1 ORDER BY provider_scope`,
      [shared],
    );
    assert.deepEqual(
      scopes.rows.map((row) => row.ambiguity_status),
      ["UNIQUE", "UNIQUE"],
      "G2",
    );
    const typedA = await entity();
    const typedB = await entity();
    const typed = `typed-${stamp}`;
    await admin.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id
       ) VALUES ($1, 'MERCHANT_ID', 'rail-c', $3, $4),
                ($2, 'BILLER_ID', 'rail-c', $3, $4)`,
      [typedA, typedB, typed, ruleId],
    );
    const types = await admin.query<{ ambiguity_status: string }>(
      `SELECT ambiguity_status FROM intel.entity_identifier WHERE normalized_value = $1 ORDER BY identifier_type`,
      [typed],
    );
    assert.deepEqual(
      types.rows.map((row) => row.ambiguity_status),
      ["UNIQUE", "UNIQUE"],
      "G2",
    );

    const closedEntity = await entity();
    const laterEntity = await entity();
    const dated = `dated-${stamp}`;
    await admin.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES ($1, 'IFSC', 'bank-scope', $2, $3, timestamptz '2020-01-01', timestamptz '2020-06-01')`,
      [closedEntity, dated, ruleId],
    );
    await admin.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from
       ) VALUES ($1, 'IFSC', 'bank-scope', $2, $3, timestamptz '2024-01-01')`,
      [laterEntity, dated, ruleId],
    );
    const separated = await admin.query<{ ambiguity_status: string; closed: boolean }>(
      `SELECT ambiguity_status, effective_to IS NOT NULL AS closed
         FROM intel.entity_identifier
        WHERE normalized_value = $1
        ORDER BY effective_from`,
      [dated],
    );
    assert.deepEqual(
      separated.rows,
      [
        { ambiguity_status: "UNIQUE", closed: true },
        { ambiguity_status: "UNIQUE", closed: false },
      ],
      "G3",
    );

    const overlapA = await entity();
    const overlapB = await entity();
    const overlap = `overlap-${stamp}`;
    await admin.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'BIC', 'overlap-scope', $3, $4, timestamptz '2024-01-01', timestamptz '2024-12-31'),
         ($2, 'BIC', 'overlap-scope', $3, $4, timestamptz '2024-06-01', timestamptz '2025-06-01')`,
      [overlapA, overlapB, overlap, ruleId],
    );
    const overlapped = await admin.query<{ ambiguity_status: string }>(
      `SELECT ambiguity_status FROM intel.entity_identifier WHERE normalized_value = $1 ORDER BY effective_from`,
      [overlap],
    );
    assert.deepEqual(
      overlapped.rows.map((row) => row.ambiguity_status),
      ["AMBIGUOUS", "AMBIGUOUS"],
      "G3",
    );

    const live = await entity();
    const successor = await entity();
    const revoked = `revoked-${stamp}`;
    const inserted = await admin.query<{ entity_identifier_id: string; ambiguity_status: string }>(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from
       ) VALUES ($1, 'BANK_ID', 'revoke-scope', $2, $3, timestamptz '2021-01-01')
       RETURNING entity_identifier_id, ambiguity_status`,
      [live, revoked, ruleId],
    );
    await admin.query(
      `UPDATE intel.entity_identifier
          SET effective_to = timestamptz '2021-06-01'
        WHERE entity_identifier_id = $1`,
      [inserted.rows[0]!.entity_identifier_id],
    );
    await admin.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from
       ) VALUES ($1, 'BANK_ID', 'revoke-scope', $2, $3, timestamptz '2022-01-01')`,
      [successor, revoked, ruleId],
    );
    const history = await admin.query<{ ambiguity_status: string; effective_to: Date | null }>(
      `SELECT ambiguity_status, effective_to
         FROM intel.entity_identifier
        WHERE normalized_value = $1
        ORDER BY effective_from`,
      [revoked],
    );
    assert.equal(history.rowCount, 2, "G4");
    assert.equal(history.rows[0]!.ambiguity_status, inserted.rows[0]!.ambiguity_status, "G4");
    assert.ok(history.rows[0]!.effective_to instanceof Date, "G4");
    assert.equal(history.rows[1]!.ambiguity_status, "UNIQUE", "G4");

    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const allowed = await admin.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('monytix_api', 'intel.financial_entity', $1) AS allowed",
        [privilege],
      );
      assert.equal(allowed.rows[0]!.allowed, false, `G5 ${privilege}`);
    }
    const member = await admin.query<{ member: boolean }>(
      "SELECT pg_has_role('monytix_api', 'monytix', 'member') AS member",
    );
    assert.equal(member.rows[0]!.member, false, "G5");
    await assert.rejects(
      api.query("SET ROLE monytix"),
      (error: { code?: string }) => error.code === "42501",
      "G5",
    );
    await assert.rejects(
      api.query("GRANT SELECT ON intel.financial_entity TO monytix_api"),
      (error: { code?: string }) => error.code === "42501",
      "G5",
    );
    await assert.rejects(
      api.query("INSERT INTO intel.entity_identifier (entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id) VALUES ($1, 'IFSC', 'x', 'Y', $2)", [
        live,
        ruleId,
      ]),
      (error: { code?: string }) => error.code === "42501",
      "G5",
    );

    for (const nature of ["PERSON", "MERCHANT", "SELF"]) {
      await assert.rejects(
        admin.query(
          `INSERT INTO intel.financial_entity (entity_nature, entity_registry_rule_id) VALUES ($1, $2)`,
          [nature, ruleId],
        ),
        (error: { code?: string }) => error.code === "23514",
        `G6 ${nature}`,
      );
    }
    const holder = await entity();
    for (const identifierType of ["VPA", "ACCOUNT_TOKEN", "CARD_TOKEN"]) {
      await assert.rejects(
        admin.query(
          `INSERT INTO intel.entity_identifier (
             entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id
           ) VALUES ($1, $2, 'denied', $3, $4)`,
          [holder, identifierType, `${identifierType}-${stamp}`, ruleId],
        ),
        (error: { code?: string }) => error.code === "23514",
        `G6 ${identifierType}`,
      );
    }

    const aliasOwner = await entity();
    const alias = await admin.query<{ alias_confidence: string | null }>(
      `INSERT INTO intel.entity_alias (entity_id, alias_type, normalized_value, entity_registry_rule_id)
       VALUES ($1, 'LEGAL_NAME', $2, $3) RETURNING alias_confidence::text`,
      [aliasOwner, `name-${stamp}`, ruleId],
    );
    assert.equal(alias.rows[0]!.alias_confidence, null, "G7");
    await assert.rejects(
      admin.query(
        `INSERT INTO intel.entity_alias (
           entity_id, alias_type, normalized_value, alias_confidence, entity_registry_rule_id
         ) VALUES ($1, 'BRAND', $2, 0.5, $3)`,
        [aliasOwner, `brand-${stamp}`, ruleId],
      ),
      (error: { code?: string }) => error.code === "23514",
      "G7",
    );

    const beforeRollback = await admin.query<{ rows: string }>(
      "SELECT count(*)::text AS rows FROM intel.financial_entity",
    );
    await admin.query("BEGIN");
    await admin.query(
      `INSERT INTO intel.financial_entity (entity_nature, entity_registry_rule_id) VALUES ('UNKNOWN', $1)`,
      [ruleId],
    );
    await admin.query("ROLLBACK");
    const afterRollback = await admin.query<{ rows: string }>(
      "SELECT count(*)::text AS rows FROM intel.financial_entity",
    );
    assert.equal(afterRollback.rows[0]!.rows, beforeRollback.rows[0]!.rows, "G8");

    const historicalAfter = await admin.query<{ logical_transaction_id: string }>(
      `SELECT logical_transaction_id FROM core.logical_transaction
        WHERE financial_account_id = $1 ORDER BY logical_transaction_id`,
      [historicalAccountId],
    );
    assert.deepEqual(historicalAfter.rows, historicalBefore.rows, "G9");
    const preserved = await admin.query<{ present: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM ops.schema_migration WHERE migration_code = 'M3-3-F10C-PARTY')
         AND EXISTS (SELECT 1 FROM ops.schema_migration WHERE migration_code = 'M3-6-F10B-STRUCTURE')
       ) AS present`,
    );
    assert.equal(preserved.rows[0]!.present, true, "G9");

    const actor = (
      await admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", `m312-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const owner = (
      await admin.query<{ owner_id: string }>(
        `INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1) RETURNING owner_id`,
        [`m312-${stamp}`],
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
           1, 'READY', 0, 'M3.12-test', 'MIGRATION_CORRECTION', 'DISTINCT', false
         ) RETURNING canonical_transaction_version_id`,
        [logical, account],
      )
    ).rows[0]!.canonical_transaction_version_id;
    await admin.query("SELECT core.activate_canonical_transaction_version($1::uuid, NULL)", [version]);
    await api.query("SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
    await api.query("SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
    await api.query("SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
    await api.query("SELECT ops.resolve_transaction_party($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
    const pipeline = await admin.query<{ event_family: string; party_status: string | null; category_code: string | null }>(
      `SELECT e.event_family, p.resolution_status AS party_status, c.category_code
         FROM intel.financial_event_resolution e
         LEFT JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id AND c.is_current
         LEFT JOIN intel.transaction_party_resolution p ON p.logical_transaction_id = e.logical_transaction_id AND p.is_current
        WHERE e.logical_transaction_id = $1 AND e.is_current`,
      [logical],
    );
    assert.equal(pipeline.rows[0]!.event_family, "LOAN_REPAYMENT", "G10");
    assert.notEqual(pipeline.rows[0]!.party_status, "RESOLVED", "G10");
    assert.equal(pipeline.rows[0]!.category_code, null, "G10");
    const linked = await admin.query<{ hits: string }>(
      `SELECT count(*)::text AS hits
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'ops'
          AND p.proname = 'resolve_transaction_party'
          AND pg_get_functiondef(p.oid) LIKE '%financial_entity%'`,
    );
    assert.equal(linked.rows[0]!.hits, "0", "G10");
  } finally {
    await admin.end();
    await api.end();
    await left.end();
    await right.end();
  }
});
