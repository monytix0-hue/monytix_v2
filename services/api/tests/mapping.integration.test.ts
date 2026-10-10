import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;

test("statement mapping creates one canonical transaction and refuses weak or cross-owner matches", async (t) => {
  if (!databaseUrl || !adminUrl) {
    t.skip("local Postgres 17 is not configured");
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  const api = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  await api.connect();
  const stamp = Date.now().toString();
  try {
    const adapter = await admin.query<{ adapter_version_id: string }>(
      "SELECT adapter_version_id FROM ref.adapter_registry WHERE adapter_id = 'parser-v4' AND adapter_version = 'v4'",
    );
    const owners = await admin.query<{ owner_id: string }>(
      "INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1), ('PERSON', $2) RETURNING owner_id",
      [`m25-a-${stamp}`, `m25-b-${stamp}`],
    );
    const ownerA = owners.rows[0]!.owner_id;
    const ownerB = owners.rows[1]!.owner_id;
    const accounts = await admin.query<{ financial_account_id: string }>(
      `INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
       VALUES ('SAVINGS', 'A', 'USD', 'ACTIVE'), ('SAVINGS', 'B', 'USD', 'ACTIVE')
       RETURNING financial_account_id`,
    );
    const accountA = accounts.rows[0]!.financial_account_id;
    const accountB = accounts.rows[1]!.financial_account_id;
    await admin.query(
      `INSERT INTO core.account_ownership (owner_id, financial_account_id, relationship_role, verification_state, relationship_status)
       VALUES ($1, $2, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE'), ($3, $4, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE')`,
      [ownerA, accountA, ownerB, accountB],
    );

    async function seed(input: {
      ownerId: string;
      accountId?: string;
      resolved?: boolean;
      currency?: string | null;
      runStatus?: string;
      runReason?: string | null;
      recordStatus?: string;
      amount?: string | null;
      date?: string | null;
      direction?: string;
      reference?: string | null;
      description?: string;
    }): Promise<{ runId: string; recordId: string }> {
      const batch = await admin.query<{ source_batch_id: string }>(
        `INSERT INTO core.source_batch (owner_id, source_type, status) VALUES ($1, 'BANK_STATEMENT_CSV', 'COMPLETED') RETURNING source_batch_id`,
        [input.ownerId],
      );
      const document = await admin.query<{ source_document_id: string }>(
        `INSERT INTO core.source_document (source_batch_id, owner_id, content_hash, status, reason_codes, metadata)
         VALUES ($1, $2, $3, 'AVAILABLE', ARRAY['SCAN_CLEAN'], '{"sealed": true}'::jsonb)
         RETURNING source_document_id`,
        [batch.rows[0]!.source_batch_id, input.ownerId, `hash-${stamp}-${Math.random()}`],
      );
      const documentId = document.rows[0]!.source_document_id;
      if (input.resolved && input.accountId) {
        await admin.query(
          `INSERT INTO core.statement_instance (source_document_id, financial_account_id, currency_code, account_resolution_status, statement_status)
           VALUES ($1, $2, $3, 'RESOLVED', 'PARTIAL')`,
          [documentId, input.accountId, input.currency ?? null],
        );
      }
      const run = await admin.query<{ extraction_run_id: string }>(
        `INSERT INTO core.extraction_run (source_document_id, adapter_version_id, run_no, status, run_reason, reason_codes, completed_at)
         VALUES ($1, $2, 1, $3, 'INITIAL', $4, clock_timestamp())
         RETURNING extraction_run_id`,
        [documentId, adapter.rows[0]!.adapter_version_id, input.runStatus ?? "COMPLETED", input.runReason ? [input.runReason] : []],
      );
      const record = await admin.query<{ source_record_id: string }>(
        `INSERT INTO core.source_record (
           extraction_run_id, extraction_sequence, raw_record_payload, raw_description, raw_transaction_date,
           raw_amount, raw_reference, record_status
         ) VALUES ($1, 1, $2::jsonb, $3, $4, $5, $6, $7)
         RETURNING source_record_id`,
        [
          run.rows[0]!.extraction_run_id,
          JSON.stringify({ direction: input.direction ?? "OUT", normalized_description: input.description ?? "UPI-123" }),
          input.description ?? "UPI-123",
          input.date === undefined ? "2026-01-02" : input.date,
          input.amount === undefined ? "10.00" : input.amount,
          input.reference === undefined ? `REF-${Math.random()}` : input.reference,
          input.recordStatus ?? "TRANSACTION_CANDIDATE",
        ],
      );
      return { runId: run.rows[0]!.extraction_run_id, recordId: record.rows[0]!.source_record_id };
    }

    async function disposition(recordId: string): Promise<{ outcome: string; reason: string | null; logical_transaction_id: string | null }> {
      const row = await admin.query<{ outcome: string; reason: string | null; logical_transaction_id: string | null }>(
        `SELECT outcome, reason_codes[1] AS reason, logical_transaction_id
           FROM core.source_record_disposition WHERE source_record_id = $1`,
        [recordId],
      );
      return row.rows[0]!;
    }

    const debit = await seed({ ownerId: ownerA, accountId: accountA, resolved: true, direction: "OUT", reference: `UPI-${stamp}` });
    const first = await api.query<{ result: { outcome: string; mapped: number } }>(
      "SELECT ops.map_statement_extraction($1::uuid) AS result",
      [debit.runId],
    );
    assert.equal(first.rows[0]?.result.mapped, 1);
    const debitRow = await disposition(debit.recordId);
    assert.equal(debitRow.outcome, "MAPPED");
    const canonical = await admin.query<{ direction: string; currency_code: string; amount: string }>(
      `SELECT direction, currency_code, amount::text AS amount
         FROM core.canonical_transaction_version WHERE source_record_id = $1`,
      [debit.recordId],
    );
    assert.equal(canonical.rows[0]?.direction, "OUT");
    assert.equal(canonical.rows[0]?.currency_code, "USD");
    assert.equal(canonical.rows[0]?.amount, "10.0000");
    const evidence = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM core.transaction_evidence_link WHERE source_record_id = $1 AND relationship_type = 'PRIMARY_VERSION_SOURCE'",
      [debit.recordId],
    );
    assert.equal(evidence.rows[0]?.count, 1);
    const replay = await api.query<{ result: { outcome: string } }>("SELECT ops.map_statement_extraction($1::uuid) AS result", [debit.runId]);
    assert.equal(replay.rows[0]?.result.outcome, "replay");

    const credit = await seed({ ownerId: ownerA, accountId: accountA, resolved: true, direction: "IN", amount: "4.50", reference: `CR-${stamp}` });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [credit.runId]);
    const creditCanonical = await admin.query<{ direction: string }>(
      "SELECT direction FROM core.canonical_transaction_version WHERE source_record_id = $1",
      [credit.recordId],
    );
    assert.equal(creditCanonical.rows[0]?.direction, "IN");

    const overlap = await seed({ ownerId: ownerA, accountId: accountA, resolved: true, direction: "OUT", reference: `UPI-${stamp}` });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [overlap.runId]);
    assert.equal((await disposition(overlap.recordId)).outcome, "LINKED_EXISTING");
    const logicalCount = await admin.query<{ count: number }>(
      `SELECT count(DISTINCT logical_transaction_id)::int AS count
         FROM core.source_record_disposition
        WHERE source_record_id IN ($1, $2) AND logical_transaction_id IS NOT NULL`,
      [debit.recordId, overlap.recordId],
    );
    assert.equal(logicalCount.rows[0]?.count, 1);

    const other = await seed({ ownerId: ownerA, accountId: accountA, resolved: true, direction: "OUT", amount: "10.00", date: "2026-01-02", reference: `OTHER-${stamp}` });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [other.runId]);
    assert.equal((await disposition(other.recordId)).outcome, "MAPPED");
    assert.notEqual((await disposition(other.recordId)).logical_transaction_id, debitRow.logical_transaction_id);

    const weak = await seed({ ownerId: ownerA, accountId: accountA, resolved: true, direction: "OUT", amount: "10.00", date: "2026-01-02", reference: null });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [weak.runId]);
    assert.equal((await disposition(weak.recordId)).outcome, "REVIEW_REQUIRED");
    assert.equal((await disposition(weak.recordId)).reason, "WEAK_MATCH");
    assert.equal((await disposition(weak.recordId)).logical_transaction_id, null);

    const missingDate = await seed({ ownerId: ownerA, accountId: accountA, resolved: true, date: null, reference: `DATE-${stamp}` });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [missingDate.runId]);
    assert.equal((await disposition(missingDate.recordId)).reason, "DATE_MISSING");

    const badAmount = await seed({ ownerId: ownerA, accountId: accountA, resolved: true, amount: "10.5.1", reference: `AMT-${stamp}` });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [badAmount.runId]);
    assert.equal((await disposition(badAmount.recordId)).outcome, "REJECTED");

    const noAccount = await seed({ ownerId: ownerA, resolved: false, reference: `NA-${stamp}` });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [noAccount.runId]);
    assert.equal((await disposition(noAccount.recordId)).reason, "ACCOUNT_UNRESOLVED");

    const cross = await seed({ ownerId: ownerA, accountId: accountB, resolved: true, reference: `XO-${stamp}` });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [cross.runId]);
    assert.equal((await disposition(cross.recordId)).reason, "ACCOUNT_OWNER_MISMATCH");

    const partial = await seed({
      ownerId: ownerA,
      accountId: accountA,
      resolved: true,
      recordStatus: "EXTRACTION_PARTIAL",
      reference: `PART-${stamp}`,
      description: "HELLO THERE THIS IS NOT A BANK LINE",
    });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [partial.runId]);
    assert.equal((await disposition(partial.recordId)).outcome, "MAPPED");

    const pdf = await seed({ ownerId: ownerA, accountId: accountA, resolved: true, runStatus: "FAILED", runReason: "UNSUPPORTED_FILE_LAYOUT", reference: `PDF-${stamp}` });
    const blocked = await api.query<{ result: { outcome: string } }>("SELECT ops.map_statement_extraction($1::uuid) AS result", [pdf.runId]);
    assert.equal(blocked.rows[0]?.result.outcome, "ineligible");

    const concurrent = await seed({ ownerId: ownerA, accountId: accountA, resolved: true, reference: `CON-${stamp}` });
    const left = new pg.Client({ connectionString: databaseUrl });
    const right = new pg.Client({ connectionString: databaseUrl });
    await left.connect();
    await right.connect();
    try {
      await Promise.all([
        left.query("SELECT ops.map_statement_extraction($1::uuid)", [concurrent.runId]),
        right.query("SELECT ops.map_statement_extraction($1::uuid)", [concurrent.runId]),
      ]);
    } finally {
      await left.end();
      await right.end();
    }
    const concurrentLinks = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM core.transaction_evidence_link WHERE source_record_id = $1 AND relationship_type = 'PRIMARY_VERSION_SOURCE'",
      [concurrent.recordId],
    );
    assert.equal(concurrentLinks.rows[0]?.count, 1);

    const rollbackSeed = await seed({ ownerId: ownerA, accountId: accountA, resolved: true, reference: `RB-${stamp}` });
    const before = await admin.query<{ count: number }>("SELECT count(*)::int AS count FROM core.logical_transaction");
    await admin.query("BEGIN");
    await admin.query("SELECT ops.map_statement_extraction($1::uuid)", [rollbackSeed.runId]);
    const during = await admin.query<{ count: number }>("SELECT count(*)::int AS count FROM core.logical_transaction");
    await admin.query("ROLLBACK");
    const after = await admin.query<{ count: number }>("SELECT count(*)::int AS count FROM core.logical_transaction");
    assert.equal(during.rows[0]!.count, before.rows[0]!.count + 1);
    assert.equal(after.rows[0]!.count, before.rows[0]!.count);

    const denied = await admin.query<{ allowed: boolean }>(
      "SELECT has_function_privilege('monytix_intelligence', 'ops.map_statement_extraction(uuid)', 'EXECUTE') AS allowed",
    );
    assert.equal(denied.rows[0]?.allowed, false);
    await admin.query("BEGIN");
    await admin.query("SET LOCAL ROLE monytix_api");
    await admin.query("SELECT set_config('app.owner_id', $1, true)", [ownerB]);
    const hidden = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM core.source_record_disposition WHERE source_record_id = $1",
      [debit.recordId],
    );
    await admin.query("ROLLBACK");
    assert.equal(hidden.rows[0]?.count, 0);
  } finally {
    await admin.end();
    await api.end();
  }
});
