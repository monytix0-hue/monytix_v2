import { createHash } from "node:crypto";
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { importPKCS8, SignJWT } from "jose";
import pg from "pg";
import { CreateBucketCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const apiBase = process.env.E2E_API_BASE ?? "http://api:8080";
const adminUrl = process.env.E2E_ADMIN_URL ?? "postgres://monytix:monytix@postgres:5432/monytix";
const endpoint = process.env.E2E_S3_ENDPOINT ?? "http://minio:9000";
const bucket = process.env.E2E_S3_BUCKET ?? "statements";
const projectId = "monytix-test";
const privatePem = readFileSync("/keys/private.pem", "utf8");
const reportPath = process.env.E2E_REPORT_JSON ?? "/scripts/m28-e2e-result.json";
const historicalAccountId = "01a12b2d-3324-71e2-8fbd-4faf2ec90b2a";

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function request(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);
    const req = http.request(target, {
      method,
      headers: {
        ...(headers ?? {}),
        ...(payload ? { "content-length": String(payload.length) } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {
          json = null;
        }
        resolve({ status: response.statusCode ?? 0, json });
      });
    });
    req.on("error", reject);
    req.end(payload ?? undefined);
  });
}

async function api(method, path, token, ownerId, extraHeaders, body) {
  return request(method, `${apiBase}${path}`, {
    authorization: `Bearer ${token}`,
    "x-monytix-owner-id": ownerId,
    ...(body && !Buffer.isBuffer(body) ? { "content-type": "application/json" } : {}),
    ...(extraHeaders ?? {}),
  }, body ?? null);
}

function csv(rows) {
  return `description,txn_date,amount,direction\n${rows.join("\n")}\n`;
}

async function upload(token, ownerId, accountId, key, body) {
  const started = await api("POST", "/v1/imports", token, ownerId, { "idempotency-key": key }, JSON.stringify({
    file_type: "CSV",
    byte_size: Buffer.byteLength(body),
    sha256: sha(body),
    original_filename: "statement.csv",
    financial_account_id: accountId,
  }));
  const uploadGrant = started.json?.data?.upload;
  const importId = started.json?.data?.import_id ?? null;
  let putStatus = 0;
  if (uploadGrant?.url) {
    putStatus = (await request("PUT", uploadGrant.url, uploadGrant.headers ?? {}, Buffer.from(body))).status;
  }
  const completed = importId
    ? await api("POST", `/v1/imports/${importId}/complete`, token, ownerId)
    : { status: 0, json: null };
  return { started, putStatus, completed, importId };
}

