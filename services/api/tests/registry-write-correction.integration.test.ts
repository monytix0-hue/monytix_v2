import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const historicalAccountId = "01a12b2d-3324-71e2-8fbd-4faf2ec90b2a";
const preservedToken = "overlap-1791734662543";

test("M3.18 guards key, status, and locked period writes without resolving identity", async (t) => {
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
  await left.query("SET statement_timeout = '8s'");
  await right.query("SET statement_timeout = '8s'");
  await admin.query("SET statement_timeout = '8s'");
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
  const concurrency: Record<string, string> = {};
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
          WHERE normalized_value = $1 ORDER BY entity_identifier_id`,
        [token],
      );
      return rows.rows.map((row) => row.ambiguity_status);
    }
    async function pair(
      token: string,
      scopeA: string,
      scopeB: string,
      typeA: string,
      typeB: string,
      valueA: string,
      valueB: string,
      fromA: string,
      toA: string,
      fromB: string,
      toB: string,
    ) {
      const ownerA = await entity();
      const ownerB = await entity();
      const inserted = await admin.query<{ entity_identifier_id: string }>(
        `INSERT INTO intel.entity_identifier (
           entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
           effective_from, effective_to
         ) VALUES
           ($1, $3, $5, $7, $9, $10::timestamptz, $11::timestamptz),
           ($2, $4, $6, $8, $9, $12::timestamptz, $13::timestamptz)
         RETURNING entity_identifier_id`,
        [ownerA, ownerB, typeA, typeB, scopeA, scopeB, valueA, valueB, ruleId, fromA, toA, fromB, toB],
      );
      return inserted.rows.map((row) => row.entity_identifier_id);
    }

    const typeToken = `t01-${stamp}`;
    const typeRows = await pair(
      typeToken, "t01", "t01", "MERCHANT_ID", "BILLER_ID", typeToken, typeToken,
      "2024-01-01", "2024-12-31", "2024-06-01", "2025-06-01",
    );
    await admin.query(
      `UPDATE intel.entity_identifier SET identifier_type = 'BILLER_ID' WHERE entity_identifier_id = $1`,
      [typeRows[0]],
    );
    assert.deepEqual(await statuses(typeToken), ["AMBIGUOUS", "AMBIGUOUS"], "T01");

    const scopeToken = `t02-${stamp}`;
    const scopeRows = await pair(
      scopeToken, "t02-a", "t02-b", "MERCHANT_ID", "MERCHANT_ID", scopeToken, scopeToken,
      "2024-01-01", "2024-12-31", "2024-06-01", "2025-06-01",
    );
    await admin.query(
      `UPDATE intel.entity_identifier SET provider_scope = 't02-b' WHERE entity_identifier_id = $1`,
      [scopeRows[0]],
    );
    assert.deepEqual(await statuses(scopeToken), ["AMBIGUOUS", "AMBIGUOUS"], "T02");

    const valueToken = `t03-target-${stamp}`;
    const valueRows = await pair(
      valueToken, "t03", "t03", "TERMINAL_ID", "TERMINAL_ID", `t03-source-${stamp}`, valueToken,
      "2024-01-01", "2024-12-31", "2024-06-01", "2025-06-01",
    );
    await admin.query(
      `UPDATE intel.entity_identifier SET normalized_value = $2 WHERE entity_identifier_id = $1`,
      [valueRows[0], valueToken],
    );
    assert.deepEqual(await statuses(valueToken), ["AMBIGUOUS", "AMBIGUOUS"], "T03");

    const touchToken = `t04-${stamp}`;
    const touchRows = await pair(
      touchToken, "t04-a", "t04-b", "BANK_ID", "BANK_ID", touchToken, touchToken,
      "2024-01-01", "2024-06-01", "2024-06-01", "2025-01-01",
    );
    await admin.query(
      `UPDATE intel.entity_identifier SET provider_scope = 't04-b' WHERE entity_identifier_id = $1`,
      [touchRows[0]],
    );
    assert.deepEqual(await statuses(touchToken), ["UNIQUE", "UNIQUE"], "T04");

    const closedToken = `t05-${stamp}`;
    const closedRows = await pair(
      closedToken, "t05-a", "t05-b", "BIC", "BIC", closedToken, closedToken,
      "2023-01-01", "2024-01-01", "2023-06-01", "2025-01-01",
    );
    await admin.query(
      `UPDATE intel.entity_identifier SET provider_scope = 't05-b' WHERE entity_identifier_id = $1`,
      [closedRows[0]],
    );
    assert.deepEqual(await statuses(closedToken), ["AMBIGUOUS", "AMBIGUOUS"], "T05");

    await assert.rejects(
      admin.query(
        `UPDATE intel.entity_identifier SET ambiguity_status = 'UNIQUE' WHERE entity_identifier_id = $1`,
        [closedRows[0]],
      ),
      (error: { code?: string }) => error.code === "23514",
      "T06",
    );
    assert.deepEqual(await statuses(closedToken), ["AMBIGUOUS", "AMBIGUOUS"], "T06");

    await admin.query(
      `SELECT ops.apply_governed_identifier_period($1, timestamptz '2023-01-01', timestamptz '2023-02-01')`,
      [closedRows[0]],
    );
    assert.deepEqual(await statuses(closedToken), ["AMBIGUOUS", "AMBIGUOUS"], "T07");

    const periodDefinition = (
      await admin.query<{ definition: string; security_definer: boolean }>(
        `SELECT pg_get_functiondef(p.oid) AS definition, p.prosecdef AS security_definer
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'ops' AND p.proname = 'apply_governed_identifier_period'`,
      )
    ).rows[0]!;
    assert.equal(periodDefinition.security_definer, false, "T08");
    assert.equal(
      periodDefinition.definition.indexOf("pg_advisory_xact_lock") < periodDefinition.definition.indexOf("UPDATE intel.entity_identifier"),
      true,
      "T08",
    );
    const lockA = await entity();
    const lockB = await entity();
    const lockToken = `t08-${stamp}`;
    const lockRows = await admin.query<{ entity_identifier_id: string }>(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'IFSC', 't08', $3, $4, timestamptz '2024-01-01', timestamptz '2024-04-01'),
         ($2, 'IFSC', 't08', $3, $4, timestamptz '2024-08-01', timestamptz '2024-12-01')
       RETURNING entity_identifier_id`,
      [lockA, lockB, lockToken, ruleId],
    );
    const lockKey = `IFSC|t08|${lockToken}`;
    await left.query("BEGIN");
    await left.query(
      `SELECT entity_identifier_id FROM intel.entity_identifier WHERE entity_identifier_id = $1 FOR UPDATE`,
      [lockRows.rows[0]!.entity_identifier_id],
    );
    const waitingPeriod = (async () => {
      await right.query("BEGIN");
      await right.query(
        `SELECT ops.apply_governed_identifier_period($1, timestamptz '2024-01-01', timestamptz '2024-10-01')`,
        [lockRows.rows[0]!.entity_identifier_id],
      );
    })();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const lockRace = await Promise.allSettled([
      left.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]),
      waitingPeriod,
    ]);
    concurrency.supportedLock = lockRace.map((result) => result.status === "rejected" ? (result.reason as { code?: string }).code ?? "error" : "ok").join(",");
    assert.equal(concurrency.supportedLock.includes("40P01"), true, "T08");
    await left.query("ROLLBACK").catch(() => undefined);
    await right.query("ROLLBACK").catch(() => undefined);
    await admin.query(
      `SELECT ops.apply_governed_identifier_period($1, timestamptz '2024-01-01', timestamptz '2024-10-01')`,
      [lockRows.rows[0]!.entity_identifier_id],
    );
    assert.deepEqual(await statuses(lockToken), ["AMBIGUOUS", "AMBIGUOUS"], "T08");

    const fnA = await entity();
    const fnB = await entity();
    const fnToken = `t09-${stamp}`;
    const fnRows = await admin.query<{ entity_identifier_id: string }>(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'BIC', 't09', $3, $4, timestamptz '2024-01-01', timestamptz '2024-04-01'),
         ($2, 'BIC', 't09', $3, $4, timestamptz '2024-08-01', timestamptz '2024-12-01')
       RETURNING entity_identifier_id`,
      [fnA, fnB, fnToken, ruleId],
    );
    await left.query("BEGIN");
    await left.query(
      `SELECT ops.apply_governed_identifier_period($1, timestamptz '2024-01-01', timestamptz '2024-10-01')`,
      [fnRows.rows[0]!.entity_identifier_id],
    );
    const waitingPeriodUpdate = (async () => {
      await right.query("BEGIN");
      await right.query(
        `SELECT ops.apply_governed_identifier_period($1, timestamptz '2024-03-01', timestamptz '2024-12-01')`,
        [fnRows.rows[1]!.entity_identifier_id],
      );
    })();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const stillWaiting = await admin.query<{ waiting: string }>(
      `SELECT count(*)::text AS waiting
         FROM pg_stat_activity
        WHERE state = 'active'
          AND wait_event_type = 'Lock'
          AND query LIKE 'SELECT ops.apply_governed_identifier_period%'`,
    );
    concurrency.supportedDates = stillWaiting.rows[0]!.waiting === "1" ? "second-waited-on-scope-lock" : "second-did-not-wait";
    await left.query("COMMIT");
    await waitingPeriodUpdate;
    await right.query("COMMIT");
    assert.equal(concurrency.supportedDates, "second-waited-on-scope-lock", "T09");
    assert.deepEqual(await statuses(fnToken), ["AMBIGUOUS", "AMBIGUOUS"], "T09");

    const insertA = await entity();
    const insertB = await entity();
    const insertToken = `t09-insert-${stamp}`;
    await left.query("BEGIN");
    await left.query(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES ($1, 'BANK_ID', 't09i', $2, $3, timestamptz '2023-01-01', timestamptz '2024-01-01')`,
      [insertA, insertToken, ruleId],
    );
    const waitingInsert = (async () => {
      await right.query("BEGIN");
      await right.query(
        `INSERT INTO intel.entity_identifier (
           entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
           effective_from, effective_to
         ) VALUES ($1, 'BANK_ID', 't09i', $2, $3, timestamptz '2023-06-01', timestamptz '2025-01-01')`,
        [insertB, insertToken, ruleId],
      );
    })();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await left.query("COMMIT");
    await waitingInsert;
    await right.query("COMMIT");
    assert.deepEqual(await statuses(insertToken), ["AMBIGUOUS", "AMBIGUOUS"], "T09");

    const directA = await entity();
    const directB = await entity();
    const directToken = `t10-${stamp}`;
    const directRows = await admin.query<{ entity_identifier_id: string }>(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'MERCHANT_ID', 't10', $3, $4, timestamptz '2024-01-01', timestamptz '2024-04-01'),
         ($2, 'MERCHANT_ID', 't10', $3, $4, timestamptz '2024-08-01', timestamptz '2024-12-01')
       RETURNING entity_identifier_id`,
      [directA, directB, directToken, ruleId],
    );
    await left.query("BEGIN");
    await right.query("BEGIN");
    const directRace = await Promise.allSettled([
      left.query(
        `UPDATE intel.entity_identifier SET effective_to = timestamptz '2024-10-01' WHERE entity_identifier_id = $1`,
        [directRows.rows[0]!.entity_identifier_id],
      ),
      right.query(
        `UPDATE intel.entity_identifier SET effective_from = timestamptz '2024-03-01' WHERE entity_identifier_id = $1`,
        [directRows.rows[1]!.entity_identifier_id],
      ),
    ]);
    concurrency.directDates = directRace.map((result) => result.status === "rejected" ? (result.reason as { code?: string }).code ?? "error" : "ok").join(",");
    assert.equal(concurrency.directDates.includes("40P01"), true, "T10");
    if (directRace[0].status === "rejected") await left.query("ROLLBACK");
    else await left.query("COMMIT");
    if (directRace[1].status === "rejected") await right.query("ROLLBACK");
    else await right.query("COMMIT");
    const retryId = directRace[0].status === "rejected" ? directRows.rows[0]!.entity_identifier_id : directRows.rows[1]!.entity_identifier_id;
    const retrySql = directRace[0].status === "rejected"
      ? `UPDATE intel.entity_identifier SET effective_to = timestamptz '2024-10-01' WHERE entity_identifier_id = $1`
      : `UPDATE intel.entity_identifier SET effective_from = timestamptz '2024-03-01' WHERE entity_identifier_id = $1`;
    await admin.query(retrySql, [retryId]);
    assert.deepEqual(await statuses(directToken), ["AMBIGUOUS", "AMBIGUOUS"], "T10");

    const scopeRaceToken = `t10-scope-${stamp}`;
    const scopeRaceRows = await pair(
      scopeRaceToken, "scope-a", "scope-b", "MERCHANT_ID", "MERCHANT_ID", scopeRaceToken, scopeRaceToken,
      "2024-01-01", "2024-12-31", "2024-06-01", "2025-06-01",
    );
    await left.query("BEGIN");
    await left.query(
      `UPDATE intel.entity_identifier SET provider_scope = 'scope-shared' WHERE entity_identifier_id = $1`,
      [scopeRaceRows[0]],
    );
    const waitingScope = (async () => {
      await right.query("BEGIN");
      await right.query(
        `UPDATE intel.entity_identifier SET provider_scope = 'scope-shared' WHERE entity_identifier_id = $1`,
        [scopeRaceRows[1]],
      );
    })();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const scopeWaiting = await admin.query<{ waiting: string }>(
      `SELECT count(*)::text AS waiting FROM pg_stat_activity
        WHERE state = 'active' AND wait_event_type = 'Lock' AND query LIKE 'UPDATE intel.entity_identifier SET provider_scope%'`,
    );
    concurrency.scopeChanges = scopeWaiting.rows[0]!.waiting === "1" ? "second-waited-on-scope-lock" : "second-did-not-wait";
    await left.query("COMMIT");
    await waitingScope;
    await right.query("COMMIT");
    assert.equal(concurrency.scopeChanges, "second-waited-on-scope-lock", "T10");
    assert.deepEqual(await statuses(scopeRaceToken), ["AMBIGUOUS", "AMBIGUOUS"], "T10");

    const scopeDeadToken = `t10-scope-dead-${stamp}`;
    const scopeDeadRows = await pair(
      scopeDeadToken, "dead-a", "dead-b", "BILLER_ID", "BILLER_ID", scopeDeadToken, scopeDeadToken,
      "2024-01-01", "2024-12-31", "2024-06-01", "2025-06-01",
    );
    await left.query("SET lock_timeout = '2s'");
    await right.query("SET lock_timeout = '2s'");
    await left.query("BEGIN");
    await right.query("BEGIN");
    const scopeDead = await Promise.allSettled([
      left.query(
        `UPDATE intel.entity_identifier SET provider_scope = 'dead-shared' WHERE entity_identifier_id = $1`,
        [scopeDeadRows[0]],
      ),
      right.query(
        `UPDATE intel.entity_identifier SET provider_scope = 'dead-shared' WHERE entity_identifier_id = $1`,
        [scopeDeadRows[1]],
      ),
    ]);
    concurrency.simultaneousScope = scopeDead.map((result) => result.status === "rejected" ? (result.reason as { code?: string }).code ?? "error" : "ok").join(",");
    if (scopeDead[0].status === "rejected") await left.query("ROLLBACK");
    else await left.query("COMMIT");
    if (scopeDead[1].status === "rejected") await right.query("ROLLBACK");
    else await right.query("COMMIT");
    await left.query("SET lock_timeout = '0'");
    await right.query("SET lock_timeout = '0'");
    if (scopeDead[0].status === "rejected") {
      await admin.query(`UPDATE intel.entity_identifier SET provider_scope = 'dead-shared' WHERE entity_identifier_id = $1`, [scopeDeadRows[0]]);
    }
    if (scopeDead[1].status === "rejected") {
      await admin.query(`UPDATE intel.entity_identifier SET provider_scope = 'dead-shared' WHERE entity_identifier_id = $1`, [scopeDeadRows[1]]);
    }
    assert.deepEqual(await statuses(scopeDeadToken), ["AMBIGUOUS", "AMBIGUOUS"], "T10");

    const valueRaceToken = `t10-value-${stamp}`;
    const valueRaceRows = await pair(
      valueRaceToken, "t10v", "t10v", "TERMINAL_ID", "TERMINAL_ID", `value-a-${stamp}`, `value-b-${stamp}`,
      "2024-01-01", "2024-12-31", "2024-06-01", "2025-06-01",
    );
    await left.query("BEGIN");
    await left.query(
      `UPDATE intel.entity_identifier SET normalized_value = $2 WHERE entity_identifier_id = $1`,
      [valueRaceRows[0], valueRaceToken],
    );
    const waitingValue = (async () => {
      await right.query("BEGIN");
      await right.query(
        `UPDATE intel.entity_identifier SET normalized_value = $2 WHERE entity_identifier_id = $1`,
        [valueRaceRows[1], valueRaceToken],
      );
    })();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const valueWaiting = await admin.query<{ waiting: string }>(
      `SELECT count(*)::text AS waiting FROM pg_stat_activity
        WHERE state = 'active' AND wait_event_type = 'Lock' AND query LIKE 'UPDATE intel.entity_identifier SET normalized_value%'`,
    );
    concurrency.valueChanges = valueWaiting.rows[0]!.waiting === "1" ? "second-waited-on-scope-lock" : "second-did-not-wait";
    await left.query("COMMIT");
    await waitingValue;
    await right.query("COMMIT");
    assert.equal(concurrency.valueChanges, "second-waited-on-scope-lock", "T10");
    assert.deepEqual(await statuses(valueRaceToken), ["AMBIGUOUS", "AMBIGUOUS"], "T10");

    const same = await entity();
    const moved = await entity();
    const attachToken = `t11-${stamp}`;
    const attachRows = await admin.query<{ entity_identifier_id: string; ambiguity_status: string }>(
      `INSERT INTO intel.entity_identifier (
         entity_id, identifier_type, provider_scope, normalized_value, entity_registry_rule_id,
         effective_from, effective_to
       ) VALUES
         ($1, 'IFSC', 't11', $2, $3, timestamptz '2024-01-01', timestamptz '2024-12-31'),
         ($1, 'IFSC', 't11', $2, $3, timestamptz '2024-06-01', timestamptz '2025-06-01')
       RETURNING entity_identifier_id, ambiguity_status`,
      [same, attachToken, ruleId],
    );
    assert.deepEqual(attachRows.rows.map((row) => row.ambiguity_status), ["UNIQUE", "UNIQUE"], "T11");
    const attached = await admin.query<{ ambiguity_status: string }>(
      `UPDATE intel.entity_identifier SET entity_id = $2 WHERE entity_identifier_id = $1 RETURNING ambiguity_status`,
      [attachRows.rows[0]!.entity_identifier_id, moved],
    );
    assert.equal(attached.rows[0]!.ambiguity_status, "UNIQUE", "T11");
    const triggerDef = (
      await admin.query<{ definition: string }>(
        "SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname = 'trg_entity_identifier_collision'",
      )
    ).rows[0]!.definition;
    const updatedColumns = triggerDef.match(/UPDATE OF ([A-Z0-9_, ]+)/i)?.[1] ?? "";
    assert.equal(updatedColumns.split(",").map((column) => column.trim()).includes("entity_id"), false, "T11");

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
        ["firebase", `m318-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const owner = (
      await admin.query<{ owner_id: string }>(
        `INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1) RETURNING owner_id`,
        [`m318-${stamp}`],
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
           1, 'READY', 0, 'M3.18-test', 'MIGRATION_CORRECTION', 'DISTINCT', false
         ) RETURNING canonical_transaction_version_id`,
        [logical, account],
      )
    ).rows[0]!.canonical_transaction_version_id;
    await admin.query("SELECT core.activate_canonical_transaction_version($1::uuid, NULL)", [version]);
    const beforePipeline = await admin.query(
      `SELECT amount::text AS amount, direction FROM core.canonical_transaction_version WHERE canonical_transaction_version_id = $1`,
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
    const linked = await admin.query<{ hits: string }>(
      `SELECT count(*)::text AS hits
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'ops'
          AND p.proname IN ('resolve_transaction_party', 'publish_transaction_structure', 'interpret_financial_event', 'resolve_financial_use')
          AND pg_get_functiondef(p.oid) LIKE '%financial_entity%'`,
    );
    assert.equal(linked.rows[0]!.hits, "0", "T13");
    assert.notEqual(pipeline.rows[0]!.party_status, "RESOLVED", "T14");
    assert.equal(pipeline.rows[0]!.event_family, "LOAN_REPAYMENT", "T15");
    assert.equal(pipeline.rows[0]!.category_code, null, "T15");
    assert.deepEqual(
      { amount: pipeline.rows[0]!.amount, direction: pipeline.rows[0]!.direction },
      beforePipeline.rows[0],
      "T15",
    );
    const historicalAfter = await admin.query<{ logical_transaction_id: string }>(
      `SELECT logical_transaction_id FROM core.logical_transaction
        WHERE financial_account_id = $1 ORDER BY logical_transaction_id`,
      [historicalAccountId],
    );
    assert.deepEqual(historicalAfter.rows, historicalBefore.rows, "T15");

    for (const role of ["monytix_api", "monytix_intelligence"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const allowed = await admin.query<{ allowed: boolean }>(
          "SELECT has_table_privilege($1, 'intel.entity_identifier', $2) AS allowed",
          [role, privilege],
        );
        assert.equal(allowed.rows[0]!.allowed, false, `T16 ${role} ${privilege}`);
      }
      for (const fn of [
        "ops.mark_governed_identifier_collision()",
        "ops.apply_governed_identifier_period(uuid,timestamptz,timestamptz)",
      ]) {
        const execute = await admin.query<{ allowed: boolean }>(
          "SELECT has_function_privilege($1, $2, 'EXECUTE') AS allowed",
          [role, fn],
        );
        assert.equal(execute.rows[0]!.allowed, false, `T16 ${role} ${fn}`);
      }
    }

    const definitionBefore = periodDefinition.definition;
    await admin.query("BEGIN");
    await admin.query(`
      CREATE OR REPLACE FUNCTION ops.apply_governed_identifier_period(
          p_entity_identifier_id uuid,
          p_effective_from timestamptz,
          p_effective_to timestamptz
      )
      RETURNS SETOF intel.entity_identifier LANGUAGE plpgsql AS $fn$ BEGIN RETURN; END $fn$
    `);
    await admin.query("ROLLBACK");
    const definitionAfter = (
      await admin.query<{ definition: string }>(
        "SELECT pg_get_functiondef('ops.apply_governed_identifier_period(uuid,timestamptz,timestamptz)'::regprocedure) AS definition",
      )
    ).rows[0]!.definition;
    assert.equal(definitionAfter, definitionBefore, "T17");
    const beforeRollback = await statuses(touchToken);
    await admin.query("BEGIN");
    await admin.query(
      `SELECT ops.apply_governed_identifier_period($1, timestamptz '2024-01-01', timestamptz '2026-01-01')`,
      [touchRows[0]],
    );
    await admin.query("ROLLBACK");
    assert.deepEqual(await statuses(touchToken), beforeRollback, "T17");

    const numeric = await admin.query<{ columns: string }>(
      `SELECT count(*)::text AS columns
         FROM information_schema.columns
        WHERE table_schema = 'ref' AND table_name = 'entity_registry_rule'
          AND (data_type IN ('numeric', 'integer', 'bigint', 'real', 'double precision', 'smallint')
               OR column_name ~* 'threshold|confidence|cutoff|score|retention')`,
    );
    assert.equal(numeric.rows[0]!.columns, "0", "T19");
    const collisionDef = (
      await admin.query<{ definition: string }>(
        "SELECT pg_get_functiondef('ops.mark_governed_identifier_collision()'::regprocedure) AS definition",
      )
    ).rows[0]!.definition;
    assert.equal(collisionDef.includes("ambiguity_status := 'UNIQUE'"), false, "T07");
    assert.equal(definitionAfter.includes("MERCHANT_PURCHASE"), false, "T20");
    assert.equal(collisionDef.includes("MERCHANT_PURCHASE"), false, "T20");
    t.diagnostic(JSON.stringify(concurrency));
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
