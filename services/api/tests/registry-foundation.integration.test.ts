import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const historicalAccountId = "01a12b2d-3324-71e2-8fbd-4faf2ec90b2a";

const natures = [
  "ORGANIZATION",
  "FINANCIAL_INSTITUTION",
  "GOVERNMENT_BODY",
  "PLATFORM_OR_INTERMEDIARY",
  "UNKNOWN",
] as const;

test("M3.11 stores a non-personal registry foundation without resolving identity", async (t) => {
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
    const rule = await admin.query<{ entity_registry_rule_id: string }>(
      `SELECT entity_registry_rule_id FROM ref.entity_registry_rule
        WHERE registry_version = 'M3.11-v1' AND rule_code = 'FOUNDATION_ONLY'`,
    );
    const ruleId = rule.rows[0]!.entity_registry_rule_id;
    const stored: string[] = [];
    for (const nature of natures) {
      const row = await admin.query<{ entity_nature: string }>(
        `INSERT INTO intel.financial_entity (entity_nature, entity_registry_rule_id)
         VALUES ($1, $2) RETURNING entity_nature`,
        [nature, ruleId],
      );
      stored.push(row.rows[0]!.entity_nature);
    }
    assert.deepEqual(stored, [...natures], "AC1");

    for (const rejected of ["PERSON", "MERCHANT", "SELF"]) {
      await assert.rejects(
        admin.query(
          `INSERT INTO intel.financial_entity (entity_nature, entity_registry_rule_id)
           VALUES ($1, $2)`,
          [rejected, ruleId],
        ),
        (error: { code?: string }) => error.code === "23514",
        `AC2 ${rejected}`,
      );
    }
    for (const rejectedType of ["VPA", "ACCOUNT_TOKEN", "CARD_TOKEN", "USER_ALIAS"]) {
      await assert.rejects(
        admin.query(
          `INSERT INTO intel.entity_identifier (
             entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id
           )
           SELECT entity_id, $1, 'scope', $2, $3::uuid
             FROM intel.financial_entity
            WHERE entity_nature = 'ORGANIZATION'
            ORDER BY created_at DESC
            LIMIT 1`,
          [rejectedType, `rejected-${stamp}`, ruleId],
        ),
        (error: { code?: string }) => error.code === "23514",
        `AC2 ${rejectedType}`,
      );
    }

    const orgs = await admin.query<{ entity_id: string }>(
      `INSERT INTO intel.financial_entity (entity_nature, entity_registry_rule_id)
       VALUES ('ORGANIZATION', $1), ('ORGANIZATION', $1)
       RETURNING entity_id`,
      [ruleId],
    );
    const first = orgs.rows[0]!.entity_id;
    const second = orgs.rows[1]!.entity_id;
    const token = `mid-${stamp}`;
    await left.query("BEGIN");
    await left.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id
       ) VALUES ($1, 'MERCHANT_ID', 'acme-rail', $2, $3)`,
      [first, token, ruleId],
    );
    const waitingInsert = (async () => {
      await right.query("BEGIN");
      await right.query(
        `INSERT INTO intel.entity_identifier (
           entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id
         ) VALUES ($1, 'MERCHANT_ID', 'acme-rail', $2, $3)`,
        [second, token, ruleId],
      );
    })();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await left.query("COMMIT");
    await waitingInsert;
    await right.query("COMMIT");
    const collision = await admin.query<{ ambiguity_status: string; entities: string }>(
      `SELECT ambiguity_status, count(DISTINCT entity_id)::text AS entities
         FROM intel.entity_identifier
        WHERE identifier_type = 'MERCHANT_ID'
          AND provider_scope = 'acme-rail'
          AND normalized_value = $1
          AND effective_to IS NULL
        GROUP BY ambiguity_status`,
      [token],
    );
    assert.deepEqual(collision.rows, [{ ambiguity_status: "AMBIGUOUS", entities: "2" }], "AC3");
    const selected = await admin.query(
      `SELECT entity_id FROM intel.entity_identifier
        WHERE identifier_type = 'MERCHANT_ID'
          AND provider_scope = 'acme-rail'
          AND normalized_value = $1
          AND ambiguity_status = 'UNIQUE'
          AND effective_to IS NULL`,
      [token],
    );
    assert.equal(selected.rowCount, 0, "AC3");

    const alias = await admin.query<{ alias_confidence: string | null }>(
      `INSERT INTO intel.entity_alias (entity_id, alias_type, normalized_value, entity_registry_rule_id)
       VALUES ($1, 'BRAND', $2, $3)
       RETURNING alias_confidence::text`,
      [first, `brand-${stamp}`, ruleId],
    );
    assert.equal(alias.rows[0]!.alias_confidence, null, "AC4");
    await assert.rejects(
      admin.query(
        `INSERT INTO intel.entity_alias (
           entity_id, alias_type, normalized_value, alias_confidence, entity_registry_rule_id
         ) VALUES ($1, 'LEGAL_NAME', $2, 1, $3)`,
        [first, `legal-${stamp}`, ruleId],
      ),
      (error: { code?: string }) => error.code === "23514",
      "AC4",
    );
    await assert.rejects(
      admin.query(
        `INSERT INTO intel.entity_alias (entity_id, alias_type, normalized_value, entity_registry_rule_id)
         VALUES ($1, 'USER_ALIAS', $2, $3)`,
        [first, `user-${stamp}`, ruleId],
      ),
      (error: { code?: string }) => error.code === "23514",
      "AC4",
    );

    const numericPolicy = await admin.query<{ columns: string }>(
      `SELECT count(*)::text AS columns
         FROM information_schema.columns
        WHERE table_schema = 'ref'
          AND table_name = 'entity_registry_rule'
          AND (
            data_type IN ('numeric', 'integer', 'bigint', 'real', 'double precision', 'smallint')
            OR column_name ~* 'threshold|confidence|cutoff|score'
          )`,
    );
    assert.equal(numericPolicy.rows[0]!.columns, "0", "AC5");

    const ownerColumn = await admin.query<{ columns: string }>(
      `SELECT count(*)::text AS columns
         FROM information_schema.columns
        WHERE table_schema = 'intel'
          AND table_name IN ('financial_entity', 'entity_identifier', 'entity_alias')
          AND column_name = 'owner_id'`,
    );
    assert.equal(ownerColumn.rows[0]!.columns, "0", "AC6");
    for (const table of [
      "ref.entity_registry_rule",
      "intel.financial_entity",
      "intel.entity_identifier",
      "intel.entity_alias",
    ]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const allowed = await admin.query<{ allowed: boolean }>(
          "SELECT has_table_privilege('monytix_api', $1, $2) AS allowed",
          [table, privilege],
        );
        assert.equal(allowed.rows[0]!.allowed, false, `AC6 ${table} ${privilege}`);
      }
    }
    await assert.rejects(
      api.query(
        `INSERT INTO intel.financial_entity (entity_nature, entity_registry_rule_id)
         VALUES ('ORGANIZATION', $1)`,
        [ruleId],
      ),
      (error: { code?: string }) => error.code === "42501",
      "AC6",
    );

    const actor = (
      await admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", `m311-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const owner = (
      await admin.query<{ owner_id: string }>(
        `INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1) RETURNING owner_id`,
        [`m311-${stamp}`],
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
           $1, 1, false, $2, DATE '2026-06-01', 25.0000, 'OUT', 'USD', 'monthly emi',
           1, 'READY', 0, 'M3.11-test', 'MIGRATION_CORRECTION', 'DISTINCT', false
         ) RETURNING canonical_transaction_version_id`,
        [logical, account],
      )
    ).rows[0]!.canonical_transaction_version_id;
    await admin.query("SELECT core.activate_canonical_transaction_version($1::uuid, NULL)", [version]);
    async function pipeline() {
      await api.query("SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
      await api.query("SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
      await api.query("SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
      await api.query("SELECT ops.resolve_transaction_party($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
    }
    await pipeline();
    const beforeRegistry = await admin.query(
      `SELECT cv.amount::text, cv.direction,
              s.parse_status, e.event_family, e.resolution_outcome,
              c.category_code, p.resolution_status, p.entity_id::text
         FROM core.logical_transaction lt
         JOIN core.canonical_transaction_version cv ON cv.canonical_transaction_version_id = lt.current_canonical_version_id
         LEFT JOIN intel.transaction_structure s ON s.logical_transaction_id = lt.logical_transaction_id AND s.is_current
         LEFT JOIN intel.financial_event_resolution e ON e.logical_transaction_id = lt.logical_transaction_id AND e.is_current
         LEFT JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id AND c.is_current
         LEFT JOIN intel.transaction_party_resolution p ON p.logical_transaction_id = lt.logical_transaction_id AND p.is_current
        WHERE lt.logical_transaction_id = $1`,
      [logical],
    );
    await admin.query(
      `INSERT INTO intel.financial_entity (entity_nature, entity_registry_rule_id)
       VALUES ('ORGANIZATION', $1)`,
      [ruleId],
    );
    await pipeline();
    const afterRegistry = await admin.query(
      `SELECT cv.amount::text, cv.direction,
              s.parse_status, e.event_family, e.resolution_outcome,
              c.category_code, p.resolution_status, p.entity_id::text
         FROM core.logical_transaction lt
         JOIN core.canonical_transaction_version cv ON cv.canonical_transaction_version_id = lt.current_canonical_version_id
         LEFT JOIN intel.transaction_structure s ON s.logical_transaction_id = lt.logical_transaction_id AND s.is_current
         LEFT JOIN intel.financial_event_resolution e ON e.logical_transaction_id = lt.logical_transaction_id AND e.is_current
         LEFT JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id AND c.is_current
         LEFT JOIN intel.transaction_party_resolution p ON p.logical_transaction_id = lt.logical_transaction_id AND p.is_current
        WHERE lt.logical_transaction_id = $1`,
      [logical],
    );
    assert.deepEqual(afterRegistry.rows, beforeRegistry.rows, "AC7");
    assert.equal(afterRegistry.rows[0]!.event_family, "LOAN_REPAYMENT", "AC7");
    assert.notEqual(afterRegistry.rows[0]!.resolution_status, "RESOLVED", "AC7");
    assert.equal(afterRegistry.rows[0]!.category_code, null, "AC7");

    const migrations = await admin.query<{ present: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM ops.schema_migration WHERE migration_code = 'M3-3-F10C-PARTY')
         AND EXISTS (SELECT 1 FROM ops.schema_migration WHERE migration_code = 'M3-6-F10B-STRUCTURE')
         AND EXISTS (SELECT 1 FROM ops.schema_migration WHERE migration_code = 'M3-11-REGISTRY-FOUNDATION')
       ) AS present`,
    );
    assert.equal(migrations.rows[0]!.present, true, "AC8");
    const observations = await admin.query<{ rows: string }>(
      "SELECT count(*)::text AS rows FROM intel.entity_observation WHERE logical_transaction_id = $1",
      [logical],
    );
    assert.equal(observations.rows[0]!.rows, "0", "AC8");

    const beforeRollback = await admin.query<{ rows: string }>(
      "SELECT count(*)::text AS rows FROM intel.financial_entity",
    );
    await admin.query("BEGIN");
    await admin.query(
      `INSERT INTO intel.financial_entity (entity_nature, entity_registry_rule_id)
       VALUES ('GOVERNMENT_BODY', $1)`,
      [ruleId],
    );
    await admin.query("ROLLBACK");
    const afterRollback = await admin.query<{ rows: string }>(
      "SELECT count(*)::text AS rows FROM intel.financial_entity",
    );
    assert.equal(afterRollback.rows[0]!.rows, beforeRollback.rows[0]!.rows, "AC9");
    await admin.query("BEGIN");
    await admin.query(
      `INSERT INTO intel.financial_entity (entity_nature, entity_registry_rule_id)
       VALUES ('ORGANIZATION', $1)`,
      [ruleId],
    );
    await assert.rejects(
      admin.query(
        `INSERT INTO intel.financial_entity (entity_nature, entity_registry_rule_id)
         VALUES ('PERSON', $1)`,
        [ruleId],
      ),
      (error: { code?: string }) => error.code === "23514",
      "AC9",
    );
    await admin.query("ROLLBACK");
    const afterFailed = await admin.query<{ rows: string }>(
      "SELECT count(*)::text AS rows FROM intel.financial_entity",
    );
    assert.equal(afterFailed.rows[0]!.rows, beforeRollback.rows[0]!.rows, "AC9");

    const exposed = await admin.query<{ names: string | null }>(
      `SELECT string_agg(p.proname, ',') AS names
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE has_function_privilege('monytix_api', p.oid, 'EXECUTE')
          AND p.proname IN (
            'mark_governed_identifier_collision',
            'mark_governed_alias_collision'
          )`,
    );
    assert.equal(exposed.rows[0]!.names, null, "AC10");
    const readers = await admin.query<{ hits: string }>(
      `SELECT count(*)::text AS hits
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'ops'
          AND p.proname IN (
            'publish_transaction_structure',
            'interpret_financial_event',
            'resolve_financial_use',
            'resolve_transaction_party'
          )
          AND pg_get_functiondef(p.oid) LIKE '%financial_entity%'`,
    );
    assert.equal(readers.rows[0]!.hits, "0", "AC10");

    const historicalAfter = await admin.query<{ logical_transaction_id: string }>(
      `SELECT logical_transaction_id FROM core.logical_transaction
        WHERE financial_account_id = $1 ORDER BY logical_transaction_id`,
      [historicalAccountId],
    );
    assert.deepEqual(historicalAfter.rows, historicalBefore.rows, "AC8");
  } finally {
    await admin.end();
    await api.end();
    await left.end();
    await right.end();
  }
});
