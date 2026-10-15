import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { createManualTransactionStore } from "../src/transactions/manual.js";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const historicalAccountId = "01a12b2d-3324-71e2-8fbd-4faf2ec90b2a";

test("M3.7 runs F10B, F10C, F10D, and F10E on one canonical transaction", async (t) => {
  if (!databaseUrl || !adminUrl) {
    t.skip("local Postgres 17 is not configured");
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  const api = new pg.Client({ connectionString: databaseUrl });
  const left = new pg.Client({ connectionString: databaseUrl });
  const right = new pg.Client({ connectionString: databaseUrl });
  const store = createManualTransactionStore(databaseUrl);
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
        ["firebase", `m37-a-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const actorB = (
      await admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", `m37-b-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const owners = await admin.query<{ owner_id: string }>(
      `INSERT INTO core.owner (owner_type, display_name)
       VALUES ('PERSON', $1), ('PERSON', $2), ('BUSINESS', $3)
       RETURNING owner_id`,
      [`m37-a-${stamp}`, `m37-b-${stamp}`, `m37-biz-${stamp}`],
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

    async function pipeline(logicalId: string, actor = actorA, owner = ownerA) {
      await api.query("SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logicalId]);
      await api.query("SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logicalId]);
      await api.query("SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logicalId]);
      await api.query("SELECT ops.resolve_transaction_party($1::uuid, $2::uuid, $3::uuid, NULL)", [actor, owner, logicalId]);
    }

    async function seed(input: {
      ownerId?: string;
      accountId?: string;
      direction?: "IN" | "OUT";
      description?: string | null;
      reversal?: boolean;
      payload?: Record<string, unknown> | null;
    }) {
      const ownerId = input.ownerId ?? ownerA;
      const accountId = input.accountId ?? accountA;
      let sourceRecordId: string | null = null;
      let extractionRunId: string | null = null;
      let sourceBatchId: string | null = null;
      if (input.payload) {
        const batch = await admin.query<{ source_batch_id: string }>(
          `INSERT INTO core.source_batch (owner_id, source_type, status)
           VALUES ($1, 'BANK_STATEMENT_CSV', 'COMPLETED') RETURNING source_batch_id`,
          [ownerId],
        );
        sourceBatchId = batch.rows[0]!.source_batch_id;
        const document = await admin.query<{ source_document_id: string }>(
          `INSERT INTO core.source_document (source_batch_id, owner_id, uploaded_by_actor_id, content_hash, status)
           VALUES ($1, $2, $3, $4, 'AVAILABLE') RETURNING source_document_id`,
          [sourceBatchId, ownerId, actorA, `${stamp}-${Math.random()}`],
        );
        const run = await admin.query<{ extraction_run_id: string }>(
          `INSERT INTO core.extraction_run (source_document_id, adapter_version_id, run_no, status, run_reason, completed_at)
           VALUES ($1, $2, 1, 'COMPLETED', 'INITIAL', clock_timestamp()) RETURNING extraction_run_id`,
          [document.rows[0]!.source_document_id, adapterId],
        );
        extractionRunId = run.rows[0]!.extraction_run_id;
        const record = await admin.query<{ source_record_id: string }>(
          `INSERT INTO core.source_record (
             extraction_run_id, extraction_sequence, raw_record_payload, raw_description, record_status
           ) VALUES ($1, 1, $2::jsonb, $3, 'TRANSACTION_CANDIDATE') RETURNING source_record_id`,
          [extractionRunId, JSON.stringify(input.payload), input.description ?? null],
        );
        sourceRecordId = record.rows[0]!.source_record_id;
      }
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
           1, 'READY', 0, 'M3.7-test', $5, 'DISTINCT', $6, $7, $8, $9
         ) RETURNING canonical_transaction_version_id`,
        [
          logicalId,
          accountId,
          input.direction ?? "OUT",
          input.description ?? null,
          sourceRecordId ? "INITIAL" : "MIGRATION_CORRECTION",
          input.reversal ?? false,
          sourceRecordId,
          extractionRunId,
          sourceBatchId,
        ],
      );
      const versionId = version.rows[0]!.canonical_transaction_version_id;
      await admin.query("SELECT core.activate_canonical_transaction_version($1::uuid, NULL)", [versionId]);
      if (sourceRecordId) {
        await admin.query(
          `INSERT INTO core.transaction_evidence_link (
             logical_transaction_id, source_record_id, canonical_transaction_version_id,
             relationship_type, identity_confidence, identity_reason_codes, is_primary_observation
           ) VALUES ($1, $2, $3, 'PRIMARY_VERSION_SOURCE', 1, ARRAY['M3_7_TEST'], true)`,
          [logicalId, sourceRecordId, versionId],
        );
      }
      return { logicalId, versionId };
    }

    async function snapshot(logicalId: string) {
      const row = await admin.query<{
        amount: string;
        direction: string;
        currency_code: string;
        payment_rail: string | null;
        parse_status: string | null;
        identifier_role: string | null;
        event_family: string | null;
        resolution_outcome: string | null;
        category_status: string | null;
        category_code: string | null;
        party_status: string | null;
        owner_relationship: string | null;
        entity_id: string | null;
      }>(
        `SELECT cv.amount::text, cv.direction, cv.currency_code,
                s.payment_rail, s.parse_status,
                (SELECT i.identifier_role FROM intel.transaction_identifier i
                  WHERE i.transaction_structure_id = s.transaction_structure_id AND i.identifier_type = 'VPA'
                  LIMIT 1) AS identifier_role,
                e.event_family, e.resolution_outcome,
                c.category_status, c.category_code,
                p.resolution_status AS party_status, p.owner_relationship, p.entity_id::text
           FROM core.logical_transaction lt
           JOIN core.canonical_transaction_version cv ON cv.canonical_transaction_version_id = lt.current_canonical_version_id
           LEFT JOIN intel.transaction_structure s ON s.logical_transaction_id = lt.logical_transaction_id AND s.is_current
           LEFT JOIN intel.financial_event_resolution e ON e.logical_transaction_id = lt.logical_transaction_id AND e.is_current
           LEFT JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id AND c.is_current
           LEFT JOIN intel.transaction_party_resolution p ON p.logical_transaction_id = lt.logical_transaction_id AND p.is_current
          WHERE lt.logical_transaction_id = $1`,
        [logicalId],
      );
      return row.rows[0]!;
    }

    const manual = await store.create({
      actorId: actorA,
      ownerId: ownerA,
      financialAccountId: accountA,
      idempotencyKey: `m37-manual-${stamp}`,
      amountText: "18.50",
      currency: "USD",
      direction: "OUT",
      occurredAt: "2026-06-01T00:00:00Z",
      merchantDescription: "corner shop",
      categoryCode: "FOOD_DINING",
      subcategoryCode: "restaurant",
      userSelectedWeights: null,
    });
    assert.equal(manual.outcome, "created", "T01");
    const manualId = (manual.body as { data?: { logical_transaction_id?: string } }).data?.logical_transaction_id;
    assert.equal(typeof manualId, "string", "T01");
    const manualView = await snapshot(manualId!);
    assert.equal(manualView.amount, "18.5000", "T01");
    assert.equal(manualView.resolution_outcome, "UNKNOWN", "T01");
    assert.equal(manualView.category_code, null, "T01");
    assert.notEqual(manualView.party_status, "RESOLVED", "T01");
    const manualReplay = await store.create({
      actorId: actorA,
      ownerId: ownerA,
      financialAccountId: accountA,
      idempotencyKey: `m37-manual-${stamp}`,
      amountText: "18.50",
      currency: "USD",
      direction: "OUT",
      occurredAt: "2026-06-01T00:00:00Z",
      merchantDescription: "corner shop",
      categoryCode: "FOOD_DINING",
      subcategoryCode: "restaurant",
      userSelectedWeights: null,
    });
    assert.equal(manualReplay.outcome, "replay", "T13");
    const manualRows = await admin.query<{ structures: string; events: string; categories: string; parties: string }>(
      `SELECT (SELECT count(*) FROM intel.transaction_structure WHERE logical_transaction_id = $1)::text AS structures,
              (SELECT count(*) FROM intel.financial_event_resolution WHERE logical_transaction_id = $1)::text AS events,
              (SELECT count(*) FROM intel.category_resolution WHERE logical_transaction_id = $1)::text AS categories,
              (SELECT count(*) FROM intel.transaction_party_resolution WHERE logical_transaction_id = $1)::text AS parties`,
      [manualId],
    );
    assert.deepEqual(manualRows.rows[0], { structures: "1", events: "1", categories: "1", parties: "1" }, "T13");

    const parsed = await admin.query<{ parsed: Record<string, unknown> }>(
      "SELECT spendsense.parse_narration_v4($1, 'OUT') AS parsed",
      ["UPIOUT/123456789012/sample@testbank/note"],
    );
    const batch = await admin.query<{ source_batch_id: string }>(
      `INSERT INTO core.source_batch (owner_id, source_type, status)
       VALUES ($1, 'BANK_STATEMENT_CSV', 'COMPLETED') RETURNING source_batch_id`,
      [ownerA],
    );
    const document = await admin.query<{ source_document_id: string }>(
      `INSERT INTO core.source_document (
         source_batch_id, owner_id, uploaded_by_actor_id, content_hash, status, reason_codes, metadata
       ) VALUES ($1, $2, $3, $4, 'AVAILABLE', ARRAY['SCAN_CLEAN'], '{"sealed": true}'::jsonb)
       RETURNING source_document_id`,
      [batch.rows[0]!.source_batch_id, ownerA, actorA, `m37-stmt-${stamp}`],
    );
    await admin.query(
      `INSERT INTO core.statement_instance (source_document_id, financial_account_id, currency_code, account_resolution_status, statement_status)
       VALUES ($1, $2, 'USD', 'RESOLVED', 'PARTIAL')`,
      [document.rows[0]!.source_document_id, accountA],
    );
    const run = await admin.query<{ extraction_run_id: string }>(
      `INSERT INTO core.extraction_run (source_document_id, adapter_version_id, run_no, status, run_reason, completed_at)
       VALUES ($1, $2, 1, 'COMPLETED', 'INITIAL', clock_timestamp()) RETURNING extraction_run_id`,
      [document.rows[0]!.source_document_id, adapterId],
    );
    const record = await admin.query<{ source_record_id: string }>(
      `INSERT INTO core.source_record (
         extraction_run_id, extraction_sequence, raw_record_payload, raw_description, raw_transaction_date,
         raw_amount, raw_reference, record_status
       ) VALUES ($1, 1, $2::jsonb, $3, '2026-06-01', '10.00', $4, 'TRANSACTION_CANDIDATE')
       RETURNING source_record_id`,
      [run.rows[0]!.extraction_run_id, JSON.stringify(parsed.rows[0]!.parsed), "UPIOUT/123456789012/sample@testbank/note", `UPI-${stamp}`],
    );
    const mapped = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.map_statement_extraction($1::uuid) AS result",
      [run.rows[0]!.extraction_run_id],
    );
    assert.equal(mapped.rows[0]!.result.outcome, "mapped", "T02");
    const imported = await admin.query<{ logical_transaction_id: string }>(
      "SELECT logical_transaction_id FROM core.source_record_disposition WHERE source_record_id = $1",
      [record.rows[0]!.source_record_id],
    );
    const importedId = imported.rows[0]!.logical_transaction_id;
    await api.query("SELECT ops.publish_structure_extraction_run($1::uuid)", [run.rows[0]!.extraction_run_id]);
    await api.query("SELECT ops.interpret_extraction_run($1::uuid)", [run.rows[0]!.extraction_run_id]);
    await api.query("SELECT ops.resolve_extraction_run($1::uuid)", [run.rows[0]!.extraction_run_id]);
    await api.query("SELECT ops.resolve_party_extraction_run($1::uuid)", [run.rows[0]!.extraction_run_id]);
    const importedView = await snapshot(importedId);
    assert.equal(importedView.payment_rail, "UPI", "T02");
    assert.equal(importedView.parse_status, "PARTIAL", "T03");
    assert.equal(importedView.identifier_role, "UNKNOWN_VPA", "T03");
    assert.equal(importedView.party_status, "UNKNOWN", "T03");
    assert.equal(importedView.entity_id, null, "T03");
    assert.equal(importedView.owner_relationship, "UNKNOWN", "T03");
    const importedLeak = await admin.query<{ payload: string }>(
      `SELECT event_payload::text AS payload FROM ops.outbox_event WHERE aggregate_id = $1`,
      [importedId],
    );
    assert.equal(importedLeak.rows.some((row) => row.payload.toLowerCase().includes("sample@testbank")), false, "T03");
    const partyReadsStructure = await admin.query<{ definition: string }>(
      "SELECT pg_get_functiondef('ops.resolve_transaction_party(uuid,uuid,uuid,text)'::regprocedure) AS definition",
    );
    assert.equal(partyReadsStructure.rows[0]!.definition.includes("transaction_structure"), false, "T03");

    const emi = await seed({ description: "monthly emi" });
    await pipeline(emi.logicalId);
    const emiView = await snapshot(emi.logicalId);
    assert.equal(emiView.event_family, "LOAN_REPAYMENT", "T04");
    assert.equal(emiView.category_status, "NOT_APPLICABLE", "T04");
    assert.equal(emiView.category_code, null, "T04");

    const card = await seed({ description: "credit card payment" });
    await pipeline(card.logicalId);
    const cardView = await snapshot(card.logicalId);
    assert.equal(cardView.event_family, "CREDIT_CARD_PAYMENT", "T05");
    assert.equal(cardView.category_status, "NOT_APPLICABLE", "T05");
    assert.equal(cardView.category_code, null, "T05");

    const interest = await seed({ direction: "IN", description: "savings interest" });
    await pipeline(interest.logicalId);
    const interestView = await snapshot(interest.logicalId);
    assert.equal(interestView.event_family, "INCOME", "T06");
    assert.equal(interestView.category_code, null, "T06");

    const cashPayload = await admin.query<{ parsed: Record<string, unknown> }>(
      "SELECT spendsense.parse_narration_v4($1, 'OUT') AS parsed",
      ["ATM WDL-ATM CASH 12345 MUMBAI"],
    );
    const cash = await seed({ description: "ATM WDL-ATM CASH 12345 MUMBAI", payload: cashPayload.rows[0]!.parsed });
    await pipeline(cash.logicalId);
    const cashView = await snapshot(cash.logicalId);
    assert.equal(cashView.event_family, "CASH_MOVEMENT", "T07");
    assert.equal(cashView.category_status, "UNKNOWN", "T07");
    assert.equal(cashView.category_code, null, "T07");
    assert.equal(cashView.payment_rail, "CASH", "T07");

    const refund = await seed({ direction: "IN", description: "customer refund", reversal: true });
    await pipeline(refund.logicalId);
    const refundView = await snapshot(refund.logicalId);
    assert.equal(refundView.event_family, "REFUND_REVERSAL", "T08");
    assert.equal(refundView.category_status, "UNKNOWN", "T08");
    assert.equal(refundView.category_code, null, "T08");

    const conflict = await seed({ direction: "OUT", description: "UPI IN/123456789012/sample@testbank/note" });
    const conflictMoney = await admin.query<{ direction: string }>(
      "SELECT direction FROM core.canonical_transaction_version WHERE canonical_transaction_version_id = $1",
      [conflict.versionId],
    );
    await pipeline(conflict.logicalId);
    const conflictView = await snapshot(conflict.logicalId);
    assert.equal(conflictView.parse_status, "CONFLICT", "T09");
    assert.equal(conflictMoney.rows[0]?.direction, "OUT", "T09");
    const conflictAfter = await admin.query<{ direction: string }>(
      "SELECT direction FROM core.canonical_transaction_version WHERE canonical_transaction_version_id = $1",
      [conflict.versionId],
    );
    assert.equal(conflictAfter.rows[0]?.direction, "OUT", "T23");

    const many = await seed({
      description: "transfer",
      payload: { parse_version: "v4", fields: { counterparty_vpa: "one@testbank" } },
    });
    const second = await admin.query<{ source_record_id: string }>(
      `INSERT INTO core.source_record (
         extraction_run_id, extraction_sequence, raw_record_payload, raw_description, record_status
       )
       SELECT extraction_run_id, 2, $2::jsonb, 'transfer', 'TRANSACTION_CANDIDATE'
         FROM core.source_record WHERE source_record_id = (
           SELECT source_record_id FROM core.canonical_transaction_version WHERE canonical_transaction_version_id = $1
         )
       RETURNING source_record_id`,
      [many.versionId, JSON.stringify({ parse_version: "v4", fields: { counterparty_vpa: "two@testbank" } })],
    );
    await admin.query(
      `INSERT INTO core.transaction_evidence_link (
         logical_transaction_id, source_record_id, canonical_transaction_version_id,
         relationship_type, identity_confidence, identity_reason_codes, is_primary_observation
       ) VALUES ($1, $2, $3, 'CORROBORATING_SOURCE', 1, ARRAY['M3_7_TEST'], false)`,
      [many.logicalId, second.rows[0]!.source_record_id, many.versionId],
    );
    await pipeline(many.logicalId);
    const manyView = await snapshot(many.logicalId);
    assert.equal(manyView.party_status, "AMBIGUOUS", "T10");
    assert.equal(manyView.entity_id, null, "T10");

    const unknown = await seed({ description: "weekly market" });
    await pipeline(unknown.logicalId);
    const unknownView = await snapshot(unknown.logicalId);
    assert.equal(unknownView.resolution_outcome, "UNKNOWN", "T11");
    assert.equal(unknownView.category_status, "UNKNOWN", "T11");
    assert.equal(unknownView.category_code, null, "T25");

    const ambiguous = await seed({ description: "monthly emi credit card payment" });
    await pipeline(ambiguous.logicalId);
    const ambiguousView = await snapshot(ambiguous.logicalId);
    assert.equal(ambiguousView.resolution_outcome, "AMBIGUOUS", "T12");
    assert.equal(ambiguousView.event_family, null, "T12");
    assert.equal(ambiguousView.category_code, null, "T12");

    const again = await snapshot(emi.logicalId);
    await pipeline(emi.logicalId);
    const replayed = await snapshot(emi.logicalId);
    assert.deepEqual(replayed, again, "T13");
    const emiCounts = await admin.query<{ structures: string; events: string }>(
      `SELECT (SELECT count(*) FROM intel.transaction_structure WHERE logical_transaction_id = $1)::text AS structures,
              (SELECT count(*) FROM intel.financial_event_resolution WHERE logical_transaction_id = $1)::text AS events`,
      [emi.logicalId],
    );
    assert.equal(emiCounts.rows[0]?.structures, "1", "T13");
    assert.equal(emiCounts.rows[0]?.events, "1", "T13");

    const parserVersion = await admin.query<{ parser_version: string }>(
      "SELECT parser_version FROM intel.transaction_structure WHERE logical_transaction_id = $1",
      [importedId],
    );
    assert.equal(parserVersion.rows[0]?.parser_version, "v4", "T14");
    const parserFunctions = await admin.query(
      `SELECT p.proname FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'spendsense' AND p.proname LIKE 'parse_narration_v%'`,
    );
    assert.deepEqual(parserFunctions.rows.map((row) => row.proname), ["parse_narration_v4"], "T14");

    const f10bVersion = `F10B-v2.1-${stamp}`;
    await admin.query("INSERT INTO ref.structure_policy (f10b_version) VALUES ($1)", [f10bVersion]);
    await api.query("SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, $4)", [actorA, ownerA, emi.logicalId, f10bVersion]);
    const structures = await admin.query<{ f10b_version: string; parse_status: string; is_current: boolean }>(
      `SELECT f10b_version, parse_status, is_current FROM intel.transaction_structure
        WHERE logical_transaction_id = $1 ORDER BY parsed_at`,
      [emi.logicalId],
    );
    assert.equal(structures.rowCount, 2, "T15");
    assert.equal(structures.rows[0]?.is_current, false, "T15");
    assert.equal(structures.rows[0]?.parse_status, "UNPARSED", "T24");
    assert.equal(structures.rows[1]?.f10b_version, f10bVersion, "T15");

    const f10cVersion = `F10C-v1.3-${stamp}`;
    await admin.query("INSERT INTO ref.party_resolution_policy (f10c_version) VALUES ($1)", [f10cVersion]);
    await admin.query(
      `INSERT INTO ref.party_observation_field (f10c_version, field_name, observation_type, sensitivity_class, identifier_strength)
       SELECT $1, field_name, observation_type, sensitivity_class, identifier_strength
         FROM ref.party_observation_field WHERE f10c_version = 'F10C-v1.2'`,
      [f10cVersion],
    );
    const beforeParty = await admin.query<{ resolution_status: string }>(
      `SELECT resolution_status FROM intel.transaction_party_resolution
        WHERE logical_transaction_id = $1 AND f10c_version = 'F10C-v1.2'`,
      [importedId],
    );
    await api.query("SELECT ops.resolve_transaction_party($1::uuid, $2::uuid, $3::uuid, $4)", [actorA, ownerA, importedId, f10cVersion]);
    const parties = await admin.query<{ f10c_version: string; resolution_status: string; is_current: boolean }>(
      `SELECT f10c_version, resolution_status, is_current FROM intel.transaction_party_resolution
        WHERE logical_transaction_id = $1 ORDER BY resolved_at`,
      [importedId],
    );
    assert.equal(parties.rowCount, 2, "T16");
    assert.equal(parties.rows[0]?.resolution_status, beforeParty.rows[0]?.resolution_status, "T24");
    assert.equal(parties.rows[0]?.is_current, false, "T16");
    assert.equal(parties.rows[1]?.f10c_version, f10cVersion, "T16");

    const f10dVersion = `F10D-v1.3-${stamp}`;
    await admin.query(
      `INSERT INTO ref.financial_event_rule (
         rulebook_version, rule_code, clause_no, precedence_band, event_family,
         direction_code, evidence_source, match_value, catalogue_note
       ) VALUES ($1, 'M37_001', 1, 'P9', 'CASH_MOVEMENT', 'OUT', 'description', 'm37-marker', 'integration probe')`,
      [f10dVersion],
    );
    const beforeEvent = await admin.query<{ event_family: string }>(
      `SELECT event_family FROM intel.financial_event_resolution
        WHERE logical_transaction_id = $1 AND rulebook_version = 'F10D-v1.2'`,
      [emi.logicalId],
    );
    await api.query("SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, $4)", [actorA, ownerA, emi.logicalId, f10dVersion]);
    const events = await admin.query<{ rulebook_version: string; event_family: string | null; is_current: boolean }>(
      `SELECT rulebook_version, event_family, is_current FROM intel.financial_event_resolution
        WHERE logical_transaction_id = $1 ORDER BY interpreted_at`,
      [emi.logicalId],
    );
    assert.equal(events.rowCount, 2, "T17");
    assert.equal(events.rows[0]?.event_family, beforeEvent.rows[0]?.event_family, "T24");
    assert.equal(events.rows[0]?.is_current, false, "T17");
    assert.equal(events.rows[1]?.rulebook_version, f10dVersion, "T17");

    const f10eVersion = `F10E-v1.3-${stamp}`;
    await admin.query("INSERT INTO ref.taxonomy_version (taxonomy_version) VALUES ($1)", [f10eVersion]);
    await admin.query(
      `INSERT INTO ref.category_event_constraint (
         taxonomy_version, event_family, event_outcome, category_behavior, purpose_behavior, contract_ref
       )
       SELECT $1, event_family, event_outcome, category_behavior, purpose_behavior, contract_ref
         FROM ref.category_event_constraint WHERE taxonomy_version = 'F10E-v1.2'`,
      [f10eVersion],
    );
    const beforeCategory = await admin.query<{ category_status: string; category_code: string | null }>(
      `SELECT category_status, category_code FROM intel.category_resolution
        WHERE logical_transaction_id = $1 AND taxonomy_version = 'F10E-v1.2'`,
      [emi.logicalId],
    );
    await api.query("SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, $4)", [actorA, ownerA, emi.logicalId, f10eVersion]);
    const categories = await admin.query<{ taxonomy_version: string; category_status: string; category_code: string | null; is_current: boolean }>(
      `SELECT taxonomy_version, category_status, category_code, is_current FROM intel.category_resolution
        WHERE logical_transaction_id = $1 ORDER BY created_at`,
      [emi.logicalId],
    );
    assert.equal(categories.rowCount, 2, "T18");
    assert.equal(categories.rows[0]?.category_status, beforeCategory.rows[0]?.category_status, "T24");
    assert.equal(categories.rows[0]?.category_code, null, "T24");
    assert.equal(categories.rows[0]?.is_current, false, "T18");
    assert.equal(categories.rows[1]?.taxonomy_version, f10eVersion, "T18");
    assert.equal(categories.rows[1]?.category_code, null, "T25");

    const foreign = await seed({ description: "weekly market stall" });
    const foreignBatch = await admin.query<{ source_batch_id: string }>(
      `INSERT INTO core.source_batch (owner_id, source_type, status)
       VALUES ($1, 'BANK_STATEMENT_CSV', 'COMPLETED') RETURNING source_batch_id`,
      [ownerB],
    );
    const foreignDocument = await admin.query<{ source_document_id: string }>(
      `INSERT INTO core.source_document (source_batch_id, owner_id, content_hash, status)
       VALUES ($1, $2, $3, 'AVAILABLE') RETURNING source_document_id`,
      [foreignBatch.rows[0]!.source_batch_id, ownerB, `m37-foreign-${stamp}`],
    );
    const foreignRun = await admin.query<{ extraction_run_id: string }>(
      `INSERT INTO core.extraction_run (source_document_id, adapter_version_id, run_no, status, run_reason, completed_at)
       VALUES ($1, $2, 1, 'COMPLETED', 'INITIAL', clock_timestamp()) RETURNING extraction_run_id`,
      [foreignDocument.rows[0]!.source_document_id, adapterId],
    );
    const foreignRecord = await admin.query<{ source_record_id: string }>(
      `INSERT INTO core.source_record (
         extraction_run_id, extraction_sequence, raw_record_payload, raw_description, record_status
       ) VALUES ($1, 1, $2::jsonb, 'transfer', 'TRANSACTION_CANDIDATE') RETURNING source_record_id`,
      [foreignRun.rows[0]!.extraction_run_id, JSON.stringify({ parse_version: "v4", fields: { counterparty_vpa: "foreign@testbank" } })],
    );
    await admin.query(
      `INSERT INTO core.transaction_evidence_link (
         logical_transaction_id, source_record_id, canonical_transaction_version_id,
         relationship_type, identity_confidence, identity_reason_codes, is_primary_observation
       ) VALUES ($1, $2, $3, 'CORROBORATING_SOURCE', 1, ARRAY['M3_7_TEST'], false)`,
      [foreign.logicalId, foreignRecord.rows[0]!.source_record_id, foreign.versionId],
    );
    const denied = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, NULL) AS result",
      [actorB, ownerA, foreign.logicalId],
    );
    assert.equal(denied.rows[0]!.result.outcome, "forbidden", "T19");
    await pipeline(foreign.logicalId);
    const foreignObservations = await admin.query(
      "SELECT 1 FROM intel.entity_observation WHERE logical_transaction_id = $1",
      [foreign.logicalId],
    );
    assert.equal(foreignObservations.rowCount, 0, "T19");

    const business = await seed({ ownerId: ownerBiz, accountId: accountBiz, description: "monthly emi" });
    const businessStructure = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, NULL) AS result",
      [actorA, ownerBiz, business.logicalId],
    );
    const businessEvent = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL) AS result",
      [actorA, ownerBiz, business.logicalId],
    );
    const businessUse = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, NULL) AS result",
      [actorA, ownerBiz, business.logicalId],
    );
    const businessParty = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.resolve_transaction_party($1::uuid, $2::uuid, $3::uuid, NULL) AS result",
      [actorA, ownerBiz, business.logicalId],
    );
    assert.equal(businessStructure.rows[0]!.result.outcome, "business_isolated", "T20");
    assert.equal(businessEvent.rows[0]!.result.outcome, "business_isolated", "T20");
    assert.equal(businessUse.rows[0]!.result.outcome, "business_isolated", "T20");
    assert.equal(businessParty.rows[0]!.result.outcome, "business_isolated", "T20");
    const businessRows = await admin.query(
      "SELECT 1 FROM intel.financial_event_resolution WHERE logical_transaction_id = $1",
      [business.logicalId],
    );
    assert.equal(businessRows.rowCount, 0, "T20");

    const concurrent = await seed({ description: "weekly market lane" });
    await Promise.all([
      left.query("SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, NULL)", [actorA, ownerA, concurrent.logicalId]),
      right.query("SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, NULL)", [actorA, ownerA, concurrent.logicalId]),
    ]);
    await Promise.all([
      left.query("SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL)", [actorA, ownerA, concurrent.logicalId]),
      right.query("SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL)", [actorA, ownerA, concurrent.logicalId]),
    ]);
    const concurrentCounts = await admin.query<{ structures: string; events: string }>(
      `SELECT (SELECT count(*) FROM intel.transaction_structure WHERE logical_transaction_id = $1)::text AS structures,
              (SELECT count(*) FROM intel.financial_event_resolution WHERE logical_transaction_id = $1)::text AS events`,
      [concurrent.logicalId],
    );
    assert.equal(concurrentCounts.rows[0]?.structures, "1", "T21");
    assert.equal(concurrentCounts.rows[0]?.events, "1", "T21");

    const rolled = await seed({ description: "weekly market lane two" });
    try {
      await api.query("BEGIN");
      await pipeline(rolled.logicalId);
      await api.query("ROLLBACK");
    } catch (error) {
      await api.query("ROLLBACK");
      throw error;
    }
    const rolledRows = await admin.query(
      "SELECT 1 FROM intel.transaction_structure WHERE logical_transaction_id = $1",
      [rolled.logicalId],
    );
    assert.equal(rolledRows.rowCount, 0, "T22");

    const ledgers = await admin.query(
      `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname IN ('txn_fact', 'txn_parsed', 'txn_enriched', 'txn_categorized')`,
    );
    assert.equal(ledgers.rowCount, 0, "T23");
    const resolvedParties = await admin.query<{ rows: string }>(
      `SELECT count(*)::text AS rows FROM intel.transaction_party_resolution
        WHERE resolution_status = 'RESOLVED' OR entity_id IS NOT NULL`,
    );
    assert.equal(resolvedParties.rows[0]!.rows, "0", "T23");
    const historicalAfter = await admin.query<{ logical_transaction_id: string }>(
      `SELECT logical_transaction_id FROM core.logical_transaction
        WHERE financial_account_id = $1 ORDER BY logical_transaction_id`,
      [historicalAccountId],
    );
    assert.deepEqual(historicalAfter.rows, historicalBefore.rows, "T23");
  } finally {
    await store.close();
    await admin.end();
    await api.end();
    await left.end();
    await right.end();
  }
});
