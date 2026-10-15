import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const historicalAccountId = "01a12b2d-3324-71e2-8fbd-4faf2ec90b2a";

type UseResult = {
  outcome: string;
  category_status?: string;
  purpose_status?: string;
  taxonomy_version?: string;
  is_current?: boolean;
};

type Money = {
  amount: string;
  transaction_date: string;
  direction: string;
  currency_code: string;
  financial_account_id: string;
};

test("M3.2 applies F10E event constraints without assigning a spend category", async (t) => {
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
        ["firebase", `m32-a-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const actorB = (
      await admin.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", `m32-b-${stamp}`, null],
      )
    ).rows[0]!.provision_authenticated_actor;
    const owners = await admin.query<{ owner_id: string }>(
      `INSERT INTO core.owner (owner_type, display_name)
       VALUES ('PERSON', $1), ('BUSINESS', $2) RETURNING owner_id`,
      [`m32-a-${stamp}`, `m32-biz-${stamp}`],
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

    const registry = await admin.query<{ category_code: string }>(
      `SELECT category_code FROM ref.taxonomy_category WHERE taxonomy_version = 'F10E-v1.2' ORDER BY category_code`,
    );
    assert.equal(registry.rowCount, 20, "section 7 count");
    assert.equal(registry.rows.some((row) => row.category_code === "INCOME"), false, "AC-46");
    assert.equal(registry.rows.some((row) => row.category_code === "EXPENSE"), false, "AC-46");
    const subcategories = await admin.query(
      "SELECT 1 FROM ref.taxonomy_subcategory WHERE taxonomy_version = 'F10E-v1.2'",
    );
    assert.equal(subcategories.rowCount, 0, "no invented subcategory");
    const merchant = await admin.query<{ category_behavior: string }>(
      `SELECT category_behavior FROM ref.category_event_constraint
        WHERE taxonomy_version = 'F10E-v1.2' AND event_family = 'MERCHANT_PURCHASE'`,
    );
    assert.equal(merchant.rows[0]?.category_behavior, "MERCHANT_BLOCKED", "AC-06 blocked");
    const internal = await admin.query<{ category_behavior: string; purpose_behavior: string }>(
      `SELECT category_behavior, purpose_behavior FROM ref.category_event_constraint
        WHERE taxonomy_version = 'F10E-v1.2' AND event_family = 'INTERNAL_TRANSFER'`,
    );
    assert.equal(internal.rows[0]?.category_behavior, "NOT_APPLICABLE", "AC-08");
    assert.equal(internal.rows[0]?.purpose_behavior, "NOT_APPLICABLE", "AC-08");

    const privileges = await admin.query<{ api_insert: boolean; api_execute: boolean; intel_execute: boolean }>(
      `SELECT has_table_privilege('monytix_api', 'intel.category_resolution', 'INSERT') AS api_insert,
              has_function_privilege('monytix_api', 'ops.resolve_financial_use(uuid,uuid,uuid,text)', 'EXECUTE') AS api_execute,
              has_function_privilege('monytix_intelligence', 'ops.resolve_financial_use(uuid,uuid,uuid,text)', 'EXECUTE') AS intel_execute`,
    );
    assert.equal(privileges.rows[0]?.api_insert, false, "writer grant");
    assert.equal(privileges.rows[0]?.api_execute, true, "writer grant");
    assert.equal(privileges.rows[0]?.intel_execute, false, "writer grant");
    await assert.rejects(
      api.query(
        `INSERT INTO intel.category_resolution (
           logical_transaction_id, financial_event_resolution_id, canonical_transaction_version_id,
           taxonomy_version, category_status
         ) VALUES ($1, $1, $1, 'F10E-v1.2', 'UNKNOWN')`,
        ["00000000-0000-0000-0000-000000000001"],
      ),
      "direct insert",
    );

    async function seed(input: {
      ownerId?: string;
      accountId?: string;
      direction: "IN" | "OUT";
      description: string | null;
      reversal?: boolean;
      payload?: Record<string, unknown> | null;
    }): Promise<{ logicalId: string; versionId: string }> {
      const ownerId = input.ownerId ?? ownerA;
      const accountId = input.accountId ?? accountA;
      let sourceRecordId: string | null = null;
      let runId: string | null = null;
      let batchId: string | null = null;
      if (input.payload) {
        const batch = await admin.query<{ source_batch_id: string }>(
          `INSERT INTO core.source_batch (owner_id, source_type, status)
           VALUES ($1, 'BANK_STATEMENT_CSV', 'COMPLETED') RETURNING source_batch_id`,
          [ownerId],
        );
        batchId = batch.rows[0]!.source_batch_id;
        const document = await admin.query<{ source_document_id: string }>(
          `INSERT INTO core.source_document (source_batch_id, owner_id, content_hash, status)
           VALUES ($1, $2, $3, 'AVAILABLE') RETURNING source_document_id`,
          [batchId, ownerId, `${stamp}-${Math.random()}`],
        );
        const adapter = await admin.query<{ adapter_version_id: string }>(
          "SELECT adapter_version_id FROM ref.adapter_registry WHERE adapter_id = 'parser-v4' AND adapter_version = 'v4'",
        );
        const run = await admin.query<{ extraction_run_id: string }>(
          `INSERT INTO core.extraction_run (source_document_id, adapter_version_id, run_no, status, run_reason, completed_at)
           VALUES ($1, $2, 1, 'COMPLETED', 'INITIAL', clock_timestamp()) RETURNING extraction_run_id`,
          [document.rows[0]!.source_document_id, adapter.rows[0]!.adapter_version_id],
        );
        runId = run.rows[0]!.extraction_run_id;
        const record = await admin.query<{ source_record_id: string }>(
          `INSERT INTO core.source_record (
             extraction_run_id, extraction_sequence, raw_record_payload, raw_description, record_status
           ) VALUES ($1, 1, $2::jsonb, $3, 'TRANSACTION_CANDIDATE') RETURNING source_record_id`,
          [runId, JSON.stringify(input.payload), input.description],
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
           1, 'READY', 0, 'M3.2-test', $5, 'DISTINCT', $6, $7, $8, $9
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
           ) VALUES ($1, $2, $3, 'PRIMARY_VERSION_SOURCE', 1, ARRAY['M3_2_TEST'], true)`,
          [logicalId, sourceRecordId, versionId],
        );
      }
      return { logicalId, versionId };
    }

    async function interpret(logicalId: string, version?: string) {
      return api.query(
        "SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, $4)",
        [actorA, ownerA, logicalId, version ?? null],
      );
    }

    async function resolve(logicalId: string, version?: string, actor = actorA, owner = ownerA): Promise<UseResult> {
      const result = await api.query<{ result: UseResult }>(
        "SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, $4) AS result",
        [actor, owner, logicalId, version ?? null],
      );
      return result.rows[0]!.result;
    }

    async function money(versionId: string): Promise<Money> {
      const row = await admin.query<Money>(
        `SELECT amount::text, transaction_date::text, direction, currency_code, financial_account_id::text
           FROM core.canonical_transaction_version WHERE canonical_transaction_version_id = $1`,
        [versionId],
      );
      return row.rows[0]!;
    }

    async function useRows(logicalId: string) {
      return admin.query<{
        category_status: string;
        category_code: string | null;
        purpose_status: string;
        purpose_code: string | null;
        category_confidence: string | null;
        purpose_confidence: string | null;
        is_current: boolean;
        taxonomy_version: string;
        event_family: string | null;
        resolution_outcome: string;
      }>(
        `SELECT c.category_status, c.category_code, c.category_confidence::text, c.is_current, c.taxonomy_version,
                p.purpose_status, p.purpose_code, p.purpose_confidence::text,
                e.event_family, e.resolution_outcome
           FROM intel.category_resolution c
           JOIN intel.purpose_resolution p
             ON p.financial_event_resolution_id = c.financial_event_resolution_id
            AND p.taxonomy_version = c.taxonomy_version
           JOIN intel.financial_event_resolution e
             ON e.financial_event_resolution_id = c.financial_event_resolution_id
          WHERE c.logical_transaction_id = $1
          ORDER BY c.created_at`,
        [logicalId],
      );
    }

    const early = await seed({ direction: "OUT", description: "monthly emi" });
    const earlyUse = await resolve(early.logicalId);
    assert.equal(earlyUse.outcome, "ineligible", "missing event");
    const earlyCount = await admin.query(
      "SELECT 1 FROM intel.category_resolution WHERE logical_transaction_id = $1",
      [early.logicalId],
    );
    assert.equal(earlyCount.rowCount, 0, "missing event");

    const loan = await seed({ direction: "OUT", description: "monthly emi" });
    const loanBefore = await money(loan.versionId);
    await interpret(loan.logicalId);
    const loanUse = await resolve(loan.logicalId);
    assert.equal(loanUse.outcome, "created", "LOAN_REPAYMENT");
    assert.equal(loanUse.category_status, "NOT_APPLICABLE", "LOAN_REPAYMENT");
    assert.equal(loanUse.purpose_status, "UNKNOWN", "purpose independent");
    const loanRows = await useRows(loan.logicalId);
    assert.equal(loanRows.rows[0]?.category_code, null, "LOAN_REPAYMENT");
    assert.equal(loanRows.rows[0]?.purpose_code, null, "purpose independent");
    assert.equal(loanRows.rows[0]?.event_family, "LOAN_REPAYMENT", "F10D unchanged");
    assert.equal(loanRows.rows[0]?.category_confidence, null, "no invented confidence");
    assert.equal(loanRows.rows[0]?.purpose_confidence, null, "no invented confidence");
    assert.deepEqual(await money(loan.versionId), loanBefore, "canonical");

    const replay = await resolve(loan.logicalId);
    assert.equal(replay.outcome, "replay", "replay");
    assert.equal((await useRows(loan.logicalId)).rowCount, 1, "replay");
    const loanOutbox = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ops.outbox_event
        WHERE aggregate_id = $1 AND semantic_trigger_code IN ('CATEGORY_RESOLUTION_AVAILABLE', 'PURPOSE_RESOLUTION_AVAILABLE')`,
      [loan.logicalId],
    );
    assert.equal(loanOutbox.rows[0]?.count, "2", "outbox");

    const card = await seed({ direction: "OUT", description: "credit card restaurant dinner" });
    await interpret(card.logicalId);
    const cardUse = await resolve(card.logicalId);
    assert.equal(cardUse.category_status, "NOT_APPLICABLE", "AC-07");
    assert.equal(cardUse.purpose_status, "NOT_APPLICABLE", "AC-07");
    const cardFamily = await admin.query<{ event_family: string; category_code: string | null }>(
      `SELECT e.event_family, c.category_code
         FROM intel.financial_event_resolution e
         JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id
        WHERE e.logical_transaction_id = $1 AND e.is_current`,
      [card.logicalId],
    );
    assert.equal(cardFamily.rows[0]?.event_family, "CREDIT_CARD_PAYMENT", "AC-07");
    assert.equal(cardFamily.rows[0]?.category_code, null, "AC-07");

    const income = await seed({ direction: "IN", description: "savings interest for june" });
    await interpret(income.logicalId);
    const incomeUse = await resolve(income.logicalId);
    assert.equal(incomeUse.category_status, "NOT_APPLICABLE", "INCOME");
    assert.equal(incomeUse.purpose_status, "NOT_APPLICABLE", "INCOME");
    const incomePurpose = await admin.query<{ purpose_code: string | null; event_family: string }>(
      `SELECT p.purpose_code, e.event_family
         FROM intel.purpose_resolution p
         JOIN intel.financial_event_resolution e ON e.financial_event_resolution_id = p.financial_event_resolution_id
        WHERE p.logical_transaction_id = $1`,
      [income.logicalId],
    );
    assert.equal(incomePurpose.rows[0]?.event_family, "INCOME", "INC_040");
    assert.equal(incomePurpose.rows[0]?.purpose_code, null, "purpose not salary");

    const cash = await seed({
      direction: "OUT",
      description: "cash withdrawal",
      payload: { channel_type: "ATM", parse_format: "ATM_WDL_DASH" },
    });
    await interpret(cash.logicalId);
    const cashUse = await resolve(cash.logicalId);
    assert.equal(cashUse.category_status, "UNKNOWN", "AC-09");
    assert.equal(cashUse.purpose_status, "UNKNOWN", "AC-09");
    const cashCode = await admin.query<{ category_code: string | null; event_family: string }>(
      `SELECT c.category_code, e.event_family
         FROM intel.category_resolution c
         JOIN intel.financial_event_resolution e ON e.financial_event_resolution_id = c.financial_event_resolution_id
        WHERE c.logical_transaction_id = $1`,
      [cash.logicalId],
    );
    assert.equal(cashCode.rows[0]?.event_family, "CASH_MOVEMENT", "CASH_001");
    assert.equal(cashCode.rows[0]?.category_code, null, "AC-09");

    const refund = await seed({ direction: "IN", description: "store refund", reversal: true });
    await interpret(refund.logicalId);
    const refundUse = await resolve(refund.logicalId);
    assert.equal(refundUse.category_status, "UNKNOWN", "section 18");
    assert.equal(refundUse.purpose_status, "UNKNOWN", "section 18");
    const refundFamily = await admin.query<{ event_family: string; category_code: string | null }>(
      `SELECT e.event_family, c.category_code
         FROM intel.financial_event_resolution e
         JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id
        WHERE e.logical_transaction_id = $1 AND c.is_current`,
      [refund.logicalId],
    );
    assert.equal(refundFamily.rows[0]?.event_family, "REFUND_REVERSAL", "INC_050");
    assert.equal(refundFamily.rows[0]?.category_code, null, "section 18");

    const unknown = await seed({ direction: "OUT", description: "SWIGGY ORDER 441" });
    await interpret(unknown.logicalId);
    const unknownUse = await resolve(unknown.logicalId);
    assert.equal(unknownUse.category_status, "UNKNOWN", "AC-10");
    assert.equal(unknownUse.purpose_status, "UNKNOWN", "AC-10");
    const unknownCode = await admin.query<{ category_code: string | null; resolution_outcome: string }>(
      `SELECT c.category_code, e.resolution_outcome
         FROM intel.category_resolution c
         JOIN intel.financial_event_resolution e ON e.financial_event_resolution_id = c.financial_event_resolution_id
        WHERE c.logical_transaction_id = $1`,
      [unknown.logicalId],
    );
    assert.equal(unknownCode.rows[0]?.resolution_outcome, "UNKNOWN", "AC-10");
    assert.equal(unknownCode.rows[0]?.category_code, null, "AC-10");

    const clash = await seed({ direction: "OUT", description: "EMI credit card payment" });
    await interpret(clash.logicalId);
    const clashUse = await resolve(clash.logicalId);
    assert.equal(clashUse.category_status, "UNKNOWN", "AMBIGUOUS event");
    assert.equal(clashUse.purpose_status, "UNKNOWN", "AMBIGUOUS event");
    const clashEvent = await admin.query<{ resolution_outcome: string; category_code: string | null }>(
      `SELECT e.resolution_outcome, c.category_code
         FROM intel.financial_event_resolution e
         JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id
        WHERE e.logical_transaction_id = $1`,
      [clash.logicalId],
    );
    assert.equal(clashEvent.rows[0]?.resolution_outcome, "AMBIGUOUS", "AMBIGUOUS event");
    assert.equal(clashEvent.rows[0]?.category_code, null, "AMBIGUOUS event");

    await admin.query(
      "INSERT INTO ref.taxonomy_version (taxonomy_version) VALUES ($1)",
      [`F10E-v1.3-${stamp}`],
    );
    const upgraded = await resolve(loan.logicalId, `F10E-v1.3-${stamp}`);
    assert.equal(upgraded.outcome, "created", "taxonomy version");
    assert.equal(upgraded.category_status, "UNKNOWN", "taxonomy version");
    const history = await useRows(loan.logicalId);
    assert.equal(history.rowCount, 2, "history");
    assert.equal(history.rows[0]?.taxonomy_version, "F10E-v1.2", "history");
    assert.equal(history.rows[0]?.category_status, "NOT_APPLICABLE", "history");
    assert.equal(history.rows[0]?.is_current, false, "history");
    assert.equal(history.rows[1]?.taxonomy_version, `F10E-v1.3-${stamp}`, "history");
    assert.equal(history.rows[1]?.is_current, true, "history");
    assert.equal(history.rows[0]?.event_family, "LOAN_REPAYMENT", "F10D unchanged");

    const changed = await seed({ direction: "OUT", description: "monthly emi" });
    await interpret(changed.logicalId);
    await resolve(changed.logicalId);
    await admin.query(
      `INSERT INTO ref.financial_event_rule (
         rulebook_version, rule_code, clause_no, precedence_band, event_family,
         direction_code, evidence_source, match_value, catalogue_note
       ) VALUES (
         $2, 'TEST_CASH', 1, 'P4', 'CASH_MOVEMENT',
         'OUT', 'description', $1, 'Test-only event version for F10E replay.'
       )`,
      ["\\yemi\\y", `F10D-m32-${stamp}`],
    );
    await interpret(changed.logicalId, `F10D-m32-${stamp}`);
    const replayed = await resolve(changed.logicalId);
    assert.equal(replayed.outcome, "created", "AC-52");
    assert.equal(replayed.category_status, "UNKNOWN", "AC-52");
    const eventHistory = await admin.query<{
      rulebook_version: string;
      event_family: string | null;
      category_status: string;
      is_current: boolean;
    }>(
      `SELECT e.rulebook_version, e.event_family, c.category_status, c.is_current
         FROM intel.financial_event_resolution e
         JOIN intel.category_resolution c ON c.financial_event_resolution_id = e.financial_event_resolution_id
        WHERE e.logical_transaction_id = $1
        ORDER BY e.interpreted_at`,
      [changed.logicalId],
    );
    assert.equal(eventHistory.rowCount, 2, "AC-52");
    assert.equal(eventHistory.rows[0]?.event_family, "LOAN_REPAYMENT", "AC-52");
    assert.equal(eventHistory.rows[0]?.category_status, "NOT_APPLICABLE", "AC-52");
    assert.equal(eventHistory.rows[0]?.is_current, false, "AC-52");
    assert.equal(eventHistory.rows[1]?.event_family, "CASH_MOVEMENT", "AC-52");
    assert.equal(eventHistory.rows[1]?.is_current, true, "AC-52");

    const concurrent = await seed({ direction: "OUT", description: "monthly emi" });
    await interpret(concurrent.logicalId);
    const pair = await Promise.all([
      left.query<{ result: UseResult }>(
        "SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, NULL) AS result",
        [actorA, ownerA, concurrent.logicalId],
      ),
      right.query<{ result: UseResult }>(
        "SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, NULL) AS result",
        [actorA, ownerA, concurrent.logicalId],
      ),
    ]);
    assert.deepEqual(pair.map((item) => item.rows[0]!.result.outcome).sort(), ["created", "replay"], "concurrency");
    assert.equal((await useRows(concurrent.logicalId)).rowCount, 1, "concurrency");

    const rolled = await seed({ direction: "OUT", description: "monthly emi" });
    await interpret(rolled.logicalId);
    try {
      await api.query("BEGIN");
      const pending = await resolve(rolled.logicalId);
      assert.equal(pending.outcome, "created", "rollback");
      await api.query("ROLLBACK");
    } catch (error) {
      await api.query("ROLLBACK");
      throw error;
    }
    const rolledRows = await admin.query(
      "SELECT 1 FROM intel.category_resolution WHERE logical_transaction_id = $1",
      [rolled.logicalId],
    );
    assert.equal(rolledRows.rowCount, 0, "rollback");
    const rolledOutbox = await admin.query(
      `SELECT 1 FROM ops.outbox_event
        WHERE aggregate_id = $1 AND semantic_trigger_code = 'CATEGORY_RESOLUTION_AVAILABLE'`,
      [rolled.logicalId],
    );
    assert.equal(rolledOutbox.rowCount, 0, "rollback");

    const forbidden = await resolve(loan.logicalId, undefined, actorB, ownerA);
    assert.equal(forbidden.outcome, "forbidden", "owner");
    const business = await seed({
      ownerId: ownerBiz,
      accountId: accountBiz,
      direction: "OUT",
      description: "monthly emi",
    });
    await api.query("SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL)", [
      actorA,
      ownerBiz,
      business.logicalId,
    ]);
    const businessUse = await resolve(business.logicalId, undefined, actorA, ownerBiz);
    assert.equal(businessUse.outcome, "business_isolated", "business");
    const businessRows = await admin.query(
      "SELECT 1 FROM intel.category_resolution WHERE logical_transaction_id = $1",
      [business.logicalId],
    );
    assert.equal(businessRows.rowCount, 0, "business");

    const absent = await admin.query(
      `SELECT 1 FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname IN ('txn_fact', 'txn_parsed', 'txn_enriched', 'txn_categorized')`,
    );
    assert.equal(absent.rowCount, 0, "no second ledger");
    const mounted = await admin.query<{ rule_code: string }>(
      `SELECT DISTINCT rule_code FROM ref.financial_event_rule
        WHERE rulebook_version = 'F10D-v1.2' ORDER BY rule_code`,
    );
    assert.deepEqual(
      mounted.rows.map((row) => row.rule_code),
      ["CASH_001", "CC_001", "EMI_001", "EMI_002", "INC_040", "INC_050"],
      "F10D rules",
    );
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
