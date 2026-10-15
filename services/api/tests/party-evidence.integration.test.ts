import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const historicalAccountId = "01a12b2d-3324-71e2-8fbd-4faf2ec90b2a";

type Party = {
  outcome: string;
  resolution_status?: string;
  matched_reason?: string;
  f10c_version?: string;
  is_current?: boolean;
};

test("M3.3 records F10C party evidence without inventing an entity", async (t) => {
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
    const adapter = await admin.query<{ adapter_version_id: string }>(
      "SELECT adapter_version_id FROM ref.adapter_registry WHERE adapter_id = 'parser-v4' AND adapter_version = 'v4'",
    );
    const adapterId = adapter.rows[0]!.adapter_version_id;
    const actorA = (
      await admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", `m33-a-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const actorB = (
      await admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", `m33-b-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const owners = await admin.query<{ owner_id: string }>(
      `INSERT INTO core.owner (owner_type, display_name)
       VALUES ('PERSON', $1), ('PERSON', $2), ('BUSINESS', $3)
       RETURNING owner_id`,
      [`m33-a-${stamp}`, `m33-b-${stamp}`, `m33-biz-${stamp}`],
    );
    const ownerA = owners.rows[0]!.owner_id;
    const ownerB = owners.rows[1]!.owner_id;
    const ownerBiz = owners.rows[2]!.owner_id;
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

    assert.equal((await admin.query("SELECT to_regclass('ref.financial_entity')")).rows[0]?.to_regclass ?? null, null, "no entity registry");
    const privileges = await admin.query<{ api_insert: boolean; api_execute: boolean; intel_execute: boolean }>(
      `SELECT has_table_privilege('monytix_api', 'intel.transaction_party_resolution', 'INSERT') AS api_insert,
              has_function_privilege('monytix_api', 'ops.resolve_transaction_party(uuid,uuid,uuid,text)', 'EXECUTE') AS api_execute,
              has_function_privilege('monytix_intelligence', 'ops.resolve_transaction_party(uuid,uuid,uuid,text)', 'EXECUTE') AS intel_execute`,
    );
    assert.equal(privileges.rows[0]?.api_insert, false, "writer grant");
    assert.equal(privileges.rows[0]?.api_execute, true, "writer grant");
    assert.equal(privileges.rows[0]?.intel_execute, false, "writer grant");
    await assert.rejects(
      api.query(
        `INSERT INTO intel.transaction_party_resolution (
           logical_transaction_id, canonical_transaction_version_id, f10c_version,
           resolution_status, entity_nature, owner_relationship, matched_reason, reason_codes
         ) VALUES ($1, $1, 'F10C-v1.2', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'NO_ENTITY_CANDIDATE', ARRAY['NO_ENTITY_CANDIDATE'])`,
        ["00000000-0000-0000-0000-000000000001"],
      ),
      "direct insert",
    );

    async function linkSource(ownerId: string, payload: Record<string, unknown>) {
      const batch = await admin.query<{ source_batch_id: string }>(
        `INSERT INTO core.source_batch (owner_id, source_type, status)
         VALUES ($1, 'BANK_STATEMENT_CSV', 'COMPLETED') RETURNING source_batch_id`,
        [ownerId],
      );
      const document = await admin.query<{ source_document_id: string }>(
        `INSERT INTO core.source_document (source_batch_id, owner_id, content_hash, status)
         VALUES ($1, $2, $3, 'AVAILABLE') RETURNING source_document_id`,
        [batch.rows[0]!.source_batch_id, ownerId, `${stamp}-${Math.random()}`],
      );
      const run = await admin.query<{ extraction_run_id: string }>(
        `INSERT INTO core.extraction_run (source_document_id, adapter_version_id, run_no, status, run_reason, completed_at)
         VALUES ($1, $2, 1, 'COMPLETED', 'INITIAL', clock_timestamp()) RETURNING extraction_run_id`,
        [document.rows[0]!.source_document_id, adapterId],
      );
      const record = await admin.query<{ source_record_id: string }>(
        `INSERT INTO core.source_record (
           extraction_run_id, extraction_sequence, raw_record_payload, raw_description, record_status
         ) VALUES ($1, 1, $2::jsonb, $3, 'TRANSACTION_CANDIDATE') RETURNING source_record_id`,
        [run.rows[0]!.extraction_run_id, JSON.stringify(payload), payload.description ?? null],
      );
      return {
        sourceRecordId: record.rows[0]!.source_record_id,
        extractionRunId: run.rows[0]!.extraction_run_id,
        sourceBatchId: batch.rows[0]!.source_batch_id,
      };
    }

    async function seed(input: {
      ownerId?: string;
      accountId?: string;
      direction?: "IN" | "OUT";
      description?: string | null;
      payload?: Record<string, unknown> | null;
    }): Promise<{ logicalId: string; versionId: string; sourceRecordId: string | null }> {
      const ownerId = input.ownerId ?? ownerA;
      const accountId = input.accountId ?? accountA;
      const source = input.payload ? await linkSource(ownerId, input.payload) : null;
      const sourceRecordId = source?.sourceRecordId ?? null;
      const logical = await admin.query<{ logical_transaction_id: string }>(
        "INSERT INTO core.logical_transaction (financial_account_id) VALUES ($1) RETURNING logical_transaction_id",
        [accountId],
      );
      const logicalId = logical.rows[0]!.logical_transaction_id;
      const version = await admin.query<{ canonical_transaction_version_id: string }>(
        `INSERT INTO core.canonical_transaction_version (
           logical_transaction_id, version_no, is_current, financial_account_id,
           transaction_date, amount, direction, currency_code, raw_description,
           extraction_sequence, normalization_status, normalization_confidence,
           normalization_version, change_provenance, duplicate_outcome, reversal_indicator,
           source_record_id, extraction_run_id, source_batch_id
         ) VALUES (
           $1, 1, false, $2, DATE '2026-06-01', 25.0000, $3, 'USD', $4,
           1, 'READY', 0, 'M3.3-test', $5, 'DISTINCT', false, $6, $7, $8
         ) RETURNING canonical_transaction_version_id`,
        [
          logicalId,
          accountId,
          input.direction ?? "OUT",
          input.description ?? null,
          sourceRecordId ? "INITIAL" : "MIGRATION_CORRECTION",
          sourceRecordId,
          source?.extractionRunId ?? null,
          source?.sourceBatchId ?? null,
        ],
      );
      const versionId = version.rows[0]!.canonical_transaction_version_id;
      await admin.query("SELECT core.activate_canonical_transaction_version($1::uuid, NULL)", [versionId]);
      if (sourceRecordId) {
        await admin.query(
          `INSERT INTO core.transaction_evidence_link (
             logical_transaction_id, source_record_id, canonical_transaction_version_id,
             relationship_type, identity_confidence, identity_reason_codes, is_primary_observation
           ) VALUES ($1, $2, $3, 'PRIMARY_VERSION_SOURCE', 1, ARRAY['M3_3_TEST'], true)`,
          [logicalId, sourceRecordId, versionId],
        );
      }
      return { logicalId, versionId, sourceRecordId };
    }

    async function attach(logicalId: string, versionId: string, ownerId: string, payload: Record<string, unknown>): Promise<string> {
      const sourceRecordId = (await linkSource(ownerId, payload)).sourceRecordId;
      await admin.query(
        `INSERT INTO core.transaction_evidence_link (
           logical_transaction_id, source_record_id, canonical_transaction_version_id,
           relationship_type, identity_confidence, identity_reason_codes, is_primary_observation
         ) VALUES ($1, $2, $3, 'CORROBORATING_SOURCE', 1, ARRAY['M3_3_TEST'], false)`,
        [logicalId, sourceRecordId, versionId],
      );
      return sourceRecordId;
    }

    async function party(logicalId: string, version?: string, actor = actorA, owner = ownerA): Promise<Party> {
      const result = await api.query<{ result: Party }>(
        "SELECT ops.resolve_transaction_party($1::uuid, $2::uuid, $3::uuid, $4) AS result",
        [actor, owner, logicalId, version ?? null],
      );
      return result.rows[0]!.result;
    }

    async function money(versionId: string) {
      const row = await admin.query<{ amount: string; direction: string; currency_code: string; financial_account_id: string }>(
        `SELECT amount::text, direction, currency_code, financial_account_id::text
           FROM core.canonical_transaction_version WHERE canonical_transaction_version_id = $1`,
        [versionId],
      );
      return row.rows[0]!;
    }

    const missing = await seed({ description: null });
    const missingParty = await party(missing.logicalId);
    assert.equal(missingParty.resolution_status, "UNKNOWN", "T02");
    assert.equal(missingParty.matched_reason, "NO_ENTITY_CANDIDATE", "T02");
    const missingObservations = await admin.query(
      "SELECT 1 FROM intel.entity_observation WHERE logical_transaction_id = $1",
      [missing.logicalId],
    );
    assert.equal(missingObservations.rowCount, 0, "T02");
    const missingStatus = await admin.query<{ resolution_status: string }>(
      "SELECT resolution_status FROM intel.transaction_party_resolution WHERE logical_transaction_id = $1",
      [missing.logicalId],
    );
    assert.notEqual(missingStatus.rows[0]?.resolution_status, "NOT_APPLICABLE", "T02");

    const unnamed = await seed({ description: "SWIGGY ORDER 441" });
    const unnamedParty = await party(unnamed.logicalId);
    assert.equal(unnamedParty.resolution_status, "UNKNOWN", "T04");
    assert.equal(unnamedParty.matched_reason, "NO_ENTITY_CANDIDATE", "T04");
    const selfWords = await seed({ description: "self transfer to own account" });
    const selfParty = await party(selfWords.logicalId);
    const selfRow = await admin.query<{ owner_relationship: string }>(
      "SELECT owner_relationship FROM intel.transaction_party_resolution WHERE logical_transaction_id = $1",
      [selfWords.logicalId],
    );
    assert.equal(selfParty.resolution_status, "UNKNOWN", "AC-05");
    assert.equal(selfRow.rows[0]?.owner_relationship, "UNKNOWN", "AC-05");

    const structured = await seed({
      description: "transfer",
      payload: {
        parse_version: "v4",
        fields: { counterparty_vpa: "sample@testbank", counterparty_name: "ALEX" },
      },
    });
    const beforeMoney = await money(structured.versionId);
    const structuredParty = await party(structured.logicalId);
    assert.equal(structuredParty.outcome, "created", "T01");
    assert.equal(structuredParty.resolution_status, "UNKNOWN", "T01");
    assert.equal(structuredParty.matched_reason, "VPA_ROLE_AMBIGUOUS", "T01");
    const structuredRows = await admin.query<{
      observation_type: string;
      normalized_value: string;
      source_confidence: string | null;
      entity_nature: string;
      commercial_role_hint: string | null;
      entity_id: string | null;
      identity_confidence: string | null;
    }>(
      `SELECT o.observation_type, o.normalized_value, o.source_confidence::text,
              r.entity_nature, r.commercial_role_hint, r.entity_id::text, r.identity_confidence::text
         FROM intel.entity_observation o
         JOIN intel.transaction_party_resolution r ON r.logical_transaction_id = o.logical_transaction_id
        WHERE o.logical_transaction_id = $1`,
      [structured.logicalId],
    );
    assert.equal(structuredRows.rows.some((row) => row.observation_type === "VPA" && row.normalized_value === "sample@testbank"), true, "T01");
    assert.equal(structuredRows.rows[0]?.entity_nature, "UNKNOWN", "T01");
    assert.equal(structuredRows.rows[0]?.commercial_role_hint, null, "T01");
    assert.equal(structuredRows.rows[0]?.entity_id, null, "T01");
    assert.equal(structuredRows.rows[0]?.identity_confidence, null, "T19");
    assert.equal(structuredRows.rows[0]?.source_confidence, null, "T19");
    const leaked = await admin.query<{ payload: string }>(
      `SELECT event_payload::text AS payload FROM ops.outbox_event
        WHERE aggregate_id = $1 AND semantic_trigger_code = 'TRANSACTION_PARTY_RESOLVED'`,
      [structured.logicalId],
    );
    assert.equal(leaked.rows[0]?.payload.toLowerCase().includes("sample@testbank"), false, "T01");
    assert.deepEqual(await money(structured.versionId), beforeMoney, "T15");
    const replay = await party(structured.logicalId);
    assert.equal(replay.outcome, "replay", "T10");
    const resolutionCount = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM intel.transaction_party_resolution WHERE logical_transaction_id = $1",
      [structured.logicalId],
    );
    assert.equal(resolutionCount.rows[0]?.count, "1", "T10");

    const parsed = await admin.query<{ parsed: Record<string, unknown> }>(
      "SELECT spendsense.parse_narration_v4($1, 'OUT') AS parsed",
      ["UPIOUT/123456789012/sample@testbank/note"],
    );
    const upi = await seed({ description: "UPIOUT/123456789012/sample@testbank/note", payload: parsed.rows[0]!.parsed });
    const upiParty = await party(upi.logicalId);
    assert.equal(upiParty.resolution_status, "UNKNOWN", "T05");
    assert.equal(upiParty.matched_reason, "VPA_ROLE_AMBIGUOUS", "T05");
    const upiNature = await admin.query<{ entity_nature: string; commercial_role_hint: string | null; normalized_value: string }>(
      `SELECT r.entity_nature, r.commercial_role_hint, o.normalized_value
         FROM intel.transaction_party_resolution r
         JOIN intel.entity_observation o ON o.logical_transaction_id = r.logical_transaction_id
        WHERE r.logical_transaction_id = $1 AND o.observation_type = 'VPA'`,
      [upi.logicalId],
    );
    assert.equal(upiNature.rows[0]?.normalized_value, "sample@testbank", "T05");
    assert.equal(upiNature.rows[0]?.entity_nature, "UNKNOWN", "T05");
    assert.equal(upiNature.rows[0]?.commercial_role_hint, null, "T05");

    const conflict = await seed({
      payload: { parse_version: "v4", fields: { counterparty_vpa: "one@testbank" } },
    });
    await attach(conflict.logicalId, conflict.versionId, ownerA, {
      parse_version: "v4",
      fields: { counterparty_vpa: "two@testbank" },
    });
    const conflictParty = await party(conflict.logicalId);
    assert.equal(conflictParty.resolution_status, "AMBIGUOUS", "T03");
    assert.equal(conflictParty.matched_reason, "MULTIPLE_ENTITY_CANDIDATES", "T03");
    const conflictEvidence = await admin.query<{ evidence_references: string[] }>(
      "SELECT evidence_references FROM intel.transaction_party_resolution WHERE logical_transaction_id = $1",
      [conflict.logicalId],
    );
    assert.equal(conflictEvidence.rows[0]?.evidence_references.length, 2, "T03");

    const sameNameLeft = await seed({
      payload: { parse_version: "v4", fields: { counterparty_vpa: "left@testbank", counterparty_name: "ALEX" } },
    });
    const sameNameRight = await seed({
      payload: { parse_version: "v4", fields: { counterparty_vpa: "right@testbank", counterparty_name: "ALEX" } },
    });
    await party(sameNameLeft.logicalId);
    await party(sameNameRight.logicalId);
    const homonyms = await admin.query<{ logical_transaction_id: string; normalized_value: string; entity_id: string | null }>(
      `SELECT o.logical_transaction_id::text, o.normalized_value, r.entity_id::text
         FROM intel.entity_observation o
         JOIN intel.transaction_party_resolution r ON r.logical_transaction_id = o.logical_transaction_id
        WHERE o.logical_transaction_id = ANY($1::uuid[]) AND o.observation_type = 'VPA'`,
      [[sameNameLeft.logicalId, sameNameRight.logicalId]],
    );
    assert.equal(new Set(homonyms.rows.map((row) => row.normalized_value)).size, 2, "T06");
    assert.equal(homonyms.rows.every((row) => row.entity_id === null), true, "T06");

    const repeatLeft = await seed({
      payload: { parse_version: "v4", fields: { counterparty_vpa: "repeat@testbank" } },
    });
    const repeatRight = await seed({
      payload: { parse_version: "v4", fields: { counterparty_vpa: "REPEAT@testbank" } },
    });
    await party(repeatLeft.logicalId);
    await party(repeatRight.logicalId);
    const repeats = await admin.query<{ party_resolution_id: string; normalized_value: string; entity_id: string | null; resolution_status: string }>(
      `SELECT r.party_resolution_id::text, o.normalized_value, r.entity_id::text, r.resolution_status
         FROM intel.transaction_party_resolution r
         JOIN intel.entity_observation o ON o.logical_transaction_id = r.logical_transaction_id AND o.observation_type = 'VPA'
        WHERE r.logical_transaction_id = ANY($1::uuid[])`,
      [[repeatLeft.logicalId, repeatRight.logicalId]],
    );
    assert.equal(repeats.rowCount, 2, "T07");
    assert.equal(repeats.rows.every((row) => row.normalized_value === "repeat@testbank"), true, "T07");
    assert.equal(repeats.rows.every((row) => row.entity_id === null && row.resolution_status === "UNKNOWN"), true, "T07");
    assert.equal(new Set(repeats.rows.map((row) => row.party_resolution_id)).size, 2, "T07");

    const foreign = await seed({ description: "shop purchase" });
    await attach(foreign.logicalId, foreign.versionId, ownerB, {
      parse_version: "v4",
      fields: { counterparty_vpa: "foreign@testbank" },
    });
    const foreignParty = await party(foreign.logicalId);
    assert.equal(foreignParty.resolution_status, "UNKNOWN", "T08");
    assert.equal(foreignParty.matched_reason, "NO_ENTITY_CANDIDATE", "T08");
    const foreignObservations = await admin.query(
      "SELECT 1 FROM intel.entity_observation WHERE logical_transaction_id = $1",
      [foreign.logicalId],
    );
    assert.equal(foreignObservations.rowCount, 0, "T08");

    const loan = await seed({ description: "monthly emi" });
    await api.query("SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL)", [actorA, ownerA, loan.logicalId]);
    await api.query("SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, NULL)", [actorA, ownerA, loan.logicalId]);
    const beforeMeaning = await admin.query<{ event_family: string; category_status: string; category_code: string | null }>(
      `SELECT e.event_family, c.category_status, c.category_code
         FROM intel.financial_event_resolution e
         JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id
        WHERE e.logical_transaction_id = $1 AND e.is_current AND c.is_current`,
      [loan.logicalId],
    );
    await party(loan.logicalId);
    const afterMeaning = await admin.query<{ event_family: string; category_status: string; category_code: string | null }>(
      `SELECT e.event_family, c.category_status, c.category_code
         FROM intel.financial_event_resolution e
         JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id
        WHERE e.logical_transaction_id = $1 AND e.is_current AND c.is_current`,
      [loan.logicalId],
    );
    assert.equal(beforeMeaning.rows[0]?.event_family, "LOAN_REPAYMENT", "T16");
    assert.deepEqual(afterMeaning.rows, beforeMeaning.rows, "T16");
    assert.equal(afterMeaning.rows[0]?.category_status, "NOT_APPLICABLE", "T17");
    assert.equal(afterMeaning.rows[0]?.category_code, null, "T17");

    const shop = await seed({
      description: "SWIGGY ORDER 441",
      payload: { parse_version: "v4", fields: { counterparty_vpa: "shop@testbank", counterparty_name: "SWIGGY" } },
    });
    await api.query("SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL)", [actorA, ownerA, shop.logicalId]);
    await api.query("SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, NULL)", [actorA, ownerA, shop.logicalId]);
    await party(shop.logicalId);
    const shopMeaning = await admin.query<{
      event_family: string | null;
      resolution_outcome: string;
      category_code: string | null;
      commercial_role_hint: string | null;
      entity_nature: string;
    }>(
      `SELECT e.event_family, e.resolution_outcome, c.category_code, p.commercial_role_hint, p.entity_nature
         FROM intel.financial_event_resolution e
         JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id
         JOIN intel.transaction_party_resolution p ON p.logical_transaction_id = e.logical_transaction_id
        WHERE e.logical_transaction_id = $1 AND e.is_current`,
      [shop.logicalId],
    );
    assert.equal(shopMeaning.rows[0]?.resolution_outcome, "UNKNOWN", "T18");
    assert.equal(shopMeaning.rows[0]?.event_family, null, "T18");
    assert.equal(shopMeaning.rows[0]?.category_code, null, "T18");
    assert.equal(shopMeaning.rows[0]?.commercial_role_hint, null, "T18");
    assert.equal(shopMeaning.rows[0]?.entity_nature, "UNKNOWN", "T18");

    const policyVersion = `F10C-v1.3-${stamp}`;
    await admin.query("INSERT INTO ref.party_resolution_policy (f10c_version) VALUES ($1)", [policyVersion]);
    await admin.query(
      `INSERT INTO ref.party_observation_field (f10c_version, field_name, observation_type, sensitivity_class, identifier_strength)
       SELECT $1, field_name, observation_type, sensitivity_class, identifier_strength
         FROM ref.party_observation_field WHERE f10c_version = 'F10C-v1.2'`,
      [policyVersion],
    );
    const upgraded = await party(structured.logicalId, policyVersion);
    assert.equal(upgraded.outcome, "created", "T11");
    const history = await admin.query<{ f10c_version: string; matched_reason: string; is_current: boolean }>(
      `SELECT f10c_version, matched_reason, is_current
         FROM intel.transaction_party_resolution
        WHERE logical_transaction_id = $1
        ORDER BY resolved_at`,
      [structured.logicalId],
    );
    assert.equal(history.rowCount, 2, "T12");
    assert.equal(history.rows[0]?.f10c_version, "F10C-v1.2", "T11");
    assert.equal(history.rows[0]?.matched_reason, "VPA_ROLE_AMBIGUOUS", "T11");
    assert.equal(history.rows[0]?.is_current, false, "T12");
    assert.equal(history.rows[1]?.f10c_version, policyVersion, "T12");
    assert.equal(history.rows[1]?.is_current, true, "T12");

    const concurrent = await seed({
      payload: { parse_version: "v4", fields: { counterparty_vpa: "concurrent@testbank" } },
    });
    const pair = await Promise.all([
      left.query<{ result: Party }>("SELECT ops.resolve_transaction_party($1::uuid, $2::uuid, $3::uuid, NULL) AS result", [actorA, ownerA, concurrent.logicalId]),
      right.query<{ result: Party }>("SELECT ops.resolve_transaction_party($1::uuid, $2::uuid, $3::uuid, NULL) AS result", [actorA, ownerA, concurrent.logicalId]),
    ]);
    assert.deepEqual(pair.map((item) => item.rows[0]!.result.outcome).sort(), ["created", "replay"], "T13");
    const concurrentCount = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM intel.transaction_party_resolution WHERE logical_transaction_id = $1",
      [concurrent.logicalId],
    );
    assert.equal(concurrentCount.rows[0]?.count, "1", "T13");

    const rolled = await seed({
      payload: { parse_version: "v4", fields: { counterparty_vpa: "rollback@testbank" } },
    });
    try {
      await api.query("BEGIN");
      const pending = await party(rolled.logicalId);
      assert.equal(pending.outcome, "created", "T14");
      await api.query("ROLLBACK");
    } catch (error) {
      await api.query("ROLLBACK");
      throw error;
    }
    const rolledRows = await admin.query(
      "SELECT 1 FROM intel.transaction_party_resolution WHERE logical_transaction_id = $1",
      [rolled.logicalId],
    );
    const rolledObservations = await admin.query(
      "SELECT 1 FROM intel.entity_observation WHERE logical_transaction_id = $1",
      [rolled.logicalId],
    );
    assert.equal(rolledRows.rowCount, 0, "T14");
    assert.equal(rolledObservations.rowCount, 0, "T14");

    const forbidden = await party(structured.logicalId, undefined, actorB, ownerA);
    assert.equal(forbidden.outcome, "forbidden", "owner");
    const business = await seed({ ownerId: ownerBiz, accountId: accountBiz, description: "monthly emi" });
    const businessParty = await party(business.logicalId, undefined, actorA, ownerBiz);
    assert.equal(businessParty.outcome, "business_isolated", "T09");
    const businessRows = await admin.query(
      "SELECT 1 FROM intel.transaction_party_resolution WHERE logical_transaction_id = $1",
      [business.logicalId],
    );
    assert.equal(businessRows.rowCount, 0, "T09");

    const absent = await admin.query(
      `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname IN ('txn_fact', 'txn_parsed', 'txn_enriched', 'txn_categorized')`,
    );
    assert.equal(absent.rowCount, 0, "T20");
    const historicalAfter = await admin.query<{ logical_transaction_id: string }>(
      `SELECT logical_transaction_id FROM core.logical_transaction
        WHERE financial_account_id = $1 ORDER BY logical_transaction_id`,
      [historicalAccountId],
    );
    assert.deepEqual(historicalAfter.rows, historicalBefore.rows, "historical account");
  } finally {
    await admin.end();
    await api.end();
    await left.end();
    await right.end();
  }
});
