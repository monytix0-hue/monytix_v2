import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import test from "node:test";
import pg from "pg";
import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { buildApp } from "../src/app.js";
import { createPgIdentity } from "../src/auth/identity.js";
import { runExtractOnce } from "../src/imports/extract.js";
import { runScanOnce } from "../src/imports/scan.js";
import { createImportStore } from "../src/imports/store.js";
import { createObjectStorage } from "../src/imports/storage.js";
import { anonymousApp, signToken } from "./auth-fixture.js";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const endpoint = process.env.M2_TEST_S3_ENDPOINT;
const bucket = process.env.M2_TEST_S3_BUCKET ?? "statements";
const accessKey = process.env.M2_TEST_S3_ACCESS_KEY ?? "minio";
const secretKey = process.env.M2_TEST_S3_SECRET ?? "minioadmin";
const clamHost = process.env.M2_TEST_CLAMAV_HOST;
const clamPort = Number(process.env.M2_TEST_CLAMAV_PORT ?? "3310");

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function putSigned(url: string, headers: Record<string, string>, body: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request(target, {
      method: "PUT",
      headers: { ...headers, "content-length": String(body.length) },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end(body);
  });
}

function putUnsigned(url: string, body: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: "PUT", headers: { "content-length": String(body.length) } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("review routes reject a missing or invalid token", async () => {
  const missing = await anonymousApp();
  const missingResponse = await missing.inject({
    method: "POST",
    url: "/v1/imports/00000000-0000-0000-0000-000000000001/review/00000000-0000-0000-0000-000000000002",
    headers: { "idempotency-key": "missing", "content-type": "application/json" },
    payload: JSON.stringify({ action: "reject", review_version: 1 }),
  });
  assert.equal(missingResponse.statusCode, 401);
  await missing.close();

  const { token, options } = await signToken({ subject: "m27-invalid", expiresIn: "1h" });
  const invalid = await buildApp({ logger: false, auth: options.auth, identity: options.identity });
  const invalidResponse = await invalid.inject({
    method: "POST",
    url: "/v1/imports/00000000-0000-0000-0000-000000000001/review/00000000-0000-0000-0000-000000000002",
    headers: { authorization: "Bearer not-a-jwt", "idempotency-key": "invalid", "content-type": "application/json" },
    payload: JSON.stringify({ action: "reject", review_version: 1 }),
  });
  assert.equal(invalidResponse.statusCode, 401);
  await invalid.close();
  assert.ok(token);
});

test("import hardening keeps one canonical transaction across review, seal, and retry", async (t) => {
  if (!databaseUrl || !adminUrl || !endpoint || !clamHost) {
    t.skip("local Postgres, MinIO, and ClamAV are not configured");
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  const api = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  await api.connect();
  const stamp = Date.now().toString();
  const csv = "description,txn_date,amount,direction\nUPI-123456789012-RAVI-HDFC-XXXX1234-RENT,2026-04-01,10.00,OUT\n";
  const tamperCsv = "description,txn_date,amount,direction\nUPI-999999999999-RAVI-HDFC-XXXX1234-RENT,2026-04-02,11.00,OUT\n";
  try {
    const beforeHistorical = await admin.query<{ count: number; narration: string | null }>(
      `SELECT count(*)::int AS count,
              (SELECT s.raw_description FROM core.source_record_disposition d
                 JOIN core.source_record s ON s.source_record_id = d.source_record_id
                WHERE d.mapping_version = 'M2.5-v1' LIMIT 1) AS narration
         FROM core.source_record_disposition WHERE mapping_version = 'M2.5-v1'`,
    );
    const historicalCount = beforeHistorical.rows[0]!.count;
    const historicalNarration = beforeHistorical.rows[0]!.narration;

    const classification = await admin.query<{
      total: number; strong: number; insufficient: number; conflicting: number; unable: number;
    }>(`
      WITH linked AS (
        SELECT d.canonical_transaction_version_id IS NULL AS missing_version,
               NULLIF(btrim(coalesce(s.raw_amount, '')), '') AS raw_amount,
               NULLIF(btrim(coalesce(s.raw_transaction_date, '')), '') AS raw_date,
               NULLIF(btrim(coalesce(s.raw_reference, '')), '') AS raw_reference,
               NULLIF(upper(coalesce(s.raw_record_payload->>'direction', '')), '') AS raw_direction,
               c.amount::text AS canonical_amount,
               to_char(c.transaction_date, 'YYYY-MM-DD') AS canonical_date,
               btrim(c.currency_code) AS canonical_currency,
               c.direction AS canonical_direction,
               c.source_reference AS canonical_reference,
               c.financial_account_id AS canonical_account,
               lt.financial_account_id AS logical_account,
               btrim(coalesce(si.currency_code, fa.base_currency_code)::text) AS expected_currency
          FROM core.source_record_disposition d
          JOIN core.source_record s ON s.source_record_id = d.source_record_id
          LEFT JOIN core.canonical_transaction_version c ON c.canonical_transaction_version_id = d.canonical_transaction_version_id
          LEFT JOIN core.logical_transaction lt ON lt.logical_transaction_id = d.logical_transaction_id
          LEFT JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
          LEFT JOIN core.statement_instance si
            ON si.source_document_id = er.source_document_id
           AND si.financial_account_id = c.financial_account_id
           AND si.account_resolution_status = 'RESOLVED'
          LEFT JOIN core.financial_account fa ON fa.financial_account_id = c.financial_account_id
         WHERE d.mapping_version = 'M2.5-v1' AND d.outcome = 'LINKED_EXISTING'
      ), marked AS (
        SELECT CASE
          WHEN missing_version THEN 'unable'
          WHEN raw_amount IS NULL OR raw_date IS NULL OR raw_reference IS NULL OR raw_direction IS NULL OR expected_currency IS NULL THEN 'insufficient'
          WHEN raw_amount::numeric(20,4) IS DISTINCT FROM canonical_amount::numeric(20,4)
            OR raw_date IS DISTINCT FROM canonical_date
            OR raw_direction IS DISTINCT FROM canonical_direction
            OR raw_reference IS DISTINCT FROM canonical_reference
            OR expected_currency IS DISTINCT FROM canonical_currency
            OR canonical_account IS DISTINCT FROM logical_account THEN 'conflicting'
          ELSE 'strong'
        END AS klass
        FROM linked
      )
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE klass = 'strong')::int AS strong,
             count(*) FILTER (WHERE klass = 'insufficient')::int AS insufficient,
             count(*) FILTER (WHERE klass = 'conflicting')::int AS conflicting,
             count(*) FILTER (WHERE klass = 'unable')::int AS unable
        FROM marked
    `);
    const audit = classification.rows[0]!;
    assert.equal(audit.strong + audit.insufficient + audit.conflicting + audit.unable, audit.total);

    const actorA = await admin.query<{ provision_authenticated_actor: string }>(
      "SELECT ops.provision_authenticated_actor($1, $2, $3)",
      ["firebase", `m27-a-${stamp}`, null],
    );
    const actorB = await admin.query<{ provision_authenticated_actor: string }>(
      "SELECT ops.provision_authenticated_actor($1, $2, $3)",
      ["firebase", `m27-b-${stamp}`, null],
    );
    const owners = await admin.query<{ owner_id: string }>(
      "INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1), ('PERSON', $2) RETURNING owner_id",
      [`m27-a-${stamp}`, `m27-b-${stamp}`],
    );
    const ownerA = owners.rows[0]!.owner_id;
    const ownerB = owners.rows[1]!.owner_id;
    await admin.query(
      `INSERT INTO core.actor_owner_membership (actor_id, owner_id, membership_role, membership_status, is_default_owner)
       VALUES ($1, $2, 'OWNER', 'ACTIVE', true), ($3, $4, 'OWNER', 'ACTIVE', true)`,
      [actorA.rows[0]!.provision_authenticated_actor, ownerA, actorB.rows[0]!.provision_authenticated_actor, ownerB],
    );
    const accounts = await admin.query<{ financial_account_id: string }>(
      `INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code)
       VALUES ('SAVINGS', 'A', 'USD'), ('SAVINGS', 'B', 'USD') RETURNING financial_account_id`,
    );
    const accountA = accounts.rows[0]!.financial_account_id;
    const accountB = accounts.rows[1]!.financial_account_id;
    await admin.query(
      `INSERT INTO core.account_ownership (owner_id, financial_account_id, relationship_role, verification_state, relationship_status)
       VALUES ($1, $2, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE'), ($3, $4, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE')`,
      [ownerA, accountA, ownerB, accountB],
    );
    const institution = await admin.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'core' AND table_name = 'financial_account' AND column_name = 'institution_id'`,
    );
    assert.equal(institution.rows[0]?.is_nullable, "YES");

    const s3 = new S3Client({
      region: "us-east-1",
      endpoint,
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });
    await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => undefined);
    const signedA = await signToken({ subject: `m27-a-${stamp}`, expiresIn: "1h" });
    const signedB = await signToken({ subject: `m27-b-${stamp}`, expiresIn: "1h" });
    const storage = createObjectStorage({
      endpoint, region: "us-east-1", bucket, accessKeyId: accessKey, secretAccessKey: secretKey,
    });
    const app = await buildApp({
      logger: false,
      auth: signedA.options.auth,
      identity: createPgIdentity(databaseUrl),
      imports: createImportStore(databaseUrl),
      objectStorage: storage,
    });

    async function upload(body: string, key: string, ownerId: string, token: string): Promise<string> {
      const created = await app.inject({
        method: "POST",
        url: "/v1/imports",
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": key,
          "content-type": "application/json",
          "x-monytix-owner-id": ownerId,
        },
        payload: JSON.stringify({
          file_type: "CSV",
          byte_size: Buffer.byteLength(body),
          sha256: sha(body),
          original_filename: "statement.csv",
        }),
      });
      assert.equal(created.statusCode, 201);
      const data = created.json().data as { import_id: string; upload: { url: string; headers: Record<string, string> } };
      assert.equal(await putSigned(data.upload.url, data.upload.headers, Buffer.from(body)), 200);
      const completed = await app.inject({
        method: "POST",
        url: `/v1/imports/${data.import_id}/complete`,
        headers: { authorization: `Bearer ${token}`, "x-monytix-owner-id": ownerId },
      });
      assert.equal(completed.statusCode, 201);
      return data.import_id;
    }

    const goodId = await upload(csv, `good-${stamp}`, ownerA, signedA.token);
    const goodDoc = await admin.query<{ source_document_id: string; content_hash: string }>(
      "SELECT source_document_id, content_hash FROM core.source_document WHERE source_batch_id = $1",
      [goodId],
    );
    await admin.query(
      `INSERT INTO core.statement_instance (source_document_id, financial_account_id, currency_code, account_resolution_status, statement_status)
       VALUES ($1, $2, 'USD', 'RESOLVED', 'PARTIAL')`,
      [goodDoc.rows[0]!.source_document_id, accountA],
    );
    const tamperId = await upload(tamperCsv, `tamper-${stamp}`, ownerA, signedA.token);
    const tamperKey = `owners/${ownerA}/imports/${tamperId}/object`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: tamperKey, Body: Buffer.from("tampered-bytes") }));

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const pending = await admin.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM core.source_document
          WHERE source_batch_id = ANY($1::uuid[]) AND status <> 'AVAILABLE'`,
        [[goodId, tamperId]],
      );
      if (pending.rows[0]?.count === 0) break;
      await runScanOnce(databaseUrl, storage, clamHost, clamPort);
    }
    const sealed = await storage.readObject(`owners/${ownerA}/imports/${goodId}/object`);
    assert.equal(sha(sealed?.body.toString("utf8") ?? ""), sha(csv));
    assert.equal(goodDoc.rows[0]?.content_hash, sha(csv));
    const stagingUrl = endpoint.replace(/\/$/, "") + `/${bucket}/owners/${ownerA}/imports/${goodId}/staging`;
    assert.ok(await putUnsigned(stagingUrl, Buffer.from("overwrite")) >= 400);
    const sealedUrl = endpoint.replace(/\/$/, "") + `/${bucket}/${encodeURI(`owners/${ownerA}/imports/${goodId}/object`)}`;
    assert.ok(await putUnsigned(sealedUrl, Buffer.from("overwrite")) >= 400);
    const sealedAgain = await storage.readObject(`owners/${ownerA}/imports/${goodId}/object`);
    assert.equal(sha(sealedAgain?.body.toString("utf8") ?? ""), sha(csv));

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const ready = await admin.query<{ good: number; tamper: number }>(
        `SELECT
           count(*) FILTER (WHERE d.source_batch_id = $1 AND r.status = 'COMPLETED')::int AS good,
           count(*) FILTER (WHERE d.source_batch_id = $2 AND 'OBJECT_TAMPERED' = ANY (r.reason_codes))::int AS tamper
           FROM core.extraction_run r
           JOIN core.source_document d ON d.source_document_id = r.source_document_id
          WHERE d.source_batch_id = ANY($3::uuid[])`,
        [goodId, tamperId, [goodId, tamperId]],
      );
      if ((ready.rows[0]?.good ?? 0) > 0 && (ready.rows[0]?.tamper ?? 0) > 0) break;
      await runExtractOnce(databaseUrl, storage);
    }
    const goodRun = await admin.query<{ status: string; version: string; runs: number; logicals: number }>(
      `SELECT r.status, r.worker_metadata->>'parser_version' AS version,
              (SELECT count(*)::int FROM core.extraction_run er WHERE er.source_document_id = d.source_document_id AND er.adapter_version_id = r.adapter_version_id) AS runs,
              (SELECT count(DISTINCT disp.logical_transaction_id)::int
                 FROM core.source_record_disposition disp
                 JOIN core.source_record s ON s.source_record_id = disp.source_record_id
                 JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
                WHERE er.source_document_id = d.source_document_id AND disp.logical_transaction_id IS NOT NULL) AS logicals
         FROM core.source_document d
         JOIN core.extraction_run r ON r.source_document_id = d.source_document_id
        WHERE d.source_batch_id = $1
        ORDER BY r.run_no LIMIT 1`,
      [goodId],
    );
    assert.equal(goodRun.rows[0]?.status, "COMPLETED");
    assert.equal(goodRun.rows[0]?.version, "v4");
    assert.equal(goodRun.rows[0]?.runs, 1);
    assert.equal(goodRun.rows[0]?.logicals, 1);
    const tamperRun = await admin.query<{ count: number; logicals: number }>(
      `SELECT count(*) FILTER (WHERE 'OBJECT_TAMPERED' = ANY (r.reason_codes))::int AS count,
              count(disp.logical_transaction_id)::int AS logicals
         FROM core.source_document d
         LEFT JOIN core.extraction_run r ON r.source_document_id = d.source_document_id
         LEFT JOIN core.source_record s ON s.extraction_run_id = r.extraction_run_id
         LEFT JOIN core.source_record_disposition disp ON disp.source_record_id = s.source_record_id
        WHERE d.source_batch_id = $1`,
      [tamperId],
    );
    assert.equal(tamperRun.rows[0]?.count, 1);
    assert.equal(tamperRun.rows[0]?.logicals, 0);
    const due = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ops.retention_due_statements(90) q
         JOIN core.source_document d ON d.source_document_id = q.source_document_id
        WHERE d.source_batch_id = $1`,
      [goodId],
    );
    assert.equal(due.rows[0]?.count, 0);

    const firstVersion = await admin.query<{ canonical_transaction_version_id: string; raw_reference: string; raw_amount: string; raw_transaction_date: string }>(
      `SELECT c.canonical_transaction_version_id, s.raw_reference, s.raw_amount, s.raw_transaction_date
         FROM core.canonical_transaction_version c
         JOIN core.source_record s ON s.source_record_id = c.source_record_id
         JOIN core.extraction_run r ON r.extraction_run_id = s.extraction_run_id
         JOIN core.source_document d ON d.source_document_id = r.source_document_id
        WHERE d.source_batch_id = $1 AND c.is_current = true`,
      [goodId],
    );
    const adapter = await admin.query<{ adapter_version_id: string }>(
      `INSERT INTO ref.adapter_registry (adapter_id, adapter_version, source_type, layout_code, status, implementation_ref)
       VALUES ('parser-v4-test', 'test-only', 'BANK_STATEMENT_CSV', 'NARRATION_TEST', 'TESTING', 'test-only')
       ON CONFLICT (adapter_id, adapter_version) DO UPDATE SET status = 'TESTING'
       RETURNING adapter_version_id`,
    );
    const source = firstVersion.rows[0]!;
    const secondRow = JSON.stringify([{
      parse_status: "PARSED",
      direction: "OUT",
      amount: source.raw_amount,
      description: "UPI rent",
      txn_date: source.raw_transaction_date,
      fields: { upi_rrn: source.raw_reference },
      normalized_description: "UPI rent",
    }]);
    const saves = await Promise.all([
      api.query<{ result: { outcome: string } }>(
        "SELECT ops.save_statement_extraction($1::uuid, $2, $3::jsonb, NULL, $4::uuid) AS result",
        [goodDoc.rows[0]!.source_document_id, sha(csv), secondRow, adapter.rows[0]!.adapter_version_id],
      ),
      api.query<{ result: { outcome: string } }>(
        "SELECT ops.save_statement_extraction($1::uuid, $2, $3::jsonb, NULL, $4::uuid) AS result",
        [goodDoc.rows[0]!.source_document_id, sha(csv), secondRow, adapter.rows[0]!.adapter_version_id],
      ),
    ]);
    assert.deepEqual(saves.map((row) => row.rows[0]?.result.outcome).sort(), ["created", "replay"]);
    const replay = await api.query<{ result: { outcome: string } }>(
      "SELECT ops.save_statement_extraction($1::uuid, $2, $3::jsonb, NULL, $4::uuid) AS result",
      [goodDoc.rows[0]!.source_document_id, sha(csv), secondRow, adapter.rows[0]!.adapter_version_id],
    );
    assert.equal(replay.rows[0]?.result.outcome, "replay");
    const secondRun = await admin.query<{ extraction_run_id: string; version: string; reason: string }>(
      `SELECT extraction_run_id, worker_metadata->>'parser_version' AS version, run_reason AS reason
         FROM core.extraction_run
        WHERE source_document_id = $1 AND adapter_version_id = $2`,
      [goodDoc.rows[0]!.source_document_id, adapter.rows[0]!.adapter_version_id],
    );
    assert.equal(secondRun.rows[0]?.version, "test-only");
    assert.equal(secondRun.rows[0]?.reason, "ADAPTER_UPGRADE");
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [secondRun.rows[0]!.extraction_run_id]);
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [secondRun.rows[0]!.extraction_run_id]);
    const stillCurrent = await admin.query<{ canonical_transaction_version_id: string; logicals: number }>(
      `SELECT c.canonical_transaction_version_id,
              (SELECT count(DISTINCT logical_transaction_id)::int FROM core.canonical_transaction_version
                WHERE source_batch_id = c.source_batch_id AND is_current = true) AS logicals
         FROM core.canonical_transaction_version c
        WHERE c.canonical_transaction_version_id = $1 AND c.is_current = true`,
      [source.canonical_transaction_version_id],
    );
    assert.equal(stillCurrent.rows[0]?.canonical_transaction_version_id, source.canonical_transaction_version_id);
    assert.equal(stillCurrent.rows[0]?.logicals, 1);

    const logicalsBeforeCrash = await admin.query<{ count: number }>("SELECT count(*)::int AS count FROM core.logical_transaction");
    await admin.query("BEGIN");
    const crash = await admin.query<{ outbox_event_id: string }>(
      `INSERT INTO ops.outbox_event (owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key, status, next_attempt_at, created_at)
       VALUES ($1, 'STATEMENT_EXTRACTION_REQUESTED', 'source_document', $2, '{"source_document_id":null}'::jsonb, $3, 'FAILED', clock_timestamp() - interval '1 minute', '1970-01-01')
       RETURNING outbox_event_id`,
      [ownerA, goodDoc.rows[0]!.source_document_id, `statement-crash-${stamp}`],
    );
    const claimed = await admin.query<{ result: { outbox_event_id?: string } }>("SELECT ops.claim_statement_extraction() AS result");
    assert.equal(claimed.rows[0]?.result.outbox_event_id, crash.rows[0]!.outbox_event_id);
    const other = await admin.query<{ result: { outbox_event_id?: string } }>("SELECT ops.claim_statement_extraction() AS result");
    assert.notEqual(other.rows[0]?.result.outbox_event_id, crash.rows[0]!.outbox_event_id);
    await admin.query("UPDATE ops.outbox_event SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE outbox_event_id = $1", [crash.rows[0]!.outbox_event_id]);
    const reclaimed = await admin.query<{ result: { outbox_event_id?: string } }>("SELECT ops.claim_statement_extraction() AS result");
    assert.equal(reclaimed.rows[0]?.result.outbox_event_id, crash.rows[0]!.outbox_event_id);
    await admin.query("SELECT ops.finish_statement_extraction($1::uuid, false, 'worker crashed')", [crash.rows[0]!.outbox_event_id]);
    const failed = await admin.query<{ status: string }>("SELECT status FROM ops.outbox_event WHERE outbox_event_id = $1", [crash.rows[0]!.outbox_event_id]);
    assert.equal(failed.rows[0]?.status, "FAILED");
    await admin.query("ROLLBACK");
    const logicalsAfterCrash = await admin.query<{ count: number }>("SELECT count(*)::int AS count FROM core.logical_transaction");
    assert.equal(logicalsAfterCrash.rows[0]?.count, logicalsBeforeCrash.rows[0]?.count);

    async function seedReview(amount: string): Promise<{ batchId: string; recordId: string }> {
      const batch = await admin.query<{ source_batch_id: string }>(
        "INSERT INTO core.source_batch (owner_id, source_type, status) VALUES ($1, 'BANK_STATEMENT_CSV', 'COMPLETED') RETURNING source_batch_id",
        [ownerA],
      );
      const document = await admin.query<{ source_document_id: string }>(
        `INSERT INTO core.source_document (source_batch_id, owner_id, content_hash, status, reason_codes, metadata)
         VALUES ($1, $2, $3, 'AVAILABLE', ARRAY['SCAN_CLEAN'], '{"sealed":true}'::jsonb) RETURNING source_document_id`,
        [batch.rows[0]!.source_batch_id, ownerA, `hash-${stamp}-${amount}`],
      );
      const adapterV4 = await admin.query<{ adapter_version_id: string }>(
        "SELECT adapter_version_id FROM ref.adapter_registry WHERE adapter_id = 'parser-v4' AND adapter_version = 'v4'",
      );
      const run = await admin.query<{ extraction_run_id: string }>(
        `INSERT INTO core.extraction_run (source_document_id, adapter_version_id, run_no, status, run_reason, worker_metadata, completed_at)
         VALUES ($1, $2, 1, 'COMPLETED', 'INITIAL', '{"parser_version":"v4"}'::jsonb, clock_timestamp() + interval '1 second') RETURNING extraction_run_id`,
        [document.rows[0]!.source_document_id, adapterV4.rows[0]!.adapter_version_id],
      );
      const record = await admin.query<{ source_record_id: string }>(
        `INSERT INTO core.source_record (extraction_run_id, extraction_sequence, raw_record_payload, raw_description, raw_transaction_date, raw_amount, raw_reference, record_status)
         VALUES ($1, 1, '{"direction":"OUT"}'::jsonb, 'review narration', '2026-05-01', $2, $3, 'TRANSACTION_CANDIDATE') RETURNING source_record_id`,
        [run.rows[0]!.extraction_run_id, amount, `REV-${amount}-${stamp}`],
      );
      await api.query("SELECT ops.map_statement_extraction($1::uuid)", [run.rows[0]!.extraction_run_id]);
      return { batchId: batch.rows[0]!.source_batch_id, recordId: record.rows[0]!.source_record_id };
    }

    const review = await seedReview("51.00");
    const listed = await app.inject({
      method: "GET",
      url: `/v1/imports/${review.batchId}/review`,
      headers: { authorization: `Bearer ${signedA.token}`, "x-monytix-owner-id": ownerA },
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().data.items[0].review_version, 1);
    const resolved = await app.inject({
      method: "POST",
      url: `/v1/imports/${review.batchId}/review/${review.recordId}`,
      headers: {
        authorization: `Bearer ${signedA.token}`,
        "idempotency-key": `review-${stamp}`,
        "content-type": "application/json",
        "x-monytix-owner-id": ownerA,
      },
      payload: JSON.stringify({ action: "select_account", review_version: 1, financial_account_id: accountA }),
    });
    assert.equal(resolved.statusCode, 200);
    assert.equal(resolved.json().data.outcome, "MAPPED");
    const replayed = await app.inject({
      method: "POST",
      url: `/v1/imports/${review.batchId}/review/${review.recordId}`,
      headers: {
        authorization: `Bearer ${signedA.token}`,
        "idempotency-key": `review-${stamp}`,
        "content-type": "application/json",
        "x-monytix-owner-id": ownerA,
      },
      payload: JSON.stringify({ action: "select_account", review_version: 1, financial_account_id: accountA }),
    });
    assert.equal(replayed.statusCode, 200);
    assert.equal(replayed.json().data.logical_transaction_id, resolved.json().data.logical_transaction_id);
    const reviewEvents = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM ops.outbox_event WHERE semantic_trigger_code = 'STATEMENT_REVIEW_RESOLVED' AND aggregate_id = $1",
      [review.recordId],
    );
    assert.equal(reviewEvents.rows[0]?.count, 1);

    const hidden = await app.inject({
      method: "GET",
      url: `/v1/imports/${review.batchId}/review`,
      headers: { authorization: `Bearer ${signedB.token}`, "x-monytix-owner-id": ownerB },
    });
    assert.equal(hidden.statusCode, 403);
    const crossAccount = await seedReview("52.00");
    const deniedAccount = await app.inject({
      method: "POST",
      url: `/v1/imports/${crossAccount.batchId}/review/${crossAccount.recordId}`,
      headers: {
        authorization: `Bearer ${signedA.token}`,
        "idempotency-key": `xo-${stamp}`,
        "content-type": "application/json",
        "x-monytix-owner-id": ownerA,
      },
      payload: JSON.stringify({ action: "select_account", review_version: 1, financial_account_id: accountB }),
    });
    assert.equal(deniedAccount.statusCode, 403);
    const foreign = await admin.query<{ source_batch_id: string; extraction_run_id: string }>(
      `WITH batch AS (
         INSERT INTO core.source_batch (owner_id, source_type, status) VALUES ($1, 'BANK_STATEMENT_CSV', 'COMPLETED') RETURNING source_batch_id
       ), document AS (
         INSERT INTO core.source_document (source_batch_id, owner_id, content_hash, status, reason_codes, metadata)
         SELECT source_batch_id, $1, 'hash-b', 'AVAILABLE', ARRAY['SCAN_CLEAN'], '{"sealed":true}'::jsonb FROM batch RETURNING source_document_id, source_batch_id
       ), instance AS (
         INSERT INTO core.statement_instance (source_document_id, financial_account_id, currency_code, account_resolution_status, statement_status)
         SELECT source_document_id, $2, 'USD', 'RESOLVED', 'PARTIAL' FROM document RETURNING source_document_id
       )
       INSERT INTO core.extraction_run (source_document_id, adapter_version_id, run_no, status, run_reason, completed_at)
       SELECT d.source_document_id, a.adapter_version_id, 1, 'COMPLETED', 'INITIAL', clock_timestamp() + interval '1 second'
         FROM document d, ref.adapter_registry a
        WHERE a.adapter_id = 'parser-v4' AND a.adapter_version = 'v4'
       RETURNING extraction_run_id, (SELECT source_batch_id FROM document) AS source_batch_id`,
      [ownerB, accountB],
    );
    await admin.query(
      `INSERT INTO core.source_record (extraction_run_id, extraction_sequence, raw_record_payload, raw_description, raw_transaction_date, raw_amount, raw_reference, record_status)
       VALUES ($1, 1, '{"direction":"OUT"}'::jsonb, 'foreign', '2026-05-02', '61.00', $2, 'TRANSACTION_CANDIDATE')`,
      [foreign.rows[0]!.extraction_run_id, `FOR-${stamp}`],
    );
    await api.query("SELECT ops.map_statement_extraction($1::uuid)", [foreign.rows[0]!.extraction_run_id]);
    const foreignLogical = await admin.query<{ logical_transaction_id: string }>(
      `SELECT logical_transaction_id FROM core.canonical_transaction_version c
         JOIN core.source_record s ON s.source_record_id = c.source_record_id
        WHERE s.extraction_run_id = $1`,
      [foreign.rows[0]!.extraction_run_id],
    );
    const crossTxn = await seedReview("53.00");
    const deniedTxn = await app.inject({
      method: "POST",
      url: `/v1/imports/${crossTxn.batchId}/review/${crossTxn.recordId}`,
      headers: {
        authorization: `Bearer ${signedA.token}`,
        "idempotency-key": `xt-${stamp}`,
        "content-type": "application/json",
        "x-monytix-owner-id": ownerA,
      },
      payload: JSON.stringify({ action: "link_existing", review_version: 1, logical_transaction_id: foreignLogical.rows[0]!.logical_transaction_id }),
    });
    assert.equal(deniedTxn.statusCode, 403);

    const stale = await seedReview("54.00");
    const staleResponse = await app.inject({
      method: "POST",
      url: `/v1/imports/${stale.batchId}/review/${stale.recordId}`,
      headers: {
        authorization: `Bearer ${signedA.token}`,
        "idempotency-key": `stale-${stamp}`,
        "content-type": "application/json",
        "x-monytix-owner-id": ownerA,
      },
      payload: JSON.stringify({ action: "reject", review_version: 9 }),
    });
    assert.equal(staleResponse.statusCode, 409);
    const staleRow = await admin.query<{ review_version: number; outcome: string }>(
      "SELECT review_version, outcome FROM core.source_record_disposition WHERE source_record_id = $1",
      [stale.recordId],
    );
    assert.equal(staleRow.rows[0]?.review_version, 1);
    assert.equal(staleRow.rows[0]?.outcome, "REVIEW_REQUIRED");

    const concurrent = await seedReview("55.00");
    const pair = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/imports/${concurrent.batchId}/review/${concurrent.recordId}`,
        headers: {
          authorization: `Bearer ${signedA.token}`,
          "idempotency-key": `con-a-${stamp}`,
          "content-type": "application/json",
          "x-monytix-owner-id": ownerA,
        },
        payload: JSON.stringify({ action: "select_account", review_version: 1, financial_account_id: accountA }),
      }),
      app.inject({
        method: "POST",
        url: `/v1/imports/${concurrent.batchId}/review/${concurrent.recordId}`,
        headers: {
          authorization: `Bearer ${signedA.token}`,
          "idempotency-key": `con-b-${stamp}`,
          "content-type": "application/json",
          "x-monytix-owner-id": ownerA,
        },
        payload: JSON.stringify({ action: "select_account", review_version: 1, financial_account_id: accountA }),
      }),
    ]);
    assert.deepEqual(pair.map((response) => response.statusCode).sort(), [200, 409]);
    const concurrentLinks = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM core.transaction_evidence_link WHERE source_record_id = $1 AND relationship_type = 'PRIMARY_VERSION_SOURCE'",
      [concurrent.recordId],
    );
    assert.equal(concurrentLinks.rows[0]?.count, 1);

    const pending = await seedReview("56.00");
    const refused = await app.inject({
      method: "POST",
      url: `/v1/imports/${pending.batchId}/finalize`,
      headers: {
        authorization: `Bearer ${signedA.token}`,
        "idempotency-key": `fin-no-${stamp}`,
        "x-monytix-owner-id": ownerA,
      },
    });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error, "review_pending");
    await app.inject({
      method: "POST",
      url: `/v1/imports/${pending.batchId}/review/${pending.recordId}`,
      headers: {
        authorization: `Bearer ${signedA.token}`,
        "idempotency-key": `fin-rej-${stamp}`,
        "content-type": "application/json",
        "x-monytix-owner-id": ownerA,
      },
      payload: JSON.stringify({ action: "reject", review_version: 1 }),
    });
    const finals = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/imports/${pending.batchId}/finalize`,
        headers: { authorization: `Bearer ${signedA.token}`, "idempotency-key": `fin-a-${stamp}`, "x-monytix-owner-id": ownerA },
      }),
      app.inject({
        method: "POST",
        url: `/v1/imports/${pending.batchId}/finalize`,
        headers: { authorization: `Bearer ${signedA.token}`, "idempotency-key": `fin-b-${stamp}`, "x-monytix-owner-id": ownerA },
      }),
    ]);
    assert.ok(finals.every((response) => response.statusCode === 200));
    const finalized = await admin.query<{ stamps: number }>(
      "SELECT count(DISTINCT metadata->>'import_finalized_at')::int AS stamps FROM core.source_batch WHERE source_batch_id = $1",
      [pending.batchId],
    );
    assert.equal(finalized.rows[0]?.stamps, 1);

    await admin.query("BEGIN");
    await admin.query("SET LOCAL ROLE monytix_api");
    await admin.query("SELECT set_config('app.owner_id', $1, true)", [ownerB]);
    const isolated = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM core.source_record_disposition WHERE source_record_id = $1",
      [review.recordId],
    );
    await admin.query("ROLLBACK");
    assert.equal(isolated.rows[0]?.count, 0);

    const afterHistorical = await admin.query<{ count: number; narration: string | null }>(
      `SELECT count(*)::int AS count,
              (SELECT s.raw_description FROM core.source_record_disposition d
                 JOIN core.source_record s ON s.source_record_id = d.source_record_id
                WHERE d.mapping_version = 'M2.5-v1' AND s.raw_description = $1 LIMIT 1) AS narration
         FROM core.source_record_disposition WHERE mapping_version = 'M2.5-v1'`,
      [historicalNarration],
    );
    assert.equal(afterHistorical.rows[0]?.count, historicalCount);
    if (historicalNarration) {
      assert.equal(afterHistorical.rows[0]?.narration, historicalNarration);
    }
    assert.equal(process.env.OBJECT_STORAGE_ACCESS_KEY_ID ?? "", "");
    assert.equal(process.env.PRODUCTION_CLAMAV_HOST ?? "", "");
  } finally {
    await admin.end();
    await api.end();
  }
});
