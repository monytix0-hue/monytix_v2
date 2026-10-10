import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import test from "node:test";
import pg from "pg";
import { CreateBucketCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { buildApp } from "../src/app.js";
import { createPgIdentity } from "../src/auth/identity.js";
import { createImportStore } from "../src/imports/store.js";
import { createObjectStorage } from "../src/imports/storage.js";
import { runScanOnce, sweepRetention } from "../src/imports/scan.js";
import { signToken, testProjectId } from "./auth-fixture.js";

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;
const endpoint = process.env.M2_TEST_S3_ENDPOINT;
const bucket = process.env.M2_TEST_S3_BUCKET ?? "statements";
const accessKey = process.env.M2_TEST_S3_ACCESS_KEY ?? "minio";
const secretKey = process.env.M2_TEST_S3_SECRET ?? "minioadmin";
const clamHost = process.env.M2_TEST_CLAMAV_HOST;
const clamPort = Number(process.env.M2_TEST_CLAMAV_PORT ?? "3310");
const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function putObject(url: string, headers: Record<string, string>, body: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request(target, {
      method: "PUT",
      headers: { ...headers, "content-length": String(body.length) },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        if (status >= 300) {
          reject(new Error(`${status} ${Buffer.concat(chunks).toString("utf8")} url=${url}`));
          return;
        }
        resolve(status);
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("local statement upload seals a clean file, deletes EICAR, and expires abandoned grants", async (t) => {
  if (!databaseUrl || !adminUrl || !endpoint || !clamHost) {
    t.skip("local Postgres, MinIO, and ClamAV are not configured");
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const subject = `m23-${Date.now()}`;
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
  try {
    while (await runScanOnce(databaseUrl, storage, clamHost, clamPort)) {
      // Drain imports left by earlier runs so this test claims its own jobs.
    }
    const unavailableBody = "date,amount\nunscanned,1\n";
    const unavailable = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "idempotency-key": "scanner-down",
        "content-type": "application/json",
        "x-monytix-owner-id": ownerId,
      },
      payload: JSON.stringify({
        file_type: "CSV",
        byte_size: Buffer.byteLength(unavailableBody),
        sha256: sha(unavailableBody),
        original_filename: "unscanned.csv",
      }),
    });
    const unavailableCreated = unavailable.json() as { data: { import_id: string; upload: { url: string; headers: Record<string, string> } } };
    assert.equal(await putObject(unavailableCreated.data.upload.url, unavailableCreated.data.upload.headers, Buffer.from(unavailableBody)), 200);
    assert.equal((await app.inject({
      method: "POST",
      url: `/v1/imports/${unavailableCreated.data.import_id}/complete`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
    })).statusCode, 201);
    assert.equal(await runScanOnce(databaseUrl, storage, "127.0.0.1", 1), true);
    const blocked = await app.inject({
      method: "GET",
      url: `/v1/imports/${unavailableCreated.data.import_id}/status`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
    });
    assert.equal(blocked.json().data.upload_status, "RECEIVED");
    assert.equal(blocked.json().data.parser_eligible, false);

    const clean = "date,amount\n2026-01-01,1.00\n";
    const started = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "idempotency-key": "clean-1",
        "content-type": "application/json",
        "x-monytix-owner-id": ownerId,
      },
      payload: JSON.stringify({
        file_type: "CSV",
        byte_size: Buffer.byteLength(clean),
        sha256: sha(clean),
        original_filename: "january.csv",
      }),
    });
    assert.equal(started.statusCode, 201);
    const created = started.json() as { data: { import_id: string; upload: { url: string; headers: Record<string, string> } } };
    const put = await putObject(created.data.upload.url, created.data.upload.headers, Buffer.from(clean));
    assert.equal(put, 200);
    const completed = await app.inject({
      method: "POST",
      url: `/v1/imports/${created.data.import_id}/complete`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
    });
    assert.equal(completed.statusCode, 201);
    assert.equal(completed.json().data.upload_status, "RECEIVED");
    let cleanScanned = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ready = await admin.query<{ status: string }>(
        "SELECT status FROM core.source_document WHERE source_batch_id = $1",
        [created.data.import_id],
      );
      if (ready.rows[0]?.status === "AVAILABLE") {
        cleanScanned = true;
        break;
      }
      await runScanOnce(databaseUrl, storage, clamHost, clamPort);
    }
    assert.equal(cleanScanned, true);
    const status = await app.inject({
      method: "GET",
      url: `/v1/imports/${created.data.import_id}/status`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
    });
    assert.equal(status.json().data.parser_eligible, true);
    const rows = await admin.query(
      `SELECT count(*)::int AS count
       FROM core.extraction_run
       WHERE source_document_id IN (
         SELECT source_document_id FROM core.source_document WHERE source_batch_id = $1
       )`,
      [created.data.import_id],
    );
    assert.equal(rows.rows[0]?.count, 0);

    const infected = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "idempotency-key": "eicar-1",
        "content-type": "application/json",
        "x-monytix-owner-id": ownerId,
      },
      payload: JSON.stringify({
        file_type: "CSV",
        byte_size: Buffer.byteLength(eicar),
        sha256: sha(eicar),
        original_filename: "eicar.csv",
      }),
    });
    const infectedBody = infected.json() as { data: { import_id: string; upload: { url: string; headers: Record<string, string> } } };
    assert.equal(await putObject(infectedBody.data.upload.url, infectedBody.data.upload.headers, Buffer.from(eicar)), 200);
    const infectedCompleted = await app.inject({
      method: "POST",
      url: `/v1/imports/${infectedBody.data.import_id}/complete`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
    });
    assert.equal(infectedCompleted.statusCode, 201);
    let infectedScanned = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ready = await admin.query<{ status: string }>(
        "SELECT status FROM core.source_document WHERE source_batch_id = $1",
        [infectedBody.data.import_id],
      );
      if (ready.rows[0]?.status === "REJECTED") {
        infectedScanned = true;
        break;
      }
      await runScanOnce(databaseUrl, storage, clamHost, clamPort);
    }
    assert.equal(infectedScanned, true);
    const infectedStatus = await app.inject({
      method: "GET",
      url: `/v1/imports/${infectedBody.data.import_id}/status`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
    });
    assert.equal(infectedStatus.json().data.upload_status, "REJECTED");
    assert.equal(await storage.readObject(`owners/${ownerId}/imports/${infectedBody.data.import_id}/object`), null);

    assert.equal(await putObject(created.data.upload.url, created.data.upload.headers, Buffer.from("replaced,csv\n")), 200);
    const replay = await app.inject({
      method: "POST",
      url: `/v1/imports/${created.data.import_id}/complete`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
    });
    assert.equal(replay.statusCode, 201);
    const sealed = await storage.readObject(`owners/${ownerId}/imports/${created.data.import_id}/object`);
    assert.equal(sealed === null, false);
    assert.equal(createHash("sha256").update(sealed!.body).digest("hex"), sha(clean));

    const declared = "date,amount\n2026-01-01,1.00\n";
    const uploaded = "date,amount\n2026-01-02,9.00\n";
    assert.equal(Buffer.byteLength(declared), Buffer.byteLength(uploaded));
    const mismatch = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "idempotency-key": "checksum-1",
        "content-type": "application/json",
        "x-monytix-owner-id": ownerId,
      },
      payload: JSON.stringify({
        file_type: "CSV",
        byte_size: Buffer.byteLength(declared),
        sha256: sha(declared),
        original_filename: "mismatch.csv",
      }),
    });
    const mismatchBody = mismatch.json() as { data: { import_id: string; upload: { url: string; headers: Record<string, string> } } };
    assert.equal(await putObject(mismatchBody.data.upload.url, mismatchBody.data.upload.headers, Buffer.from(uploaded)), 200);
    const mismatchComplete = await app.inject({
      method: "POST",
      url: `/v1/imports/${mismatchBody.data.import_id}/complete`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
    });
    assert.equal(mismatchComplete.statusCode, 422);
    const mismatchStatus = await app.inject({
      method: "GET",
      url: `/v1/imports/${mismatchBody.data.import_id}/status`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
    });
    assert.equal(mismatchStatus.json().data.error_code, "CHECKSUM_MISMATCH");

    const concurrentBody = "date,amount\n2026-02-01,3.00\n";
    const concurrentStart = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "idempotency-key": "concurrent-1",
        "content-type": "application/json",
        "x-monytix-owner-id": ownerId,
      },
      payload: JSON.stringify({
        file_type: "CSV",
        byte_size: Buffer.byteLength(concurrentBody),
        sha256: sha(concurrentBody),
        original_filename: "concurrent.csv",
      }),
    });
    const concurrentCreated = concurrentStart.json() as { data: { import_id: string; upload: { url: string; headers: Record<string, string> } } };
    assert.equal(await putObject(concurrentCreated.data.upload.url, concurrentCreated.data.upload.headers, Buffer.from(concurrentBody)), 200);
    const [firstComplete, secondComplete] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/imports/${concurrentCreated.data.import_id}/complete`,
        headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
      }),
      app.inject({
        method: "POST",
        url: `/v1/imports/${concurrentCreated.data.import_id}/complete`,
        headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
      }),
    ]);
    assert.equal(firstComplete.statusCode, 201);
    assert.equal(secondComplete.statusCode, 201);
    const events = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ops.outbox_event
        WHERE semantic_trigger_code = 'IMPORT_SESSION_CREATED'
          AND event_payload->>'import_id' = $1`,
      [concurrentCreated.data.import_id],
    );
    assert.equal(events.rows[0]?.count, 1);

    const replayStart = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "idempotency-key": "concurrent-1",
        "content-type": "application/json",
        "x-monytix-owner-id": ownerId,
      },
      payload: JSON.stringify({
        file_type: "CSV",
        byte_size: Buffer.byteLength(concurrentBody),
        sha256: sha(concurrentBody),
        original_filename: "concurrent.csv",
      }),
    });
    assert.equal(replayStart.statusCode, 201);
    assert.equal(replayStart.json().data.import_id, concurrentCreated.data.import_id);
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "idempotency-key": "concurrent-1",
        "content-type": "application/json",
        "x-monytix-owner-id": ownerId,
      },
      payload: JSON.stringify({
        file_type: "CSV",
        byte_size: Buffer.byteLength("other,csv\n"),
        sha256: sha("other,csv\n"),
        original_filename: "other.csv",
      }),
    });
    assert.equal(conflict.statusCode, 409);

    const forbidden = await app.inject({
      method: "GET",
      url: `/v1/imports/${created.data.import_id}/status`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": "00000000-0000-7000-8000-000000000099" },
    });
    assert.equal(forbidden.statusCode, 403);

    const abandoned = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "idempotency-key": "abandon-1",
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
    const abandonedId = abandoned.json().data.import_id as string;
    await admin.query("UPDATE core.source_document SET created_at = now() - interval '25 hours' WHERE source_batch_id = $1", [abandonedId]);
    await sweepRetention(databaseUrl, storage, 24, 90);
    const abandonedStatus = await app.inject({
      method: "GET",
      url: `/v1/imports/${abandonedId}/status`,
      headers: { authorization: `Bearer ${signed.token}`, "x-monytix-owner-id": ownerId },
    });
    assert.equal(abandonedStatus.json().data.upload_status, "EXPIRED");
    const due = await admin.query<{ count: string }>("SELECT count(*)::text AS count FROM ops.retention_due_statements(90)");
    assert.equal(due.rows[0]?.count, "0");
    await assert.rejects(s3.send(new GetObjectCommand({ Bucket: bucket, Key: `owners/${ownerId}/imports/${abandonedId}/object` })));
    const denied = await admin.query(
      "SELECT has_function_privilege('monytix_intelligence', 'ops.authorize_statement_upload(uuid,uuid,text,text,bigint,text,text,jsonb)', 'EXECUTE') AS allowed",
    );
    assert.equal(denied.rows[0]?.allowed, false);
    assert.equal(testProjectId.length > 0, true);
  } finally {
    await app.close();
    await admin.end();
  }
});
