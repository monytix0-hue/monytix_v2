import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { anonymousApp } from "./auth-fixture.js";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;

test("GET /v1/imports/:id/review rejects a missing token", async () => {
  const app = await anonymousApp();
  const response = await app.inject({ method: "GET", url: "/v1/imports/00000000-0000-0000-0000-000000000001/review" });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("statement reconciliation links only a full match and reviews the rest", async (t) => {
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
    const actorA = await admin.query<{ provision_authenticated_actor: string }>(
      "SELECT ops.provision_authenticated_actor($1, $2, $3)",
      ["firebase", `m26-a-${stamp}`, null],
    );
    const actorB = await admin.query<{ provision_authenticated_actor: string }>(
      "SELECT ops.provision_authenticated_actor($1, $2, $3)",
      ["firebase", `m26-b-${stamp}`, null],
    );
    const actorIdA = actorA.rows[0]!.provision_authenticated_actor;
    const actorIdB = actorB.rows[0]!.provision_authenticated_actor;
    const owners = await admin.query<{ owner_id: string }>(
      "INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1), ('PERSON', $2) RETURNING owner_id",
      [`m26-a-${stamp}`, `m26-b-${stamp}`],
    );
    const ownerA = owners.rows[0]!.owner_id;
    const ownerB = owners.rows[1]!.owner_id;
    await admin.query(
      `INSERT INTO core.actor_owner_membership (actor_id, owner_id, membership_role, membership_status, is_default_owner)
       VALUES ($1, $2, 'OWNER', 'ACTIVE', true), ($3, $4, 'OWNER', 'ACTIVE', true)`,
      [actorIdA, ownerA, actorIdB, ownerB],
    );
    const accounts = await admin.query<{ financial_account_id: string }>(
      `INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
       VALUES ('SAVINGS', 'A', 'USD', 'ACTIVE'), ('SAVINGS', 'A2', 'USD', 'ACTIVE'), ('SAVINGS', 'B', 'USD', 'ACTIVE')
       RETURNING financial_account_id`,
    );
    const accountA = accounts.rows[0]!.financial_account_id;
    const accountA2 = accounts.rows[1]!.financial_account_id;
    const accountB = accounts.rows[2]!.financial_account_id;
    await admin.query(
      `INSERT INTO core.account_ownership (owner_id, financial_account_id, relationship_role, verification_state, relationship_status)
       VALUES ($1, $2, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE'),
              ($1, $3, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE'),
              ($4, $5, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE')`,
      [ownerA, accountA, accountA2, ownerB, accountB],
    );

    async function seed(input: {
      ownerId?: string;
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
      scanned?: boolean;
    }): Promise<{ runId: string; recordId: string; batchId: string }> {
      const ownerId = input.ownerId ?? ownerA;
      const batch = await admin.query<{ source_batch_id: string }>(
        `INSERT INTO core.source_batch (owner_id, source_type, status) VALUES ($1, 'BANK_STATEMENT_CSV', 'COMPLETED') RETURNING source_batch_id`,
        [ownerId],
      );
      const scanned = input.scanned !== false;
      const document = await admin.query<{ source_document_id: string }>(
        `INSERT INTO core.source_document (source_batch_id, owner_id, content_hash, status, reason_codes, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING source_document_id`,
        [
          batch.rows[0]!.source_batch_id,
          ownerId,
          `hash-${stamp}-${Math.random()}`,
          scanned ? "AVAILABLE" : "RECEIVED",
          scanned ? ["SCAN_CLEAN"] : ["MALWARE_SCAN_PENDING"],
          scanned ? '{"sealed": true}' : "{}",
        ],
      );
      if (input.resolved && input.accountId) {
        await admin.query(
          `INSERT INTO core.statement_instance (source_document_id, financial_account_id, currency_code, account_resolution_status, statement_status)
           VALUES ($1, $2, $3, 'RESOLVED', 'PARTIAL')`,
          [document.rows[0]!.source_document_id, input.accountId, input.currency === undefined ? null : input.currency],
        );
      }
      const run = await admin.query<{ extraction_run_id: string }>(
        `INSERT INTO core.extraction_run (source_document_id, adapter_version_id, run_no, status, run_reason, reason_codes, worker_metadata, completed_at)
         VALUES ($1, $2, 1, $3, 'INITIAL', $4, '{"parser_version":"v4"}'::jsonb, clock_timestamp())
         RETURNING extraction_run_id`,
        [
          document.rows[0]!.source_document_id,
          adapter.rows[0]!.adapter_version_id,
          input.runStatus ?? "COMPLETED",
          input.runReason ? [input.runReason] : [],
        ],
      );
      const record = await admin.query<{ source_record_id: string }>(
        `INSERT INTO core.source_record (
           extraction_run_id, extraction_sequence, raw_record_payload, raw_description, raw_transaction_date,
           raw_amount, raw_reference, record_status
         ) VALUES ($1, 1, $2::jsonb, $3, $4, $5, $6, $7) RETURNING source_record_id`,
        [
          run.rows[0]!.extraction_run_id,
          JSON.stringify({ direction: input.direction ?? "OUT", normalized_description: input.description ?? "UPI rent" }),
          input.description ?? "UPI rent",
          input.date === undefined ? "2026-02-02" : input.date,
          input.amount === undefined ? "10.00" : input.amount,
          input.reference === undefined ? `REF-${Math.random()}` : input.reference,
          input.recordStatus ?? "TRANSACTION_CANDIDATE",
        ],
      );
      return { runId: run.rows[0]!.extraction_run_id, recordId: record.rows[0]!.source_record_id, batchId: batch.rows[0]!.source_batch_id };
    }

    async function disposition(recordId: string): Promise<{ outcome: string; reason: string | null; logical_transaction_id: string | null; review_version: number }> {
      const row = await admin.query<{ outcome: string; reason: string | null; logical_transaction_id: string | null; review_version: number }>(
        `SELECT outcome, reason_codes[1] AS reason, logical_transaction_id, review_version
           FROM core.source_record_disposition WHERE source_record_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [recordId],
      );
      return row.rows[0]!;
    }

    async function map(runId: string): Promise<void> {
      await api.query("SELECT ops.map_statement_extraction($1::uuid)", [runId]);
    }

    const first = await seed({ accountId: accountA, resolved: true, reference: `SAME-${stamp}`, amount: "10.00" });
    await map(first.runId);
    const overlap = await seed({ accountId: accountA, resolved: true, reference: `SAME-${stamp}`, amount: "10.00" });
    await map(overlap.runId);
    assert.equal((await disposition(overlap.recordId)).outcome, "LINKED_EXISTING");
    const sameLogical = await admin.query<{ count: number }>(
      `SELECT count(DISTINCT logical_transaction_id)::int AS count FROM core.source_record_disposition
        WHERE source_record_id IN ($1, $2) AND logical_transaction_id IS NOT NULL`,
      [first.recordId, overlap.recordId],
    );
    assert.equal(sameLogical.rows[0]?.count, 1);

    const otherAccount = await seed({ accountId: accountA2, resolved: true, reference: `SAME-${stamp}`, amount: "10.00" });
    await map(otherAccount.runId);
    assert.equal((await disposition(otherAccount.recordId)).outcome, "MAPPED");
    assert.notEqual((await disposition(otherAccount.recordId)).logical_transaction_id, (await disposition(first.recordId)).logical_transaction_id);

    const amountA = await seed({ accountId: accountA, resolved: true, reference: `AMT-${stamp}`, amount: "11.00" });
    await map(amountA.runId);
    const amountB = await seed({ accountId: accountA, resolved: true, reference: `AMT-${stamp}`, amount: "12.00" });
    await map(amountB.runId);
    assert.equal((await disposition(amountB.recordId)).reason, "CONFLICTING_REFERENCE");
    assert.equal((await disposition(amountB.recordId)).logical_transaction_id, null);

    const usd = await seed({ accountId: accountA, resolved: true, currency: "USD", reference: `CUR-${stamp}`, amount: "13.00" });
    await map(usd.runId);
    const eur = await seed({ accountId: accountA, resolved: true, currency: "EUR", reference: `CUR-${stamp}`, amount: "13.00" });
    await map(eur.runId);
    assert.equal((await disposition(eur.recordId)).reason, "CONFLICTING_REFERENCE");

    const payA = await seed({ accountId: accountA, resolved: true, reference: `PAY1-${stamp}`, amount: "14.00" });
    const payB = await seed({ accountId: accountA, resolved: true, reference: `PAY2-${stamp}`, amount: "14.00" });
    await map(payA.runId);
    await map(payB.runId);
    assert.equal((await disposition(payA.recordId)).outcome, "MAPPED");
    assert.equal((await disposition(payB.recordId)).outcome, "MAPPED");

    const dated = await seed({ accountId: accountA, resolved: true, reference: `DATE-${stamp}`, amount: "15.00" });
    await map(dated.runId);
    const weak = await seed({ accountId: accountA, resolved: true, reference: null, amount: "15.00" });
    await map(weak.runId);
    assert.equal((await disposition(weak.recordId)).reason, "WEAK_MATCH");

    const legOut = await seed({ accountId: accountA, resolved: true, direction: "OUT", reference: `XFER-${stamp}`, amount: "16.00" });
    const legIn = await seed({ accountId: accountA2, resolved: true, direction: "IN", reference: `XFER-${stamp}`, amount: "16.00" });
    await map(legOut.runId);
    await map(legIn.runId);
    assert.equal((await disposition(legOut.recordId)).outcome, "MAPPED");
    assert.equal((await disposition(legIn.recordId)).outcome, "MAPPED");
    assert.notEqual((await disposition(legOut.recordId)).logical_transaction_id, (await disposition(legIn.recordId)).logical_transaction_id);

    const repeatA = await seed({ accountId: accountA, resolved: true, reference: `R1-${stamp}`, amount: "17.00", date: "2026-03-01" });
    const repeatB = await seed({ accountId: accountA, resolved: true, reference: `R2-${stamp}`, amount: "17.00", date: "2026-03-08" });
    await map(repeatA.runId);
    await map(repeatB.runId);
    assert.notEqual((await disposition(repeatA.recordId)).logical_transaction_id, (await disposition(repeatB.recordId)).logical_transaction_id);

    const missing = await seed({ resolved: false, reference: `NA-${stamp}`, amount: "18.00", description: "keep this narration" });
    await map(missing.runId);
    assert.equal((await disposition(missing.recordId)).reason, "ACCOUNT_UNRESOLVED");
    const selected = await api.query<{ result: { outcome: string; body: { outcome: string; logical_transaction_id: string } } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'select_account',1,$5::uuid,NULL,$6) AS result",
      [actorIdA, ownerA, missing.batchId, missing.recordId, accountA, `sel-${stamp}`],
    );
    assert.equal(selected.rows[0]?.result.body.outcome, "MAPPED");
    const narration = await admin.query<{ raw_description: string; parser_version: string }>(
      `SELECT s.raw_description, er.worker_metadata->>'parser_version' AS parser_version
         FROM core.source_record s JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
        WHERE s.source_record_id = $1`,
      [missing.recordId],
    );
    assert.equal(narration.rows[0]?.raw_description, "keep this narration");
    assert.equal(narration.rows[0]?.parser_version, "v4");

    const crossAccount = await seed({ resolved: false, reference: `XO-${stamp}`, amount: "19.00" });
    await map(crossAccount.runId);
    const deniedAccount = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'select_account',1,$5::uuid,NULL,$6) AS result",
      [actorIdA, ownerA, crossAccount.batchId, crossAccount.recordId, accountB, `xo-${stamp}`],
    );
    assert.equal(deniedAccount.rows[0]?.result.outcome, "forbidden");
    assert.equal((await disposition(crossAccount.recordId)).outcome, "REVIEW_REQUIRED");

    const foreign = await seed({ ownerId: ownerB, accountId: accountB, resolved: true, reference: `FOR-${stamp}`, amount: "22.00" });
    await map(foreign.runId);
    const foreignLogical = (await disposition(foreign.recordId)).logical_transaction_id;
    const crossTxn = await seed({ resolved: false, reference: null, amount: "22.00", date: "2026-02-02" });
    await map(crossTxn.runId);
    const deniedTxn = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'link_existing',1,NULL,$5::uuid,$6) AS result",
      [actorIdA, ownerA, crossTxn.batchId, crossTxn.recordId, foreignLogical, `xt-${stamp}`],
    );
    assert.equal(deniedTxn.rows[0]?.result.outcome, "forbidden");

    const base = await seed({ accountId: accountA, resolved: true, reference: `NEW-${stamp}`, amount: "23.00" });
    await map(base.runId);
    const confirm = await seed({ accountId: accountA, resolved: true, reference: null, amount: "23.00" });
    await map(confirm.runId);
    const confirmed = await api.query<{ result: { body: { logical_transaction_id: string } } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'confirm_new',1,NULL,NULL,$5) AS result",
      [actorIdA, ownerA, confirm.batchId, confirm.recordId, `new-${stamp}`],
    );
    assert.notEqual(confirmed.rows[0]?.result.body.logical_transaction_id, (await disposition(base.recordId)).logical_transaction_id);

    const linkBase = await seed({ accountId: accountA, resolved: true, reference: `LNK-${stamp}`, amount: "24.00" });
    await map(linkBase.runId);
    const linkRow = await seed({ accountId: accountA, resolved: true, reference: null, amount: "24.00" });
    await map(linkRow.runId);
    const linked = await api.query<{ result: { body: { outcome: string; logical_transaction_id: string } } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'link_existing',1,NULL,$5::uuid,$6) AS result",
      [actorIdA, ownerA, linkRow.batchId, linkRow.recordId, (await disposition(linkBase.recordId)).logical_transaction_id, `lnk-${stamp}`],
    );
    assert.equal(linked.rows[0]?.result.body.outcome, "LINKED_EXISTING");
    assert.equal(linked.rows[0]?.result.body.logical_transaction_id, (await disposition(linkBase.recordId)).logical_transaction_id);

    const rejectRow = await seed({ resolved: false, reference: `REJ-${stamp}`, amount: "25.00" });
    await map(rejectRow.runId);
    await api.query(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'reject',1,NULL,NULL,$5)",
      [actorIdA, ownerA, rejectRow.batchId, rejectRow.recordId, `rej-${stamp}`],
    );
    assert.equal((await disposition(rejectRow.recordId)).outcome, "REJECTED");
    assert.equal((await disposition(rejectRow.recordId)).logical_transaction_id, null);

    const concurrent = await seed({ resolved: false, reference: `CON-${stamp}`, amount: "26.00" });
    await map(concurrent.runId);
    const left = new pg.Client({ connectionString: databaseUrl });
    const right = new pg.Client({ connectionString: databaseUrl });
    await left.connect();
    await right.connect();
    try {
      const results = await Promise.all([
        left.query<{ result: { outcome: string } }>(
          "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'select_account',1,$5::uuid,NULL,$6) AS result",
          [actorIdA, ownerA, concurrent.batchId, concurrent.recordId, accountA, `con-a-${stamp}`],
        ),
        right.query<{ result: { outcome: string } }>(
          "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'select_account',1,$5::uuid,NULL,$6) AS result",
          [actorIdA, ownerA, concurrent.batchId, concurrent.recordId, accountA, `con-b-${stamp}`],
        ),
      ]);
      const outcomes = results.map((row) => row.rows[0]?.result.outcome).sort();
      assert.deepEqual(outcomes, ["ok", "stale"]);
    } finally {
      await left.end();
      await right.end();
    }
    const concurrentLinks = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM core.transaction_evidence_link WHERE source_record_id = $1 AND relationship_type = 'PRIMARY_VERSION_SOURCE'",
      [concurrent.recordId],
    );
    assert.equal(concurrentLinks.rows[0]?.count, 1);

    const replayRow = await seed({ resolved: false, reference: `IDEM-${stamp}`, amount: "27.00" });
    await map(replayRow.runId);
    await api.query(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'select_account',1,$5::uuid,NULL,$6)",
      [actorIdA, ownerA, replayRow.batchId, replayRow.recordId, accountA, `idem-${stamp}`],
    );
    const replay = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'select_account',1,$5::uuid,NULL,$6) AS result",
      [actorIdA, ownerA, replayRow.batchId, replayRow.recordId, accountA, `idem-${stamp}`],
    );
    assert.equal(replay.rows[0]?.result.outcome, "replay");
    const reviewEvents = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ops.outbox_event
        WHERE semantic_trigger_code = 'STATEMENT_REVIEW_RESOLVED' AND aggregate_id = $1`,
      [replayRow.recordId],
    );
    assert.equal(reviewEvents.rows[0]?.count, 1);

    const stale = await seed({ resolved: false, reference: `STALE-${stamp}`, amount: "28.00" });
    await map(stale.runId);
    const staleResult = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'reject',9,NULL,NULL,$5) AS result",
      [actorIdA, ownerA, stale.batchId, stale.recordId, `stale-${stamp}`],
    );
    assert.equal(staleResult.rows[0]?.result.outcome, "stale");
    assert.equal((await disposition(stale.recordId)).review_version, 1);

    const counted = await seed({ accountId: accountA, resolved: true, reference: `C1-${stamp}`, amount: "40.00" });
    for (const row of [
      { amount: "40.00", reference: `C1-${stamp}`, sequence: 2 },
      { amount: "40.00", reference: null, sequence: 3 },
      { amount: "nope", reference: `BAD-${stamp}`, sequence: 4 },
    ]) {
      await admin.query(
        `INSERT INTO core.source_record (extraction_run_id, extraction_sequence, raw_record_payload, raw_description, raw_transaction_date, raw_amount, raw_reference, record_status)
         VALUES ($1, $2, '{"direction":"OUT"}'::jsonb, 'counted', '2026-02-02', $3, $4, 'TRANSACTION_CANDIDATE')`,
        [counted.runId, row.sequence, row.amount, row.reference],
      );
    }
    await map(counted.runId);
    const summary = await api.query<{ result: { total_source_records: number; mapped_count: number; linked_count: number; review_count: number; invalid_count: number; ineligible_count: number; pending_count: number } }>(
      "SELECT ops.statement_import_summary($1::uuid,$2::uuid,$3::uuid) AS result",
      [ownerA, actorIdA, counted.batchId],
    );
    const counts = summary.rows[0]!.result;
    assert.equal(counts.total_source_records, 4);
    assert.equal(counts.mapped_count, 1);
    assert.equal(counts.linked_count, 1);
    assert.equal(counts.review_count, 1);
    assert.equal(counts.invalid_count, 1);
    assert.equal(counts.mapped_count + counts.linked_count + counts.review_count + counts.invalid_count + counts.ineligible_count + counts.pending_count, 4);

    const partial = await seed({ accountId: accountA, resolved: true, recordStatus: "EXTRACTION_PARTIAL", reference: `PART-${stamp}`, amount: "31.00", description: "not a bank line" });
    await map(partial.runId);
    assert.equal((await disposition(partial.recordId)).outcome, "MAPPED");

    const pdf = await seed({ accountId: accountA, resolved: true, runStatus: "FAILED", runReason: "UNSUPPORTED_FILE_LAYOUT", reference: `PDF-${stamp}`, amount: "32.00" });
    const blocked = await api.query<{ result: { outcome: string } }>("SELECT ops.map_statement_extraction($1::uuid) AS result", [pdf.runId]);
    assert.equal(blocked.rows[0]?.result.outcome, "ineligible");
    const pdfSummary = await api.query<{ result: { ineligible_count: number; processing_failures: number } }>(
      "SELECT ops.statement_import_summary($1::uuid,$2::uuid,$3::uuid) AS result",
      [ownerA, actorIdA, pdf.batchId],
    );
    assert.equal(pdfSummary.rows[0]?.result.ineligible_count, 1);
    assert.equal(pdfSummary.rows[0]?.result.processing_failures, 1);

    const unscanned = await seed({ accountId: accountA, resolved: true, scanned: false, reference: `SCAN-${stamp}`, amount: "33.00" });
    const scanMap = await api.query<{ result: { outcome: string } }>("SELECT ops.map_statement_extraction($1::uuid) AS result", [unscanned.runId]);
    assert.equal(scanMap.rows[0]?.result.outcome, "ineligible");

    const rollbackRow = await seed({ resolved: false, reference: `RB-${stamp}`, amount: "29.00" });
    await map(rollbackRow.runId);
    const before = await admin.query<{ count: number }>("SELECT count(*)::int AS count FROM core.logical_transaction");
    await admin.query("BEGIN");
    await admin.query(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'select_account',1,$5::uuid,NULL,$6)",
      [actorIdA, ownerA, rollbackRow.batchId, rollbackRow.recordId, accountA, `rb-${stamp}`],
    );
    await admin.query("ROLLBACK");
    const after = await admin.query<{ count: number }>("SELECT count(*)::int AS count FROM core.logical_transaction");
    assert.equal(after.rows[0]?.count, before.rows[0]?.count);
    assert.equal((await disposition(rollbackRow.recordId)).outcome, "REVIEW_REQUIRED");

    const pending = await seed({ resolved: false, reference: `FIN-${stamp}`, amount: "30.00" });
    await map(pending.runId);
    const refused = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.finalize_statement_import($1::uuid,$2::uuid,$3::uuid,$4) AS result",
      [actorIdA, ownerA, pending.batchId, `fin-no-${stamp}`],
    );
    assert.equal(refused.rows[0]?.result.outcome, "review_pending");
    await api.query(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'reject',1,NULL,NULL,$5)",
      [actorIdA, ownerA, pending.batchId, pending.recordId, `fin-rej-${stamp}`],
    );
    const finalized = await api.query<{ result: { outcome: string; body: { import_finalized_at: string } } }>(
      "SELECT ops.finalize_statement_import($1::uuid,$2::uuid,$3::uuid,$4) AS result",
      [actorIdA, ownerA, pending.batchId, `fin-yes-${stamp}`],
    );
    assert.equal(finalized.rows[0]?.result.outcome, "ok");
    assert.ok(finalized.rows[0]?.result.body.import_finalized_at);

    const historical = await seed({ accountId: accountA, resolved: true, reference: `HIST-${stamp}`, amount: "34.00", description: "historical narration" });
    await admin.query(
      `INSERT INTO core.source_record_disposition (source_record_id, mapping_version, outcome, reason_codes)
       VALUES ($1, 'M2.5-v1', 'REVIEW_REQUIRED', ARRAY['WEAK_MATCH'])`,
      [historical.recordId],
    );
    await map(historical.runId);
    const versions = await admin.query<{ mapping_version: string; count: number }>(
      "SELECT mapping_version, count(*)::int AS count FROM core.source_record_disposition WHERE source_record_id = $1 GROUP BY mapping_version",
      [historical.recordId],
    );
    assert.equal(versions.rows.length, 1);
    assert.equal(versions.rows[0]?.mapping_version, "M2.5-v1");
    const kept = await admin.query<{ raw_description: string }>("SELECT raw_description FROM core.source_record WHERE source_record_id = $1", [historical.recordId]);
    assert.equal(kept.rows[0]?.raw_description, "historical narration");

    const deniedRole = await admin.query<{ allowed: boolean }>(
      "SELECT has_function_privilege('monytix_intelligence', 'ops.resolve_statement_review(uuid,uuid,uuid,uuid,text,integer,uuid,uuid,text)', 'EXECUTE') AS allowed",
    );
    assert.equal(deniedRole.rows[0]?.allowed, false);
    await admin.query("BEGIN");
    await admin.query("SET LOCAL ROLE monytix_api");
    await admin.query("SELECT set_config('app.owner_id', $1, true)", [ownerB]);
    const hidden = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM core.source_record_disposition WHERE source_record_id = $1",
      [first.recordId],
    );
    await admin.query("ROLLBACK");
    assert.equal(hidden.rows[0]?.count, 0);
  } finally {
    await admin.end();
    await api.end();
  }
});
