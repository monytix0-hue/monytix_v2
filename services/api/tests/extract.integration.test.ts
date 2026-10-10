import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import test from "node:test";
import pg from "pg";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { buildApp } from "../src/app.js";
import { createPgIdentity } from "../src/auth/identity.js";
import { readStatementCsv, runExtractOnce } from "../src/imports/extract.js";
import { createImportStore } from "../src/imports/store.js";
import { createObjectStorage } from "../src/imports/storage.js";
import { runScanOnce } from "../src/imports/scan.js";
import { signToken } from "./auth-fixture.js";

test("statement CSV framing requires a description column", () => {
  const rows = readStatementCsv("txn_date,amount,direction,description\n2026-01-02,10.00,OUT,UPI-1\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.description, "UPI-1");
  assert.throws(() => readStatementCsv("amount\n10\n"));
});

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

function putObject(url: string, headers: Record<string, string>, body: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request(target, { method: "PUT", headers: { ...headers, "content-length": String(body.length) } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("parser v4 adapter persists a clean CSV and rejects ineligible documents", async (t) => {
  if (!databaseUrl || !adminUrl || !endpoint || !clamHost) {
    t.skip("local Postgres, MinIO, and ClamAV are not configured");
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const subject = `m24-${Date.now()}`;
  const actor = await admin.query<{ provision_authenticated_actor: string }>(
    "SELECT ops.provision_authenticated_actor($1, $2, $3)",
    ["firebase", subject, null],
  );
  const owner = await admin.query<{ owner_id: string }>(
    "INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1) RETURNING owner_id",
    [subject],
  );
  const ownerId = owner.rows[0]!.owner_id;
  await admin.query(
    `INSERT INTO core.actor_owner_membership (actor_id, owner_id, membership_role, membership_status, is_default_owner)
     VALUES ($1, $2, 'OWNER', 'ACTIVE', true)`,
    [actor.rows[0]!.provision_authenticated_actor, ownerId],
  );
  const s3 = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => undefined);
  const signed = await signToken({ subject, expiresIn: "1h" });
  const storage = createObjectStorage({
    endpoint,
    region: "us-east-1",
    bucket,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
  });
  const app = await buildApp({
    logger: false,
    auth: signed.options.auth,
    identity: createPgIdentity(databaseUrl),
    imports: createImportStore(databaseUrl),
    objectStorage: storage,
  });
  const statement = "txn_date,amount,direction,description\n2026-01-02,10.00,OUT,UPI-123456789012-RAVI-HDFC-XXXX1234-RENT\n";
  try {
    const unknown = await admin.query<{ parsed: { parse_status: string; parse_error_reasons: string[] } }>(
      "SELECT spendsense.parse_narration_v4($1, $2) AS parsed",
      ["HELLO THERE THIS IS NOT A BANK LINE", "OUT"],
    );
    assert.equal(unknown.rows[0]?.parsed.parse_status, "PARTIAL");
    assert.equal(unknown.rows[0]?.parsed.parse_error_reasons.includes("NO_FORMAT_MATCH"), true);

    const started = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "idempotency-key": "parse-1",
        "content-type": "application/json",
        "x-monytix-owner-id": ownerId,
      },
      payload: JSON.stringify({
        file_type: "CSV",
        byte_size: Buffer.byteLength(statement),
        sha256: sha(statement),
        original_filename: "statement.csv",
      }),
    });
    assert.equal(started.statusCode, 201);
    const created = started.json() as { data: { import_id: string; upload: { url: string; headers: Record<string, string> } } };
    assert.equal(await putObject(created.data.upload.url, created.data.upload.headers, Buffer.from(statement)), 200);
    assert.equal((await app.inject({
      method: "POST",
      url: `/v1/imports/${created.data.import_id}/complete`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
    })).statusCode, 201);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const ready = await admin.query<{ status: string }>(
        "SELECT status FROM core.source_document WHERE source_batch_id = $1",
        [created.data.import_id],
      );
      if (ready.rows[0]?.status === "AVAILABLE") {
        break;
      }
      await runScanOnce(databaseUrl, storage, clamHost, clamPort);
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const found = await admin.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM core.extraction_run r
           JOIN core.source_document d ON d.source_document_id = r.source_document_id
          WHERE d.source_batch_id = $1`,
        [created.data.import_id],
      );
      if ((found.rows[0]?.count ?? 0) > 0) {
        break;
      }
      await runExtractOnce(databaseUrl, storage);
    }
    const extracted = await admin.query<{ status: string; raw_reference: string; record_status: string; version: string }>(
      `SELECT r.status, s.raw_reference, s.record_status, r.worker_metadata->>'parser_version' AS version
         FROM core.extraction_run r
         JOIN core.source_record s ON s.extraction_run_id = r.extraction_run_id
         JOIN core.source_document d ON d.source_document_id = r.source_document_id
        WHERE d.source_batch_id = $1`,
      [created.data.import_id],
    );
    assert.equal(extracted.rows[0]?.status, "COMPLETED");
    assert.equal(extracted.rows[0]?.raw_reference, "123456789012");
    assert.equal(extracted.rows[0]?.record_status, "TRANSACTION_CANDIDATE");
    assert.equal(extracted.rows[0]?.version, "v4");
    const evidence = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM core.transaction_evidence_link l
         JOIN core.source_record s ON s.source_record_id = l.source_record_id
         JOIN core.extraction_run r ON r.extraction_run_id = s.extraction_run_id
         JOIN core.source_document d ON d.source_document_id = r.source_document_id
        WHERE d.source_batch_id = $1`,
      [created.data.import_id],
    );
    assert.equal(evidence.rows[0]?.count, 0);
    const replay = await admin.query<{ result: { outcome: string } }>(
      `SELECT ops.save_statement_extraction(d.source_document_id, d.content_hash, '[]'::jsonb, NULL, NULL) AS result
         FROM core.source_document d WHERE d.source_batch_id = $1`,
      [created.data.import_id],
    );
    assert.equal(replay.rows[0]?.result.outcome, "replay");
    const runs = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM core.extraction_run r
         JOIN core.source_document d ON d.source_document_id = r.source_document_id
        WHERE d.source_batch_id = $1`,
      [created.data.import_id],
    );
    assert.equal(runs.rows[0]?.count, 1);

    const pdf = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n";
    const pdfStart = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "idempotency-key": "pdf-1",
        "content-type": "application/json",
        "x-monytix-owner-id": ownerId,
      },
      payload: JSON.stringify({
        file_type: "PDF",
        byte_size: Buffer.byteLength(pdf),
        sha256: sha(pdf),
        original_filename: "statement.pdf",
      }),
    });
    const pdfCreated = pdfStart.json() as { data: { import_id: string; upload: { url: string; headers: Record<string, string> } } };
    assert.equal(await putObject(pdfCreated.data.upload.url, pdfCreated.data.upload.headers, Buffer.from(pdf)), 200);
    await app.inject({
      method: "POST",
      url: `/v1/imports/${pdfCreated.data.import_id}/complete`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
    });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const ready = await admin.query<{ status: string }>("SELECT status FROM core.source_document WHERE source_batch_id = $1", [pdfCreated.data.import_id]);
      if (ready.rows[0]?.status === "AVAILABLE") break;
      await runScanOnce(databaseUrl, storage, clamHost, clamPort);
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const found = await admin.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM core.extraction_run r
           JOIN core.source_document d ON d.source_document_id = r.source_document_id
          WHERE d.source_batch_id = $1`,
        [pdfCreated.data.import_id],
      );
      if ((found.rows[0]?.count ?? 0) > 0) break;
      await runExtractOnce(databaseUrl, storage);
    }
    const pdfRun = await admin.query<{ status: string; reason: string }>(
      `SELECT r.status, r.reason_codes[1] AS reason
         FROM core.extraction_run r
         JOIN core.source_document d ON d.source_document_id = r.source_document_id
        WHERE d.source_batch_id = $1`,
      [pdfCreated.data.import_id],
    );
    assert.equal(pdfRun.rows[0]?.status, "FAILED");
    assert.equal(pdfRun.rows[0]?.reason, "UNSUPPORTED_FILE_LAYOUT");

    const open = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "idempotency-key": "unscanned-1",
        "content-type": "application/json",
        "x-monytix-owner-id": ownerId,
      },
      payload: JSON.stringify({
        file_type: "CSV",
        byte_size: 4,
        sha256: sha("wait"),
        original_filename: "wait.csv",
      }),
    });
    const openId = open.json().data.import_id as string;
    const blocked = await admin.query<{ result: { outcome: string } }>(
      `SELECT ops.enqueue_statement_extraction(source_document_id) AS result
         FROM core.source_document WHERE source_batch_id = $1`,
      [openId],
    );
    assert.equal(blocked.rows[0]?.result.outcome, "ineligible");
    const missingRoute = await app.inject({
      method: "POST",
      url: `/v1/imports/${created.data.import_id}/extract`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
    });
    assert.equal(missingRoute.statusCode, 404);
    const denied = await admin.query<{ allowed: boolean }>(
      "SELECT has_function_privilege('monytix_intelligence', 'ops.save_statement_extraction(uuid,text,jsonb,text,uuid)', 'EXECUTE') AS allowed",
    );
    assert.equal(denied.rows[0]?.allowed, false);
  } finally {
    await app.close();
    await admin.end();
  }
});
