import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const historicalAccountId = "01a12b2d-3324-71e2-8fbd-4faf2ec90b2a";

type Interpretation = {
  outcome: string;
  resolution_outcome?: string | null;
  event_family?: string | null;
  matched_rule_code?: string | null;
  rulebook_version?: string;
  canonical_transaction_version_id?: string;
  is_current?: boolean;
};

type Money = {
  amount: string;
  transaction_date: string;
  direction: string;
  currency_code: string;
  financial_account_id: string;
  raw_description: string | null;
};

test("M3.1 interprets personal financial events without a second ledger", async (t) => {
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
        ["firebase", `m31-a-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const actorB = (
      await admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", `m31-b-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const owners = await admin.query<{ owner_id: string }>(
      `INSERT INTO core.owner (owner_type, display_name)
       VALUES ('PERSON', $1), ('PERSON', $2), ('BUSINESS', $3)
       RETURNING owner_id`,
      [`m31-a-${stamp}`, `m31-b-${stamp}`, `m31-biz-${stamp}`],
    );
    const ownerA = owners.rows[0]!.owner_id;
    const ownerB = owners.rows[1]!.owner_id;
    const ownerBiz = owners.rows[2]!.owner_id;
    await admin.query(
      `INSERT INTO core.actor_owner_membership (actor_id, owner_id, membership_role, membership_status, is_default_owner)
       VALUES ($1, $2, 'OWNER', 'ACTIVE', true), ($3, $4, 'OWNER', 'ACTIVE', true), ($1, $5, 'OWNER', 'ACTIVE', false)`,
      [actorA, ownerA, actorB, ownerB, ownerBiz],
    );
    const accounts = await admin.query<{ financial_account_id: string }>(
      `INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
       VALUES ('SAVINGS', 'A', 'USD', 'ACTIVE'), ('SAVINGS', 'B', 'USD', 'ACTIVE'), ('CURRENT', 'Biz', 'USD', 'ACTIVE')
       RETURNING financial_account_id`,
    );
    const accountA = accounts.rows[0]!.financial_account_id;
    const accountB = accounts.rows[1]!.financial_account_id;
    const accountBiz = accounts.rows[2]!.financial_account_id;
    await admin.query(
      `INSERT INTO core.account_ownership (owner_id, financial_account_id, relationship_role, verification_state, relationship_status)
       VALUES ($1, $2, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE'),
              ($3, $4, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE'),
              ($5, $6, 'BUSINESS_OWNER', 'VERIFIED', 'ACTIVE')`,
      [ownerA, accountA, ownerB, accountB, ownerBiz, accountBiz],
    );

    const privileges = await admin.query<{ api_insert: boolean; api_execute: boolean; intel_execute: boolean }>(
      `SELECT has_table_privilege('monytix_api', 'intel.financial_event_resolution', 'INSERT') AS api_insert,
              has_function_privilege('monytix_api', 'ops.interpret_financial_event(uuid,uuid,uuid,text)', 'EXECUTE') AS api_execute,
              has_function_privilege('monytix_intelligence', 'ops.interpret_financial_event(uuid,uuid,uuid,text)', 'EXECUTE') AS intel_execute`,
    );
    assert.equal(privileges.rows[0]?.api_insert, false, "writer grant");
    assert.equal(privileges.rows[0]?.api_execute, true, "writer grant");
    assert.equal(privileges.rows[0]?.intel_execute, false, "writer grant");
    const definition = await admin.query<{ def: string }>(
      "SELECT pg_get_functiondef('ops.interpret_financial_event(uuid,uuid,uuid,text)'::regprocedure) AS def",
    );
    assert.equal(definition.rows[0]?.def.includes("UPDATE core.canonical_transaction_version"), false, "canonical guard");
    assert.equal(definition.rows[0]?.def.includes("INSERT INTO core.logical_transaction"), false, "canonical guard");
    await assert.rejects(
      api.query(
        `INSERT INTO intel.financial_event_resolution (
           logical_transaction_id, canonical_transaction_version_id, rulebook_version, resolution_outcome
         ) VALUES ($1, $1, 'F10D-v1.2', 'UNKNOWN')`,
        ["00000000-0000-0000-0000-000000000001"],
      ),
      "direct insert",
    );

    async function interpret(
      actorId: string,
      ownerId: string,
      logicalId: string,
      version?: string,
    ): Promise<Interpretation> {
      const result = await api.query<{ result: Interpretation }>(
        "SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, $4) AS result",
        [actorId, ownerId, logicalId, version ?? null],
      );
      return result.rows[0]!.result;
    }

    async function seed(input: {
      ownerId?: string;
      accountId?: string;
      direction: "IN" | "OUT";
      description: string | null;
      reversal?: boolean;
      evidenceOwnerId?: string;
      payload?: Record<string, unknown> | null;
    }): Promise<{ logicalId: string; versionId: string; sourceRecordId: string | null }> {
      const ownerId = input.ownerId ?? ownerA;
      const accountId = input.accountId ?? accountA;
      let sourceRecordId: string | null = null;
      let runId: string | null = null;
      let batchId: string | null = null;
      if (input.evidenceOwnerId || input.payload) {
        const evidenceOwner = input.evidenceOwnerId ?? ownerId;
        const batch = await admin.query<{ source_batch_id: string }>(
          `INSERT INTO core.source_batch (owner_id, source_type, status)
           VALUES ($1, 'BANK_STATEMENT_CSV', 'COMPLETED') RETURNING source_batch_id`,
          [evidenceOwner],
        );
        batchId = batch.rows[0]!.source_batch_id;
        const document = await admin.query<{ source_document_id: string }>(
          `INSERT INTO core.source_document (source_batch_id, owner_id, content_hash, status)
           VALUES ($1, $2, $3, 'AVAILABLE') RETURNING source_document_id`,
          [batchId, evidenceOwner, createHash("sha256").update(`${stamp}-${Math.random()}`).digest("hex")],
        );
        const run = await admin.query<{ extraction_run_id: string }>(
          `INSERT INTO core.extraction_run (source_document_id, adapter_version_id, run_no, status, run_reason, completed_at)
           VALUES ($1, $2, 1, 'COMPLETED', 'INITIAL', clock_timestamp()) RETURNING extraction_run_id`,
          [document.rows[0]!.source_document_id, adapterId],
        );
        runId = run.rows[0]!.extraction_run_id;
        const record = await admin.query<{ source_record_id: string }>(
          `INSERT INTO core.source_record (
             extraction_run_id, extraction_sequence, raw_record_payload, raw_description, record_status
           ) VALUES ($1, 1, $2::jsonb, $3, 'TRANSACTION_CANDIDATE') RETURNING source_record_id`,
          [runId, JSON.stringify(input.payload ?? {}), input.description],
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
           1, 'READY', 0, 'M3.1-test', $5, 'DISTINCT', $6, $7, $8, $9
         ) RETURNING canonical_transaction_version_id`,
        [
          logicalId,
          accountId,
          input.direction,
          input.description,
          sourceRecordId ? "INITIAL" : "MIGRATION_CORRECTION",
          input.reversal ?? false,
          sourceRecordId,
          runId,
          batchId,
        ],
      );
      const versionId = version.rows[0]!.canonical_transaction_version_id;
      await admin.query("SELECT core.activate_canonical_transaction_version($1::uuid, NULL)", [versionId]);
      if (sourceRecordId) {
        await admin.query(
          `INSERT INTO core.transaction_evidence_link (
             logical_transaction_id, source_record_id, canonical_transaction_version_id,
             relationship_type, identity_confidence, identity_reason_codes, is_primary_observation
           ) VALUES ($1, $2, $3, $4, 1, ARRAY['M3_1_TEST'], $5)`,
          [
            logicalId,
            sourceRecordId,
            versionId,
            input.evidenceOwnerId && input.evidenceOwnerId !== ownerId ? "CORROBORATING_SOURCE" : "PRIMARY_VERSION_SOURCE",
            !(input.evidenceOwnerId && input.evidenceOwnerId !== ownerId),
          ],
        );
      }
      return { logicalId, versionId, sourceRecordId };
    }

    async function money(versionId: string): Promise<Money> {
      const row = await admin.query<Money>(
        `SELECT amount::text, transaction_date::text, direction, currency_code,
                financial_account_id::text, raw_description
           FROM core.canonical_transaction_version
          WHERE canonical_transaction_version_id = $1`,
        [versionId],
      );
      return row.rows[0]!;
    }

    async function resolutionCount(logicalId: string): Promise<number> {
      const count = await admin.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM intel.financial_event_resolution WHERE logical_transaction_id = $1",
        [logicalId],
      );
      return Number(count.rows[0]!.count);
    }

    async function outboxCount(logicalId: string): Promise<number> {
      const count = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ops.outbox_event
          WHERE aggregate_id = $1 AND semantic_trigger_code = 'FINANCIAL_EVENT_INTERPRETED'`,
        [logicalId],
      );
      return Number(count.rows[0]!.count);
    }

    const expense = await seed({ direction: "OUT", description: "SWIGGY ORDER 441" });
    const expenseBefore = await money(expense.versionId);
    const expenseResult = await interpret(actorA, ownerA, expense.logicalId);
    assert.equal(expenseResult.outcome, "created", "T01");
    assert.equal(expenseResult.resolution_outcome, "UNKNOWN", "T01");
    assert.equal(expenseResult.event_family ?? null, null, "T01");
    assert.deepEqual(await money(expense.versionId), expenseBefore, "T01");

    const income = await seed({ direction: "IN", description: "savings interest for june" });
    const incomeResult = await interpret(actorA, ownerA, income.logicalId);
    assert.equal(incomeResult.resolution_outcome, "RESOLVED", "T02");
    assert.equal(incomeResult.event_family, "INCOME", "T02");
    assert.equal(incomeResult.matched_rule_code, "INC_040", "T02");
    const salary = await seed({ direction: "IN", description: "salary credit from employer" });
    const salaryResult = await interpret(actorA, ownerA, salary.logicalId);
    assert.equal(salaryResult.resolution_outcome, "UNKNOWN", "T02 salary keyword");

    const transfer = await seed({ direction: "OUT", description: "self transfer to own account" });
    const transferResult = await interpret(actorA, ownerA, transfer.logicalId);
    assert.equal(transferResult.resolution_outcome, "UNKNOWN", "T03");

    const card = await seed({ direction: "OUT", description: "credit card bill paid" });
    const cardResult = await interpret(actorA, ownerA, card.logicalId);
    assert.equal(cardResult.resolution_outcome, "RESOLVED", "T04");
    assert.equal(cardResult.event_family, "CREDIT_CARD_PAYMENT", "T04");
    assert.equal(cardResult.matched_rule_code, "CC_001", "T04");

    const emi = await seed({ direction: "OUT", description: "monthly emi" });
    const emiBefore = await money(emi.versionId);
    const emiResult = await interpret(actorA, ownerA, emi.logicalId);
    assert.equal(emiResult.resolution_outcome, "RESOLVED", "T05");
    assert.equal(emiResult.event_family, "LOAN_REPAYMENT", "T05");
    assert.equal(emiResult.matched_rule_code, "EMI_001", "T05");
    assert.deepEqual(await money(emi.versionId), emiBefore, "T15");

    const disbursement = await seed({ direction: "IN", description: "loan disbursement" });
    const disbursementResult = await interpret(actorA, ownerA, disbursement.logicalId);
    assert.equal(disbursementResult.resolution_outcome, "UNKNOWN", "T06");

    const refundWord = await seed({ direction: "IN", description: "store refund", reversal: false });
    const refundWordResult = await interpret(actorA, ownerA, refundWord.logicalId);
    assert.equal(refundWordResult.resolution_outcome, "UNKNOWN", "T07 word only");
    const refund = await seed({ direction: "IN", description: "store refund", reversal: true });
    const refundResult = await interpret(actorA, ownerA, refund.logicalId);
    assert.equal(refundResult.resolution_outcome, "RESOLVED", "T07");
    assert.equal(refundResult.event_family, "REFUND_REVERSAL", "T07");
    assert.equal(refundResult.matched_rule_code, "INC_050", "T07");

    const atmWord = await seed({ direction: "OUT", description: "atm" });
    const atmWordResult = await interpret(actorA, ownerA, atmWord.logicalId);
    assert.equal(atmWordResult.resolution_outcome, "UNKNOWN", "T08 word only");
    const atm = await seed({
      direction: "OUT",
      description: "cash withdrawal",
      payload: { channel_type: "ATM", parse_format: "ATM_WDL_DASH" },
    });
    const atmResult = await interpret(actorA, ownerA, atm.logicalId);
    assert.equal(atmResult.resolution_outcome, "RESOLVED", "T08");
    assert.equal(atmResult.event_family, "CASH_MOVEMENT", "T08");
    assert.equal(atmResult.matched_rule_code, "CASH_001", "T08");

    const unknown = await seed({ direction: "OUT", description: "zzzz unmatched token" });
    const unknownResult = await interpret(actorA, ownerA, unknown.logicalId);
    assert.equal(unknownResult.resolution_outcome, "UNKNOWN", "T09");

    const clash = await seed({ direction: "OUT", description: "EMI credit card payment" });
    const clashResult = await interpret(actorA, ownerA, clash.logicalId);
    assert.equal(clashResult.resolution_outcome, "AMBIGUOUS", "T10");
    assert.equal(clashResult.event_family ?? null, null, "T10");
    assert.equal(clashResult.matched_rule_code ?? null, null, "T10");
    const clashRow = await admin.query<{ precedence_band: string | null }>(
      `SELECT precedence_band FROM intel.financial_event_resolution
        WHERE logical_transaction_id = $1 AND is_current = true`,
      [clash.logicalId],
    );
    assert.equal(clashRow.rows[0]?.precedence_band, "P1", "T10");

    const missing = await seed({ direction: "OUT", description: null });
    const missingResult = await interpret(actorA, ownerA, missing.logicalId);
    assert.equal(missingResult.resolution_outcome, "UNKNOWN", "T11");

    const replay = await interpret(actorA, ownerA, emi.logicalId);
    assert.equal(replay.outcome, "replay", "T12");
    assert.equal(replay.event_family, "LOAN_REPAYMENT", "T12");
    assert.equal(await resolutionCount(emi.logicalId), 1, "T12");
    assert.equal(await outboxCount(emi.logicalId), 1, "T24");

    await admin.query(
      `INSERT INTO ref.financial_event_rule (
         rulebook_version, rule_code, clause_no, precedence_band, event_family,
         direction_code, evidence_source, match_value, catalogue_note
       ) VALUES (
         $2, 'TEST_001', 1, 'P4', 'CASH_MOVEMENT',
         'OUT', 'description', $1, 'Test-only version. Proves the previous resolution row stays.'
       )`,
      ["\\yemi\\y", `F10D-v1.3-${stamp}`],
    );
    const upgraded = await interpret(actorA, ownerA, emi.logicalId, `F10D-v1.3-${stamp}`);
    assert.equal(upgraded.outcome, "created", "T13");
    assert.equal(upgraded.event_family, "CASH_MOVEMENT", "T13");
    const history = await admin.query<{
      rulebook_version: string;
      event_family: string | null;
      matched_rule_code: string | null;
      is_current: boolean;
      canonical_transaction_version_id: string;
    }>(
      `SELECT rulebook_version, event_family, matched_rule_code, is_current, canonical_transaction_version_id
         FROM intel.financial_event_resolution
        WHERE logical_transaction_id = $1
        ORDER BY interpreted_at`,
      [emi.logicalId],
    );
    assert.equal(history.rowCount, 2, "T14");
    assert.equal(history.rows[0]?.rulebook_version, "F10D-v1.2", "T13");
    assert.equal(history.rows[0]?.event_family, "LOAN_REPAYMENT", "T13");
    assert.equal(history.rows[0]?.matched_rule_code, "EMI_001", "T13");
    assert.equal(history.rows[0]?.is_current, false, "T13");
    assert.equal(history.rows[1]?.is_current, true, "T14");
    assert.equal(history.rows[0]?.canonical_transaction_version_id, history.rows[1]?.canonical_transaction_version_id, "T14");
    assert.deepEqual(await money(emi.versionId), emiBefore, "T15");

    const evidenced = await seed({
      direction: "OUT",
      description: "monthly emi",
      payload: {},
    });
    const evidencedResult = await interpret(actorA, ownerA, evidenced.logicalId);
    assert.equal(evidencedResult.event_family, "LOAN_REPAYMENT", "T16");
    const evidence = await admin.query<{ evidence_references: string[] }>(
      `SELECT evidence_references FROM intel.financial_event_resolution
        WHERE logical_transaction_id = $1 AND is_current = true`,
      [evidenced.logicalId],
    );
    assert.deepEqual(evidence.rows[0]?.evidence_references, [evidenced.sourceRecordId], "T16");

    const manual = await api.query<{ result: { outcome: string; body?: { data?: { logical_transaction_id?: string } } } }>(
      `SELECT ops.create_manual_transaction(
         $1::uuid, $2::uuid, $3::uuid, $4, '18.00', 'USD', 'OUT',
         '2026-10-10T11:00:00Z', 'monthly emi', 'FOOD', 'GROCERIES', NULL
       ) AS result`,
      [actorA, ownerA, accountA, `m31-t17-${stamp}`],
    );
    assert.equal(manual.rows[0]?.result.outcome, "created", "T17");
    const manualLogical = manual.rows[0]?.result.body?.data?.logical_transaction_id;
    assert.ok(manualLogical, "T17");
    const manualResult = await interpret(actorA, ownerA, manualLogical);
    assert.equal(manualResult.resolution_outcome, "RESOLVED", "T17");
    assert.equal(manualResult.event_family, "LOAN_REPAYMENT", "T17");

    const narration = "ATM WDL-ATM CASH 100 MAIN";
    const parsed = await admin.query<{ parsed: Record<string, unknown> }>(
      "SELECT spendsense.parse_narration_v4($1, 'OUT') AS parsed",
      [narration],
    );
    const batch = await admin.query<{ source_batch_id: string }>(
      `INSERT INTO core.source_batch (owner_id, uploaded_by_actor_id, source_type, status)
       VALUES ($1, $2, 'BANK_STATEMENT_CSV', 'COMPLETED') RETURNING source_batch_id`,
      [ownerA, actorA],
    );
    const document = await admin.query<{ source_document_id: string }>(
      `INSERT INTO core.source_document (
         source_batch_id, owner_id, uploaded_by_actor_id, content_hash, status, reason_codes, metadata
       ) VALUES ($1, $2, $3, $4, 'AVAILABLE', ARRAY['SCAN_CLEAN'], '{"sealed": true}'::jsonb)
       RETURNING source_document_id`,
      [batch.rows[0]!.source_batch_id, ownerA, actorA, createHash("sha256").update(`t18-${stamp}`).digest("hex")],
    );
    await admin.query(
      `INSERT INTO core.statement_instance (
         source_document_id, financial_account_id, currency_code, account_resolution_status, statement_status
       ) VALUES ($1, $2, 'USD', 'RESOLVED', 'PARTIAL')`,
      [document.rows[0]!.source_document_id, accountA],
    );
    const run = await admin.query<{ extraction_run_id: string }>(
      `INSERT INTO core.extraction_run (source_document_id, adapter_version_id, run_no, status, run_reason, completed_at)
       VALUES ($1, $2, 1, 'COMPLETED', 'INITIAL', clock_timestamp()) RETURNING extraction_run_id`,
      [document.rows[0]!.source_document_id, adapterId],
    );
    await admin.query(
      `INSERT INTO core.source_record (
         extraction_run_id, extraction_sequence, raw_record_payload, raw_description,
         raw_transaction_date, raw_amount, raw_reference, record_status
       ) VALUES ($1, 1, $2::jsonb, $3, '2026-05-02', '500.00', $4, 'TRANSACTION_CANDIDATE')`,
      [
        run.rows[0]!.extraction_run_id,
        JSON.stringify({ ...parsed.rows[0]!.parsed, description: narration, txn_date: "2026-05-02", amount: "500.00" }),
        narration,
        `T18-${stamp}`,
      ],
    );
    const mapped = await api.query<{ result: { outcome: string; mapped: number } }>(
      "SELECT ops.map_statement_extraction($1::uuid) AS result",
      [run.rows[0]!.extraction_run_id],
    );
    assert.equal(mapped.rows[0]?.result.mapped, 1, "T18");
    const interpretedRun = await api.query<{ result: { outcome: string; results: Interpretation[] } }>(
      "SELECT ops.interpret_extraction_run($1::uuid) AS result",
      [run.rows[0]!.extraction_run_id],
    );
    assert.equal(interpretedRun.rows[0]?.result.outcome, "completed", "T18");
    assert.equal(interpretedRun.rows[0]?.result.results[0]?.resolution_outcome, "RESOLVED", "T18");
    assert.equal(interpretedRun.rows[0]?.result.results[0]?.event_family, "CASH_MOVEMENT", "T18");
    assert.equal(interpretedRun.rows[0]?.result.results[0]?.matched_rule_code, "CASH_001", "T18");

    const forbidden = await interpret(actorB, ownerA, expense.logicalId);
    assert.equal(forbidden.outcome, "forbidden", "T19");
    assert.equal(await resolutionCount(expense.logicalId), 1, "T19");
    const otherAccount = await interpret(actorB, ownerB, expense.logicalId);
    assert.equal(otherAccount.outcome, "forbidden", "T19");

    const foreign = await seed({
      direction: "OUT",
      description: "shop purchase",
      evidenceOwnerId: ownerB,
      payload: { sub_type: "EMI" },
    });
    const foreignResult = await interpret(actorA, ownerA, foreign.logicalId);
    assert.equal(foreignResult.resolution_outcome, "UNKNOWN", "T20");
    const foreignEvidence = await admin.query<{ evidence_references: string[] }>(
      `SELECT evidence_references FROM intel.financial_event_resolution WHERE logical_transaction_id = $1`,
      [foreign.logicalId],
    );
    assert.deepEqual(foreignEvidence.rows[0]?.evidence_references, [], "T20");

    const business = await seed({
      ownerId: ownerBiz,
      accountId: accountBiz,
      direction: "OUT",
      description: "monthly emi",
    });
    const businessResult = await interpret(actorA, ownerBiz, business.logicalId);
    assert.equal(businessResult.outcome, "business_isolated", "T21");
    assert.equal(await resolutionCount(business.logicalId), 0, "T21");

    const concurrent = await seed({ direction: "OUT", description: "monthly emi" });
    const pair = await Promise.all([
      left.query<{ result: Interpretation }>(
        "SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL) AS result",
        [actorA, ownerA, concurrent.logicalId],
      ),
      right.query<{ result: Interpretation }>(
        "SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL) AS result",
        [actorA, ownerA, concurrent.logicalId],
      ),
    ]);
    const outcomes = pair.map((item) => item.rows[0]!.result.outcome).sort();
    assert.deepEqual(outcomes, ["created", "replay"], "T22");
    assert.equal(await resolutionCount(concurrent.logicalId), 1, "T22");
    assert.equal(await outboxCount(concurrent.logicalId), 1, "T22");

    const rolled = await seed({ direction: "OUT", description: "monthly emi" });
    try {
      await api.query("BEGIN");
      const pending = await interpret(actorA, ownerA, rolled.logicalId);
      assert.equal(pending.outcome, "created", "T23");
      await api.query("ROLLBACK");
    } catch (error) {
      await api.query("ROLLBACK");
      throw error;
    }
    assert.equal(await resolutionCount(rolled.logicalId), 0, "T23");
    assert.equal(await outboxCount(rolled.logicalId), 0, "T23");
    const afterRollback = await interpret(actorA, ownerA, rolled.logicalId);
    assert.equal(afterRollback.outcome, "created", "T24");
    assert.equal(await outboxCount(rolled.logicalId), 1, "T24");
    const replayOutbox = await interpret(actorA, ownerA, rolled.logicalId);
    assert.equal(replayOutbox.outcome, "replay", "T24");
    assert.equal(await outboxCount(rolled.logicalId), 1, "T24");

    const absent = await admin.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname IN ('txn_fact', 'txn_parsed', 'txn_parse_stage', 'txn_enriched', 'txn_rulebook_output')`,
    );
    assert.equal(absent.rowCount, 0, "T25");

    const catalogue = await admin.query<{ rule_code: string; event_family: string }>(
      `SELECT DISTINCT rule_code, event_family
         FROM ref.financial_event_rule
        WHERE rulebook_version = 'F10D-v1.2'
        ORDER BY rule_code`,
    );
    assert.deepEqual(
      catalogue.rows.map((row) => row.rule_code),
      ["CASH_001", "CC_001", "EMI_001", "EMI_002", "INC_040", "INC_050"],
      "catalogue",
    );
    assert.equal(catalogue.rows.some((row) => row.event_family === "EXPENSE"), false, "catalogue");

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
