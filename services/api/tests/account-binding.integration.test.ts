import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const historicalAccountId = "01a12b2d-3324-71e2-8fbd-4faf2ec90b2a";

test("M2.8 binds an owned account and reconciles strong duplicates", async (t) => {
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
    `SELECT logical_transaction_id
       FROM core.logical_transaction
      WHERE financial_account_id = $1
      ORDER BY logical_transaction_id`,
    [historicalAccountId],
  );
  try {
    const adapter = await admin.query<{ adapter_version_id: string }>(
      "SELECT adapter_version_id FROM ref.adapter_registry WHERE adapter_id = 'parser-v4' AND adapter_version = 'v4'",
    );
    const adapterId = adapter.rows[0]!.adapter_version_id;
    const actorA = await admin.query<{ provision_authenticated_actor: string }>(
      "SELECT ops.provision_authenticated_actor($1, $2, $3)",
      ["firebase", `m28-a-${stamp}`, null],
    );
    const actorB = await admin.query<{ provision_authenticated_actor: string }>(
      "SELECT ops.provision_authenticated_actor($1, $2, $3)",
      ["firebase", `m28-b-${stamp}`, null],
    );
    const actorIdA = actorA.rows[0]!.provision_authenticated_actor;
    const actorIdB = actorB.rows[0]!.provision_authenticated_actor;
    const owners = await admin.query<{ owner_id: string }>(
      "INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1), ('PERSON', $2) RETURNING owner_id",
      [`m28-a-${stamp}`, `m28-b-${stamp}`],
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

    function digest(value: string): string {
      return createHash("sha256").update(value).digest("hex");
    }

    async function authorize(ownerId: string, actorId: string, key: string, accountId: string | null) {
      const result = await api.query<{ result: { outcome: string; idempotency_record_id?: string; body?: { data?: { import_id?: string; source_document_id?: string; financial_account_id?: string } } } }>(
        `SELECT ops.authorize_statement_upload($1::uuid,$2::uuid,$3,'CSV',32,$4,$5,NULL,$6::uuid) AS result`,
        [actorId, ownerId, key, digest(key), `${key}.csv`, accountId],
      );
      return result.rows[0]!.result;
    }

    async function seed(input: {
      ownerId?: string;
      accountId?: string | null;
      currency?: string | null;
      rows: Array<{ amount?: string; date?: string | null; direction?: string; reference?: string | null; description?: string }>;
    }): Promise<{ batchId: string; documentId: string; runId: string; recordIds: string[] }> {
      const ownerId = input.ownerId ?? ownerA;
      const batch = await admin.query<{ source_batch_id: string }>(
        `INSERT INTO core.source_batch (owner_id, source_type, status) VALUES ($1, 'BANK_STATEMENT_CSV', 'COMPLETED') RETURNING source_batch_id`,
        [ownerId],
      );
      const document = await admin.query<{ source_document_id: string }>(
        `INSERT INTO core.source_document (source_batch_id, owner_id, content_hash, status, reason_codes, metadata)
         VALUES ($1, $2, $3, 'AVAILABLE', ARRAY['SCAN_CLEAN'], '{"sealed": true}'::jsonb)
         RETURNING source_document_id`,
        [batch.rows[0]!.source_batch_id, ownerId, digest(`${stamp}-${Math.random()}`)],
      );
      const documentId = document.rows[0]!.source_document_id;
      if (input.accountId) {
        await admin.query(
          `INSERT INTO core.statement_instance (source_document_id, financial_account_id, currency_code, account_resolution_status, statement_status)
           VALUES ($1, $2, $3, 'RESOLVED', 'PARTIAL')`,
          [documentId, input.accountId, input.currency === undefined ? "USD" : input.currency],
        );
      }
      const run = await admin.query<{ extraction_run_id: string }>(
        `INSERT INTO core.extraction_run (source_document_id, adapter_version_id, run_no, status, run_reason, completed_at)
         VALUES ($1, $2, 1, 'COMPLETED', 'INITIAL', clock_timestamp()) RETURNING extraction_run_id`,
        [documentId, adapterId],
      );
      const recordIds: string[] = [];
      for (let index = 0; index < input.rows.length; index += 1) {
        const row = input.rows[index]!;
        const inserted = await admin.query<{ source_record_id: string }>(
          `INSERT INTO core.source_record (
             extraction_run_id, extraction_sequence, raw_record_payload, raw_description, raw_transaction_date,
             raw_amount, raw_reference, record_status
           ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, 'TRANSACTION_CANDIDATE')
           RETURNING source_record_id`,
          [
            run.rows[0]!.extraction_run_id,
            index + 1,
            JSON.stringify({ direction: row.direction ?? "OUT", normalized_description: row.description ?? "statement row" }),
            row.description ?? "statement row",
            row.date === undefined ? "2026-05-01" : row.date,
            row.amount ?? "10.00",
            row.reference === undefined ? null : row.reference,
          ],
        );
        recordIds.push(inserted.rows[0]!.source_record_id);
      }
      return { batchId: batch.rows[0]!.source_batch_id, documentId, runId: run.rows[0]!.extraction_run_id, recordIds };
    }

    async function outcomes(recordIds: string[]): Promise<Array<{ outcome: string; reason: string | null; logical_transaction_id: string | null }>> {
      const rows = await admin.query<{ outcome: string; reason: string | null; logical_transaction_id: string | null; source_record_id: string }>(
        `SELECT source_record_id, outcome, reason_codes[1] AS reason, logical_transaction_id
           FROM core.source_record_disposition WHERE source_record_id = ANY($1::uuid[])`,
        [recordIds],
      );
      return recordIds.map((id) => rows.rows.find((row) => row.source_record_id === id)!);
    }

    async function logicalCount(accountId: string): Promise<number> {
      const count = await admin.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM core.logical_transaction WHERE financial_account_id = $1",
        [accountId],
      );
      return Number(count.rows[0]!.count);
    }

    const owned = await authorize(ownerA, actorIdA, `t01-${stamp}`, accountA);
    assert.equal(owned.outcome, "created", "T01");
    const ownedDocument = owned.body?.data?.source_document_id;
    const bound = await admin.query<{ financial_account_id: string; account_resolution_status: string }>(
      `SELECT financial_account_id, account_resolution_status FROM core.statement_instance WHERE source_document_id = $1`,
      [ownedDocument],
    );
    assert.equal(bound.rows.length, 1, "T01");
    assert.equal(bound.rows[0]?.financial_account_id, accountA, "T01");
    assert.equal(bound.rows[0]?.account_resolution_status, "RESOLVED", "T01");
    await api.query("SELECT ops.store_upload_grant($1::uuid,$2::uuid,$3::uuid,$4::jsonb)", [
      actorIdA,
      ownerA,
      owned.idempotency_record_id,
      JSON.stringify(owned.body),
    ]);

    const missing = await authorize(ownerA, actorIdA, `t02-${stamp}`, null);
    assert.equal(missing.outcome, "created", "T02");
    const missingInstances = await admin.query(
      "SELECT 1 FROM core.statement_instance WHERE source_document_id = $1",
      [missing.body?.data?.source_document_id],
    );
    assert.equal(missingInstances.rowCount, 0, "T02");
    await admin.query(
      `UPDATE core.source_document
          SET status = 'AVAILABLE', reason_codes = ARRAY['SCAN_CLEAN'], content_hash = $2, metadata = metadata || '{"sealed": true}'::jsonb
        WHERE source_document_id = $1`,
      [missing.body?.data?.source_document_id, digest(`t02-${stamp}`)],
    );
    const missingRun = await admin.query<{ extraction_run_id: string }>(
      `INSERT INTO core.extraction_run (source_document_id, adapter_version_id, run_no, status, run_reason, completed_at)
       VALUES ($1, $2, 1, 'COMPLETED', 'INITIAL', clock_timestamp()) RETURNING extraction_run_id`,
      [missing.body?.data?.source_document_id, adapterId],
    );
    const missingRecord = await admin.query<{ source_record_id: string }>(
      `INSERT INTO core.source_record (
         extraction_run_id, extraction_sequence, raw_record_payload, raw_description, raw_transaction_date, raw_amount, raw_reference, record_status
       ) VALUES ($1, 1, '{"direction":"OUT"}'::jsonb, 'row', '2026-05-01', '10.00', $2, 'TRANSACTION_CANDIDATE')
       RETURNING source_record_id`,
      [missingRun.rows[0]!.extraction_run_id, `T02-${stamp}`],
    );
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [missingRun.rows[0]!.extraction_run_id]);
    const missingOutcome = await outcomes([missingRecord.rows[0]!.source_record_id]);
    assert.equal(missingOutcome[0]?.outcome, "REVIEW_REQUIRED", "T02");
    assert.equal(missingOutcome[0]?.reason, "ACCOUNT_UNRESOLVED", "T02");

    const crossed = await authorize(ownerA, actorIdA, `t03-${stamp}`, accountB);
    assert.equal(crossed.outcome, "forbidden", "T03");
    const crossedDocs = await admin.query("SELECT 1 FROM core.source_document WHERE original_filename = $1", [`t03-${stamp}.csv`]);
    assert.equal(crossedDocs.rowCount, 0, "T03");

    const replay = await authorize(ownerA, actorIdA, `t01-${stamp}`, accountA);
    assert.equal(replay.outcome, "replay", "T05");
    assert.equal(replay.body?.data?.import_id, owned.body?.data?.import_id, "T05");
    const replayInstances = await admin.query(
      "SELECT count(*)::int AS count FROM core.statement_instance WHERE source_document_id = $1",
      [ownedDocument],
    );
    assert.equal(replayInstances.rows[0]?.count, 1, "T05");

    await admin.query(
      `UPDATE core.source_document
          SET status = 'AVAILABLE', reason_codes = ARRAY['SCAN_CLEAN'], content_hash = $2, metadata = metadata || '{"sealed": true}'::jsonb
        WHERE source_document_id = $1`,
      [ownedDocument, digest(`t04-${stamp}`)],
    );
    const extracted = await api.query<{ result: { outcome: string; extraction_run_id: string } }>(
      `SELECT ops.save_statement_extraction($1::uuid, $2, $3::jsonb, NULL, NULL) AS result`,
      [
        ownedDocument,
        digest(`t04-${stamp}`),
        JSON.stringify([{ parse_status: "PARSED", description: "owned row", txn_date: "2026-05-02", amount: "11.00", direction: "OUT", fields: { upi_rrn: `T04-${stamp}` } }]),
      ],
    );
    assert.equal(extracted.rows[0]?.result.outcome, "created", "T04");
    const extractedAgain = await api.query<{ result: { outcome: string } }>(
      `SELECT ops.save_statement_extraction($1::uuid, $2, '[]'::jsonb, NULL, NULL) AS result`,
      [ownedDocument, digest(`t04-${stamp}`)],
    );
    assert.equal(extractedAgain.rows[0]?.result.outcome, "replay", "T05");
    const stillBound = await admin.query<{ financial_account_id: string }>(
      "SELECT financial_account_id FROM core.statement_instance WHERE source_document_id = $1",
      [ownedDocument],
    );
    assert.equal(stillBound.rows[0]?.financial_account_id, accountA, "T04");
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [extracted.rows[0]!.result.extraction_run_id]);
    const firstMapped = await admin.query<{ outcome: string }>(
      `SELECT d.outcome FROM core.source_record_disposition d
         JOIN core.source_record s ON s.source_record_id = d.source_record_id
        WHERE s.extraction_run_id = $1`,
      [extracted.rows[0]!.result.extraction_run_id],
    );
    assert.equal(firstMapped.rows[0]?.outcome, "MAPPED", "T06");

    const duplicate = await seed({
      accountId: accountA,
      rows: [
        { reference: `T07-${stamp}`, amount: "12.00", date: "2026-05-03" },
        { reference: `T07-${stamp}`, amount: "12.00", date: "2026-05-03" },
      ],
    });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [duplicate.runId]);
    const duplicateOutcomes = await outcomes(duplicate.recordIds);
    assert.equal(duplicateOutcomes[0]?.outcome, "MAPPED", "T07");
    assert.equal(duplicateOutcomes[1]?.outcome, "LINKED_EXISTING", "T07");
    assert.equal(duplicateOutcomes[0]?.logical_transaction_id, duplicateOutcomes[1]?.logical_transaction_id, "T07");
    const duplicateEvidence = await admin.query<{ count: string; primary_count: string }>(
      `SELECT count(*)::text AS count,
              count(*) FILTER (WHERE is_primary_observation)::text AS primary_count
         FROM core.transaction_evidence_link
        WHERE logical_transaction_id = $1`,
      [duplicateOutcomes[0]!.logical_transaction_id],
    );
    assert.equal(duplicateEvidence.rows[0]?.count, "2", "T25");
    assert.equal(duplicateEvidence.rows[0]?.primary_count, "1", "T25");
    await assert.rejects(
      admin.query(
        `INSERT INTO core.transaction_evidence_link (
           logical_transaction_id, source_record_id, canonical_transaction_version_id,
           relationship_type, identity_confidence, is_primary_observation
         )
         SELECT logical_transaction_id, source_record_id, canonical_transaction_version_id,
                relationship_type, identity_confidence, is_primary_observation
           FROM core.transaction_evidence_link
          WHERE logical_transaction_id = $1
          LIMIT 1`,
        [duplicateOutcomes[0]!.logical_transaction_id],
      ),
      "T25",
    );

    const otherAccount = await seed({ accountId: accountA2, rows: [{ reference: `T08-${stamp}` }] });
    const sameAccount = await seed({ accountId: accountA, rows: [{ reference: `T08-${stamp}` }] });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [otherAccount.runId]);
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [sameAccount.runId]);
    const otherOutcomes = await outcomes([...otherAccount.recordIds, ...sameAccount.recordIds]);
    assert.equal(otherOutcomes[0]?.outcome, "MAPPED", "T08");
    assert.equal(otherOutcomes[1]?.outcome, "MAPPED", "T08");
    assert.notEqual(otherOutcomes[0]?.logical_transaction_id, otherOutcomes[1]?.logical_transaction_id, "T08");

    const differentAmount = await seed({
      accountId: accountA,
      rows: [{ reference: `T09-${stamp}`, amount: "13.00" }, { reference: `T09-${stamp}`, amount: "14.00" }],
    });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [differentAmount.runId]);
    const amountOutcomes = await outcomes(differentAmount.recordIds);
    assert.equal(amountOutcomes[0]?.outcome, "MAPPED", "T09");
    assert.equal(amountOutcomes[1]?.outcome, "REVIEW_REQUIRED", "T09");
    assert.equal(amountOutcomes[1]?.reason, "CONFLICTING_REFERENCE", "T09");

    const usd = await seed({ accountId: accountA, currency: "USD", rows: [{ reference: `T10-${stamp}`, amount: "15.00", date: "2026-05-04" }] });
    const eur = await seed({ accountId: accountA, currency: "EUR", rows: [{ reference: `T10-${stamp}`, amount: "15.00", date: "2026-05-04" }] });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [usd.runId]);
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [eur.runId]);
    const currencyOutcomes = await outcomes(eur.recordIds);
    assert.equal(currencyOutcomes[0]?.outcome, "REVIEW_REQUIRED", "T10");
    assert.equal(currencyOutcomes[0]?.reason, "CONFLICTING_REFERENCE", "T10");

    const otherDate = await seed({
      accountId: accountA,
      rows: [{ reference: `T11-${stamp}`, date: "2026-05-05" }, { reference: `T11-${stamp}`, date: "2026-05-06" }],
    });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [otherDate.runId]);
    const dateOutcomes = await outcomes(otherDate.recordIds);
    assert.equal(dateOutcomes[1]?.outcome, "REVIEW_REQUIRED", "T11");
    assert.equal(dateOutcomes[1]?.reason, "CONFLICTING_REFERENCE", "T11");

    const otherReference = await seed({
      accountId: accountA,
      rows: [
        { reference: `T12-A-${stamp}`, amount: "16.00", date: "2026-05-07" },
        { reference: `T12-B-${stamp}`, amount: "16.00", date: "2026-05-07" },
      ],
    });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [otherReference.runId]);
    const referenceOutcomes = await outcomes(otherReference.recordIds);
    assert.equal(referenceOutcomes[0]?.outcome, "MAPPED", "T12");
    assert.equal(referenceOutcomes[1]?.outcome, "MAPPED", "T12");
    assert.notEqual(referenceOutcomes[0]?.logical_transaction_id, referenceOutcomes[1]?.logical_transaction_id, "T12");

    const noReference = await seed({
      accountId: accountA,
      rows: [
        { reference: null, amount: "17.00", date: "2026-05-08" },
        { reference: null, amount: "17.00", date: "2026-05-08" },
      ],
    });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [noReference.runId]);
    const weakOutcomes = await outcomes(noReference.recordIds);
    assert.equal(weakOutcomes[0]?.outcome, "MAPPED", "T13");
    assert.equal(weakOutcomes[1]?.outcome, "REVIEW_REQUIRED", "T13");
    assert.equal(weakOutcomes[1]?.reason, "WEAK_MATCH", "T13");
    assert.equal(await logicalCount(accountA) > 0, true, "T13");

    const reviewPair = await seed({
      rows: [
        { reference: `T14-${stamp}`, amount: "18.00", date: "2026-05-09" },
        { reference: `T14-${stamp}`, amount: "18.00", date: "2026-05-09" },
      ],
    });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [reviewPair.runId]);
    const selected = await api.query<{ result: { outcome: string; body?: { outcome?: string; logical_transaction_id?: string } } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'select_account',1,$5::uuid,NULL,$6) AS result",
      [actorIdA, ownerA, reviewPair.batchId, reviewPair.recordIds[0], accountA, `t14-a-${stamp}`],
    );
    const selectedAgain = await api.query<{ result: { body?: { outcome?: string; logical_transaction_id?: string } } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'select_account',1,$5::uuid,NULL,$6) AS result",
      [actorIdA, ownerA, reviewPair.batchId, reviewPair.recordIds[1], accountA, `t14-b-${stamp}`],
    );
    assert.equal(selected.rows[0]?.result.body?.outcome, "MAPPED", "T14");
    assert.equal(selectedAgain.rows[0]?.result.body?.outcome, "LINKED_EXISTING", "T14");
    assert.equal(selected.rows[0]?.result.body?.logical_transaction_id, selectedAgain.rows[0]?.result.body?.logical_transaction_id, "T14");

    const confirmWeak = await api.query<{ result: { body?: { outcome?: string } } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'confirm_new',1,NULL,NULL,$5) AS result",
      [actorIdA, ownerA, noReference.batchId, noReference.recordIds[1], `t15-${stamp}`],
    );
    assert.equal(confirmWeak.rows[0]?.result.body?.outcome, "REVIEW_REQUIRED", "T15");
    const weakLogicals = await admin.query<{ count: string }>(
      `SELECT count(DISTINCT logical_transaction_id)::text AS count
         FROM core.source_record_disposition
        WHERE source_record_id = ANY($1::uuid[]) AND logical_transaction_id IS NOT NULL`,
      [noReference.recordIds],
    );
    assert.equal(weakLogicals.rows[0]?.count, "1", "T15");

    const concurrentSelect = await seed({
      rows: [
        { reference: `T16-${stamp}`, amount: "19.00", date: "2026-05-10" },
        { reference: `T16-${stamp}`, amount: "19.00", date: "2026-05-10" },
      ],
    });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [concurrentSelect.runId]);
    const concurrentSelectResults = await Promise.all([
      left.query<{ result: { body?: { outcome?: string } } }>(
        "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'select_account',1,$5::uuid,NULL,$6) AS result",
        [actorIdA, ownerA, concurrentSelect.batchId, concurrentSelect.recordIds[0], accountA, `t16-a-${stamp}`],
      ),
      right.query<{ result: { body?: { outcome?: string } } }>(
        "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'select_account',1,$5::uuid,NULL,$6) AS result",
        [actorIdA, ownerA, concurrentSelect.batchId, concurrentSelect.recordIds[1], accountA, `t16-b-${stamp}`],
      ),
    ]);
    const concurrentSelectOutcomes = concurrentSelectResults.map((result) => result.rows[0]?.result.body?.outcome).sort();
    assert.deepEqual(concurrentSelectOutcomes, ["LINKED_EXISTING", "MAPPED"], "T16");

    const concurrentConfirm = await seed({
      rows: [
        { reference: `T17-${stamp}`, amount: "20.00", date: "2026-05-11" },
        { reference: `T17-${stamp}`, amount: "20.00", date: "2026-05-11" },
      ],
    });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [concurrentConfirm.runId]);
    await admin.query(
      `INSERT INTO core.statement_instance (source_document_id, financial_account_id, currency_code, account_resolution_status, statement_status)
       VALUES ($1, $2, 'USD', 'RESOLVED', 'PARTIAL')`,
      [concurrentConfirm.documentId, accountA],
    );
    const concurrentConfirmResults = await Promise.all([
      left.query<{ result: { body?: { outcome?: string } } }>(
        "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'confirm_new',1,NULL,NULL,$5) AS result",
        [actorIdA, ownerA, concurrentConfirm.batchId, concurrentConfirm.recordIds[0], `t17-a-${stamp}`],
      ),
      right.query<{ result: { body?: { outcome?: string } } }>(
        "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'confirm_new',1,NULL,NULL,$5) AS result",
        [actorIdA, ownerA, concurrentConfirm.batchId, concurrentConfirm.recordIds[1], `t17-b-${stamp}`],
      ),
    ]);
    const concurrentConfirmOutcomes = concurrentConfirmResults.map((result) => result.rows[0]?.result.body?.outcome).sort();
    assert.deepEqual(concurrentConfirmOutcomes, ["LINKED_EXISTING", "MAPPED"], "T17");

    const replayReview = await api.query<{ result: { outcome: string; body?: { logical_transaction_id?: string } } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'select_account',1,$5::uuid,NULL,$6) AS result",
      [actorIdA, ownerA, reviewPair.batchId, reviewPair.recordIds[0], accountA, `t14-a-${stamp}`],
    );
    assert.equal(replayReview.rows[0]?.result.outcome, "replay", "T18");
    assert.equal(replayReview.rows[0]?.result.body?.logical_transaction_id, selected.rows[0]?.result.body?.logical_transaction_id, "T18");

    const stale = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'select_account',9,$5::uuid,NULL,$6) AS result",
      [actorIdA, ownerA, missing.body?.data?.import_id, missingRecord.rows[0]!.source_record_id, accountA, `t19-${stamp}`],
    );
    assert.equal(stale.rows[0]?.result.outcome, "stale", "T19");

    await assert.rejects(
      admin.query("UPDATE core.statement_instance SET financial_account_id = $2 WHERE source_document_id = $1", [duplicate.documentId, accountA2]),
      (error: { message?: string }) => (error.message ?? "").includes("already committed"),
      "T20",
    );

    const foreignSummary = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.statement_import_summary($1::uuid,$2::uuid,$3::uuid) AS result",
      [ownerA, actorIdB, duplicate.batchId],
    );
    assert.equal(foreignSummary.rows[0]?.result.outcome, "forbidden", "T21");
    const foreignLink = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'link_existing',1,NULL,$5::uuid,$6) AS result",
      [actorIdB, ownerB, duplicate.batchId, duplicate.recordIds[1], duplicateOutcomes[0]!.logical_transaction_id, `t22-${stamp}`],
    );
    assert.equal(foreignLink.rows[0]?.result.outcome, "forbidden", "T21");
    const unresolvedForLink = await seed({ accountId: accountA, rows: [{ reference: `T22-${stamp}`, amount: "21.00", date: "2026-05-12" }] });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [unresolvedForLink.runId]);
    const mappedForeign = await seed({ ownerId: ownerB, accountId: accountB, rows: [{ reference: `T22B-${stamp}`, amount: "21.00", date: "2026-05-12" }] });
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [mappedForeign.runId]);
    const foreignLogical = (await outcomes(mappedForeign.recordIds))[0]?.logical_transaction_id;
    const crossLink = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'reject',1,NULL,NULL,$5) AS result",
      [actorIdA, ownerA, unresolvedForLink.batchId, unresolvedForLink.recordIds[0], `t22-setup-${stamp}`],
    );
    assert.equal(crossLink.rows[0]?.result.outcome, "invalid", "T22 setup uses a mapped row");
    const crossOwnerLink = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,'link_existing',1,NULL,$5::uuid,$6) AS result",
      [actorIdA, ownerA, differentAmount.batchId, differentAmount.recordIds[1], foreignLogical, `t22-link-${stamp}`],
    );
    assert.equal(crossOwnerLink.rows[0]?.result.outcome, "forbidden", "T22");

    const historicalAfter = await admin.query<{ logical_transaction_id: string }>(
      `SELECT logical_transaction_id FROM core.logical_transaction WHERE financial_account_id = $1 ORDER BY logical_transaction_id`,
      [historicalAccountId],
    );
    assert.deepEqual(
      historicalAfter.rows.map((row) => row.logical_transaction_id),
      historicalBefore.rows.map((row) => row.logical_transaction_id),
      "T23",
    );
    const report = await admin.query<{ result: Array<{ duplicate_count: number }> }>(
      "SELECT ops.statement_strong_duplicate_report() AS result",
    );
    if (historicalBefore.rows.length > 0) {
      assert.equal(report.rows[0]?.result.some((row) => row.duplicate_count >= 2), true, "T23");
    }

    const summary = await api.query<{ result: { mapped_count: number; linked_count: number; review_count: number; total_source_records: number } }>(
      "SELECT ops.statement_import_summary($1::uuid,$2::uuid,$3::uuid) AS result",
      [ownerA, actorIdA, duplicate.batchId],
    );
    assert.equal(summary.rows[0]?.result.mapped_count, 1, "T24");
    assert.equal(summary.rows[0]?.result.linked_count, 1, "T24");
    assert.equal(summary.rows[0]?.result.review_count, 0, "T24");
    assert.equal(summary.rows[0]?.result.total_source_records, 2, "T24");

    const competing = await admin.query<{ txn_fact: string | null; txn_parsed: string | null; txn_parse_stage: string | null; txn_enriched: string | null }>(
      `SELECT to_regclass('spendsense.txn_fact')::text AS txn_fact,
              to_regclass('spendsense.txn_parsed')::text AS txn_parsed,
              to_regclass('spendsense.txn_parse_stage')::text AS txn_parse_stage,
              to_regclass('spendsense.txn_enriched')::text AS txn_enriched`,
    );
    assert.equal(competing.rows[0]?.txn_fact, null, "T28");
    assert.equal(competing.rows[0]?.txn_parsed, null, "T28");
    assert.equal(competing.rows[0]?.txn_parse_stage, null, "T28");
    assert.equal(competing.rows[0]?.txn_enriched, null, "T28");
  } finally {
    await admin.end();
    await api.end();
    await left.end();
    await right.end();
  }
});