async function waitForDocument(admin, importId) {
  let document = null;
  for (let attempt = 0; attempt < 24 && importId; attempt += 1) {
    const found = await admin.query(
      `SELECT source_document_id, status, reason_codes, metadata
         FROM core.source_document WHERE source_batch_id = $1`,
      [importId],
    );
    document = found.rows[0] ?? null;
    const extraction = document
      ? await admin.query("SELECT status FROM core.extraction_run WHERE source_document_id = $1", [document.source_document_id])
      : { rows: [] };
    if (document?.status === "AVAILABLE" && extraction.rows.length > 0) {
      return document;
    }
    if (document?.status === "REJECTED" || document?.status === "FAILED") {
      return document;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return document;
}

async function main() {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const historicalBefore = await admin.query(
    "SELECT logical_transaction_id FROM core.logical_transaction WHERE financial_account_id = $1 ORDER BY 1",
    [historicalAccountId],
  );
  const subject = `m28-e2e-${Date.now()}`;
  const actor = await admin.query("SELECT ops.provision_authenticated_actor($1, $2, $3) AS actor_id", ["firebase", subject, null]);
  const actorId = actor.rows[0].actor_id;
  const owner = await admin.query(
    "INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1) RETURNING owner_id",
    [subject],
  );
  const ownerId = owner.rows[0].owner_id;
  const otherOwner = await admin.query(
    "INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1) RETURNING owner_id",
    [`${subject}-other`],
  );
  const accounts = await admin.query(
    `INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
     VALUES ('SAVINGS', $1, 'INR', 'ACTIVE'), ('SAVINGS', $2, 'INR', 'ACTIVE')
     RETURNING financial_account_id`,
    [`e2e-${subject}`, `other-${subject}`],
  );
  const accountId = accounts.rows[0].financial_account_id;
  const otherAccountId = accounts.rows[1].financial_account_id;
  await admin.query(
    `INSERT INTO core.account_ownership (owner_id, financial_account_id, relationship_role, verification_state, relationship_status)
     VALUES ($1, $2, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE'), ($3, $4, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE')`,
    [ownerId, accountId, otherOwner.rows[0].owner_id, otherAccountId],
  );
  await admin.query(
    `INSERT INTO core.actor_owner_membership (actor_id, owner_id, membership_role, membership_status, is_default_owner)
     VALUES ($1, $2, 'OWNER', 'ACTIVE', true)`,
    [actorId, ownerId],
  );
  const privateKey = await importPKCS8(privatePem, "RS256");
  const token = await new SignJWT({ auth_time: Math.floor(Date.now() / 1000) })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject(subject)
    .setIssuer(`https://securetoken.google.com/${projectId}`)
    .setAudience(projectId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);

  const s3 = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: { accessKeyId: "minio", secretAccessKey: "minioadmin" },
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => undefined);

  const session = await api("GET", "/auth", token, ownerId);
  const duplicateNarration = "UPI-123456789012-RAVI-HDFC-XXXX1234-RENT";
  const distinctNarration = "UPI-987654321098-AMIT-HDFC-XXXX5678-FEES";
  const duplicateCsv = csv([
    `${duplicateNarration},2026-04-01,10.00,OUT`,
    `${duplicateNarration},2026-04-01,10.00,OUT`,
  ]);
  const distinctCsv = csv([`${distinctNarration},2026-04-03,25.00,OUT`]);
  const crossOwner = await api("POST", "/v1/imports", token, ownerId, { "idempotency-key": `cross-${subject}` }, JSON.stringify({
    file_type: "CSV",
    byte_size: Buffer.byteLength(duplicateCsv),
    sha256: sha(duplicateCsv),
    original_filename: "statement.csv",
    financial_account_id: otherAccountId,
  }));
  const imported = await upload(token, ownerId, accountId, `dup-${subject}`, duplicateCsv);
  const binding = imported.importId
    ? await admin.query(
      `SELECT si.financial_account_id, si.account_resolution_status
         FROM core.statement_instance si
         JOIN core.source_document sd ON sd.source_document_id = si.source_document_id
        WHERE sd.source_batch_id = $1`,
      [imported.importId],
    )
    : { rows: [] };
  const document = await waitForDocument(admin, imported.importId);
  const dispositions = imported.importId
    ? await admin.query(
      `SELECT d.outcome, s.extraction_sequence
         FROM core.source_record_disposition d
         JOIN core.source_record s ON s.source_record_id = d.source_record_id
         JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
         JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
        WHERE sd.source_batch_id = $1
        ORDER BY s.extraction_sequence`,
      [imported.importId],
    )
    : { rows: [] };
  const status = imported.importId ? await api("GET", `/v1/imports/${imported.importId}/status`, token, ownerId) : { status: 0, json: null };
  const reconciliation = status.json?.data?.reconciliation ?? null;
  const evidence = imported.importId
    ? await admin.query(
      `SELECT count(DISTINCT l.logical_transaction_id)::int AS logical_count,
              count(*)::int AS evidence_count
         FROM core.transaction_evidence_link l
         JOIN core.source_record s ON s.source_record_id = l.source_record_id
         JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
         JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
        WHERE sd.source_batch_id = $1`,
      [imported.importId],
    )
    : { rows: [{ logical_count: 0, evidence_count: 0 }] };
  const sealedKey = imported.importId ? `owners/${ownerId}/imports/${imported.importId}/object` : "";
  let hashMatches = false;
  if (sealedKey && document?.status === "AVAILABLE") {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: sealedKey }));
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    hashMatches = sha(bytes) === sha(duplicateCsv);
  }
  const anonymous = sealedKey ? await request("GET", `${endpoint}/${bucket}/${sealedKey}`) : { status: 0 };
  const distinct = await upload(token, ownerId, accountId, `distinct-${subject}`, distinctCsv);
  const distinctDocument = await waitForDocument(admin, distinct.importId);
  const distinctDisposition = distinct.importId
    ? await admin.query(
      `SELECT d.outcome, d.logical_transaction_id
         FROM core.source_record_disposition d
         JOIN core.source_record s ON s.source_record_id = d.source_record_id
         JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
         JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
        WHERE sd.source_batch_id = $1`,
      [distinct.importId],
    )
    : { rows: [] };
  const duplicateLogical = dispositions.rows.find((row) => row.outcome === "MAPPED")?.logical_transaction_id
    ?? (await admin.query(
      `SELECT d.logical_transaction_id
         FROM core.source_record_disposition d
         JOIN core.source_record s ON s.source_record_id = d.source_record_id
         JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
         JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
        WHERE sd.source_batch_id = $1 AND d.outcome = 'MAPPED'`,
      [imported.importId],
    )).rows[0]?.logical_transaction_id;
  const historicalAfter = await admin.query(
    "SELECT logical_transaction_id FROM core.logical_transaction WHERE financial_account_id = $1 ORDER BY 1",
    [historicalAccountId],
  );
  const passed = session.status === 200
    && crossOwner.status === 403
    && imported.started.status === 201
    && imported.putStatus === 200
    && imported.completed.status === 201
    && binding.rows[0]?.financial_account_id === accountId
    && binding.rows[0]?.account_resolution_status === "RESOLVED"
    && document?.status === "AVAILABLE"
    && hashMatches
    && anonymous.status === 403
    && dispositions.rows.map((row) => row.outcome).join(",") === "MAPPED,LINKED_EXISTING"
    && reconciliation?.mapped_count === 1
    && reconciliation?.linked_count === 1
    && reconciliation?.review_count === 0
    && evidence.rows[0]?.logical_count === 1
    && evidence.rows[0]?.evidence_count === 2
    && distinctDocument?.status === "AVAILABLE"
    && distinctDisposition.rows[0]?.outcome === "MAPPED"
    && distinctDisposition.rows[0]?.logical_transaction_id !== duplicateLogical
    && JSON.stringify(historicalBefore.rows) === JSON.stringify(historicalAfter.rows);

  const result = {
    passed,
    auth_http: session.status,
    cross_owner_http: crossOwner.status,
    authorize_http: imported.started.status,
    put_http: imported.putStatus,
    complete_http: imported.completed.status,
    bound_account: binding.rows[0]?.financial_account_id === accountId,
    document_status: document?.status ?? null,
    hash_matches: hashMatches,
    private_read_http: anonymous.status,
    outcomes: dispositions.rows.map((row) => row.outcome),
    mapped_count: reconciliation?.mapped_count ?? null,
    linked_count: reconciliation?.linked_count ?? null,
    review_count: reconciliation?.review_count ?? null,
    logical_count: evidence.rows[0]?.logical_count ?? null,
    evidence_count: evidence.rows[0]?.evidence_count ?? null,
    distinct_outcome: distinctDisposition.rows[0]?.outcome ?? null,
    distinct_not_merged: distinctDisposition.rows[0]?.logical_transaction_id !== duplicateLogical,
    historical_preserved: JSON.stringify(historicalBefore.rows) === JSON.stringify(historicalAfter.rows),
    import_id: imported.importId,
    distinct_import_id: distinct.importId,
    owner_id: ownerId,
    account_id: accountId,
  };
  writeFileSync(reportPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await admin.end();
  if (!passed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.log(`FATAL ${error instanceof Error ? error.message : "unknown"}`);
  process.exit(1);
});
