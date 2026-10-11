import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;

test("M3.16 audits registry write paths without changing enforcement", async (t) => {
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
  try {
    const columns = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'intel' AND table_name = 'entity_identifier'
        ORDER BY ordinal_position`,
    );
    const names = columns.rows.map((row) => row.column_name);
    for (const required of [
      "entity_identifier_id",
      "entity_id",
      "identifier_type",
      "provider_scope",
      "normalized_value",
      "ambiguity_status",
      "effective_from",
      "effective_to",
    ]) {
      assert.equal(names.includes(required), true, required);
    }
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
    const statusOwner = await entity();
    const statusOther = await entity();
    const statusToken = `w01-${stamp}`;
    const statusRows = await admin.query<{ entity_identifier_id: string }>(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'BIC', 'w01', $3, $4, timestamptz '2024-01-01', timestamptz '2024-12-31'),
         ($2, 'BIC', 'w01', $3, $4, timestamptz '2024-06-01', timestamptz '2025-06-01')
       RETURNING entity_identifier_id`,
      [statusOwner, statusOther, statusToken, ruleId],
    );
    const direct = await admin.query<{ ambiguity_status: string }>(
      `UPDATE intel.entity_identifier
          SET ambiguity_status = 'UNIQUE'
        WHERE entity_identifier_id = $1
        RETURNING ambiguity_status`,
      [statusRows.rows[0]!.entity_identifier_id],
    );
    assert.equal(direct.rows[0]!.ambiguity_status, "UNIQUE", "W01");
    const stillOverlapping = await admin.query<{ rows: string }>(
      `SELECT count(*)::text AS rows
         FROM intel.entity_identifier a
         JOIN intel.entity_identifier b
           ON a.identifier_type = b.identifier_type
          AND a.provider_scope = b.provider_scope
          AND a.normalized_value = b.normalized_value
          AND a.entity_id <> b.entity_id
          AND a.effective_from < COALESCE(b.effective_to, 'infinity'::timestamptz)
          AND b.effective_from < COALESCE(a.effective_to, 'infinity'::timestamptz)
        WHERE a.entity_identifier_id = $1
          AND a.ambiguity_status = 'UNIQUE'`,
      [statusRows.rows[0]!.entity_identifier_id],
    );
    assert.equal(stillOverlapping.rows[0]!.rows, "1", "W08");

    const deadA = await entity();
    const deadB = await entity();
    const deadToken = `w02-${stamp}`;
    const deadRows = await admin.query<{ entity_identifier_id: string }>(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'BANK_ID', 'w02', $3, $4, timestamptz '2024-01-01', timestamptz '2024-04-01'),
         ($2, 'BANK_ID', 'w02', $3, $4, timestamptz '2024-08-01', timestamptz '2024-12-01')
       RETURNING entity_identifier_id`,
      [deadA, deadB, deadToken, ruleId],
    );
    await left.query("BEGIN");
    await right.query("BEGIN");
    const raced = await Promise.allSettled([
      left.query(
        `UPDATE intel.entity_identifier SET effective_to = timestamptz '2024-10-01'
          WHERE entity_identifier_id = $1`,
        [deadRows.rows[0]!.entity_identifier_id],
      ),
      right.query(
        `UPDATE intel.entity_identifier SET effective_from = timestamptz '2024-03-01'
          WHERE entity_identifier_id = $1`,
        [deadRows.rows[1]!.entity_identifier_id],
      ),
    ]);
    const failures = raced.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    const codes = failures.map((result) => (result.reason as { code?: string }).code);
    assert.equal(codes.includes("40P01"), true, "W02");
    if (raced[0].status === "rejected") await left.query("ROLLBACK");
    else await left.query("COMMIT");
    if (raced[1].status === "rejected") await right.query("ROLLBACK");
    else await right.query("COMMIT");
    const retryTarget = raced[0].status === "rejected" ? deadRows.rows[0]!.entity_identifier_id : deadRows.rows[1]!.entity_identifier_id;
    const retryColumn = raced[0].status === "rejected" ? "effective_to" : "effective_from";
    const retryValue = raced[0].status === "rejected" ? "2024-10-01" : "2024-03-01";
    await admin.query(
      `UPDATE intel.entity_identifier SET ${retryColumn} = $2::timestamptz WHERE entity_identifier_id = $1`,
      [retryTarget, retryValue],
    );
    const afterRetry = await admin.query<{ ambiguity_status: string }>(
      `SELECT ambiguity_status FROM intel.entity_identifier
        WHERE normalized_value = $1 ORDER BY entity_identifier_id`,
      [deadToken],
    );
    assert.deepEqual(
      afterRetry.rows.map((row) => row.ambiguity_status),
      ["AMBIGUOUS", "AMBIGUOUS"],
      "W03",
    );

    const scopeEntity = await entity();
    const scopeOther = await entity();
    const scopeToken = `w04-${stamp}`;
    const scopeRows = await admin.query<{ entity_identifier_id: string }>(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'MERCHANT_ID', 'w04-a', $3, $4, timestamptz '2024-01-01', timestamptz '2024-12-31'),
         ($2, 'MERCHANT_ID', 'w04-b', $3, $4, timestamptz '2024-06-01', timestamptz '2025-06-01')
       RETURNING entity_identifier_id`,
      [scopeEntity, scopeOther, scopeToken, ruleId],
    );
    const scopeUpdated = await admin.query<{ ambiguity_status: string }>(
      `UPDATE intel.entity_identifier SET provider_scope = 'w04-b'
        WHERE entity_identifier_id = $1
        RETURNING ambiguity_status`,
      [scopeRows.rows[0]!.entity_identifier_id],
    );
    assert.equal(scopeUpdated.rows[0]!.ambiguity_status, "UNIQUE", "W04");

    const valueEntity = await entity();
    const valueOther = await entity();
    const valueToken = `w05-target-${stamp}`;
    const valueRows = await admin.query<{ entity_identifier_id: string }>(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'TERMINAL_ID', 'w05', $3, $5, timestamptz '2024-01-01', timestamptz '2024-12-31'),
         ($2, 'TERMINAL_ID', 'w05', $4, $5, timestamptz '2024-06-01', timestamptz '2025-06-01')
       RETURNING entity_identifier_id`,
      [valueEntity, valueOther, `w05-source-${stamp}`, valueToken, ruleId],
    );
    const valueUpdated = await admin.query<{ ambiguity_status: string }>(
      `UPDATE intel.entity_identifier SET normalized_value = $2
        WHERE entity_identifier_id = $1
        RETURNING ambiguity_status`,
      [valueRows.rows[0]!.entity_identifier_id, valueToken],
    );
    assert.equal(valueUpdated.rows[0]!.ambiguity_status, "UNIQUE", "W05");

    const same = await entity();
    const moved = await entity();
    const attachToken = `w06-${stamp}`;
    const attachRows = await admin.query<{ entity_identifier_id: string; ambiguity_status: string }>(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'IFSC', 'w06', $2, $3, timestamptz '2024-01-01', timestamptz '2024-12-31'),
         ($1, 'IFSC', 'w06', $2, $3, timestamptz '2024-06-01', timestamptz '2025-06-01')
       RETURNING entity_identifier_id, ambiguity_status`,
      [same, attachToken, ruleId],
    );
    assert.deepEqual(
      attachRows.rows.map((row) => row.ambiguity_status),
      ["UNIQUE", "UNIQUE"],
      "W06",
    );
    const attached = await admin.query<{ ambiguity_status: string }>(
      `UPDATE intel.entity_identifier SET entity_id = $2
        WHERE entity_identifier_id = $1
        RETURNING ambiguity_status`,
      [attachRows.rows[0]!.entity_identifier_id, moved],
    );
    assert.equal(attached.rows[0]!.ambiguity_status, "UNIQUE", "W06");

    const periodOwner = await entity();
    await assert.rejects(
      admin.query(
        `INSERT INTO intel.entity_identifier (
           entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
           effective_from, effective_to
         ) VALUES ($1, 'BIC', 'w07', $2, $3, timestamptz '2024-06-01', timestamptz '2024-01-01')`,
        [periodOwner, `w07-${stamp}`, ruleId],
      ),
      (error: { code?: string }) => error.code === "23514",
      "W07",
    );

    for (const role of ["monytix_api", "monytix_intelligence"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const allowed = await admin.query<{ allowed: boolean }>(
          "SELECT has_table_privilege($1, 'intel.entity_identifier', $2) AS allowed",
          [role, privilege],
        );
        assert.equal(allowed.rows[0]!.allowed, false, `W09 ${role} ${privilege}`);
      }
    }
    const ownerBypass = await admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'monytix'",
    );
    assert.equal(ownerBypass.rows[0]!.rolsuper, true, "W09");
    assert.equal(ownerBypass.rows[0]!.rolbypassrls, true, "W09");

    const actor = (
      await admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", `m316-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const owner = (
      await admin.query<{ owner_id: string }>(
        `INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1) RETURNING owner_id`,
        [`m316-${stamp}`],
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
           $1, 1, false, $2, DATE '2026-06-01', 9.0000, 'OUT', 'USD', 'monthly emi',
           1, 'READY', 0, 'M3.16-audit', 'MIGRATION_CORRECTION', 'DISTINCT', false
         ) RETURNING canonical_transaction_version_id`,
        [logical, account],
      )
    ).rows[0]!.canonical_transaction_version_id;
    await admin.query("SELECT core.activate_canonical_transaction_version($1::uuid, NULL)", [version]);
    await api.query("SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
    await api.query("SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
    await api.query("SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
    await api.query("SELECT ops.resolve_transaction_party($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logical]);
    const pipeline = await admin.query<{ event_family: string; category_code: string | null; party_status: string | null }>(
      `SELECT e.event_family, c.category_code, p.resolution_status AS party_status
         FROM intel.financial_event_resolution e
         LEFT JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id AND c.is_current
         LEFT JOIN intel.transaction_party_resolution p ON p.logical_transaction_id = e.logical_transaction_id AND p.is_current
        WHERE e.logical_transaction_id = $1 AND e.is_current`,
      [logical],
    );
    assert.equal(pipeline.rows[0]!.event_family, "LOAN_REPAYMENT", "W10");
    assert.equal(pipeline.rows[0]!.category_code, null, "W10");
    assert.notEqual(pipeline.rows[0]!.party_status, "RESOLVED", "W10");
  } finally {
    await admin.query("ROLLBACK").catch(() => undefined);
    await left.query("ROLLBACK").catch(() => undefined);
    await right.query("ROLLBACK").catch(() => undefined);
    await admin.end();
    await api.end();
    await left.end();
    await right.end();
  }
});
