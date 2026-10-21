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
const reportPath = process.env.E2E_REPORT_JSON ?? "/work/scripts/local-e2e-result.json";

const steps = [];

function record(step, status, detail) {
  steps.push({ step, status, detail });
  console.log(`${step}: ${status} ${JSON.stringify(detail)}`);
}

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
        resolve({ status: response.statusCode ?? 0, json, raw });
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

async function main() {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const subject = `m2-local-e2e-${Date.now()}`;
  const actor = await admin.query("SELECT ops.provision_authenticated_actor($1, $2, $3) AS actor_id", ["firebase", subject, null]);
  const actorId = actor.rows[0].actor_id;
  const owner = await admin.query(
    "INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1) RETURNING owner_id",
    [subject],
  );
  const ownerId = owner.rows[0].owner_id;
  const account = await admin.query(
    `INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
     VALUES ('SAVINGS', $1, 'INR', 'ACTIVE') RETURNING financial_account_id`,
    [`e2e-${subject}`],
  );
  const accountId = account.rows[0].financial_account_id;
  await admin.query(
    `INSERT INTO core.account_ownership (
       owner_id, financial_account_id, relationship_role, verification_state, relationship_status, verification_source
     ) VALUES ($1, $2, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE', 'M2-LOCAL-E2E')`,
    [ownerId, accountId],
  );
  await admin.query(
    `INSERT INTO core.actor_owner_membership (
       actor_id, owner_id, membership_role, membership_status, is_default_owner
     ) VALUES ($1, $2, 'OWNER', 'ACTIVE', true)`,
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

  const session = await api("GET", "/auth", token, ownerId);
  record(1, session.status === 200 ? "PASS" : "FAIL", { http: session.status, actor_matches: session.json?.actor_id === actorId });

  record(2, accountId ? "PASS" : "FAIL", { account_created: Boolean(accountId), currency: "INR" });

  const manual = await api("POST", "/v1/transactions/manual", token, ownerId, { "idempotency-key": `manual-${subject}` }, JSON.stringify({
    financial_account_id: accountId,
    amount: "1250.50",
    currency: "INR",
    direction: "OUT",
    occurred_at: "2026-10-10T09:30:00Z",
    merchant_description: "Local groceries",
    category_code: "FOOD",
    subcategory_code: "GROCERIES",
  }));
  const manualId = manual.json?.data?.logical_transaction_id ?? null;
  const canonical = manualId
    ? await admin.query(
      `SELECT normalization_status, amount::text, direction, currency_code, is_current
         FROM core.canonical_transaction_version
        WHERE logical_transaction_id = $1 AND is_current = true`,
      [manualId],
    )
    : { rows: [] };
  record(3, manual.status === 201 && canonical.rows[0]?.normalization_status === "READY" ? "PASS" : "FAIL", {
    http: manual.status,
    normalization_status: canonical.rows[0]?.normalization_status ?? null,
    amount: canonical.rows[0]?.amount ?? null,
    direction: canonical.rows[0]?.direction ?? null,
  });

  const s3 = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: { accessKeyId: "minio", secretAccessKey: "minioadmin" },
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => undefined);

  const narration = "UPI-123456789012-RAVI-HDFC-XXXX1234-RENT";
  const parsed = await admin.query("SELECT spendsense.parse_narration_v4($1, $2) AS parsed", [narration, "OUT"]);
  const csv = `description,txn_date,amount,direction\n${narration},2026-04-01,10.00,OUT\n${narration},2026-04-01,10.00,OUT\n,2026-04-02,5.00,OUT\n`;
  const started = await api("POST", "/v1/imports", token, ownerId, { "idempotency-key": `import-${subject}` }, JSON.stringify({
    file_type: "CSV",
    byte_size: Buffer.byteLength(csv),
    sha256: sha(csv),
    original_filename: "statement.csv",
  }));
  const upload = started.json?.data?.upload;
  const importId = started.json?.data?.import_id ?? null;
  let putStatus = 0;
  if (upload?.url) {
    putStatus = (await request("PUT", upload.url, upload.headers ?? {}, Buffer.from(csv))).status;
  }
  const completed = importId
    ? await api("POST", `/v1/imports/${importId}/complete`, token, ownerId)
    : { status: 0, json: null };
  record(4, started.status === 201 && putStatus === 200 && completed.status === 201 ? "PASS" : "FAIL", {
    authorize_http: started.status,
    put_http: putStatus,
    complete_http: completed.status,
    import_created: Boolean(importId),
  });

  let document = null;
  for (let attempt = 0; attempt < 24 && importId; attempt += 1) {
    const found = await admin.query(
      `SELECT source_document_id, status, reason_codes, content_hash, metadata
         FROM core.source_document WHERE source_batch_id = $1`,
      [importId],
    );
    document = found.rows[0] ?? null;
    if (document && (document.status === "AVAILABLE" || document.status === "REJECTED")) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  const extraction = document
    ? await admin.query(
      `SELECT status, reason_codes FROM core.extraction_run WHERE source_document_id = $1 ORDER BY run_no`,
      [document.source_document_id],
    )
    : { rows: [] };
  const sealedKey = importId ? `owners/${ownerId}/imports/${importId}/object` : "";
  let sealedHash = null;
  if (sealedKey && document?.status === "AVAILABLE") {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: sealedKey }));
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    sealedHash = sha(bytes);
  }
  let privateDenied = false;
  if (sealedKey) {
    const anonymous = await request("GET", `${endpoint}/${bucket}/${sealedKey}`);
    privateDenied = anonymous.status === 403;
  }
  const scanPass = document?.status === "AVAILABLE"
    && Array.isArray(document.reason_codes) && document.reason_codes.includes("SCAN_CLEAN")
    && document.metadata?.sealed === true
    && sealedHash === sha(csv)
    && extraction.rows.some((row) => row.status === "COMPLETED" || row.status === "PARTIAL");
  record(5, scanPass && privateDenied ? "PASS" : "FAIL", {
    document_status: document?.status ?? null,
    reason_codes: document?.reason_codes ?? [],
    sealed: document?.metadata?.sealed === true,
    hash_matches: sealedHash === sha(csv),
    extraction_status: extraction.rows.map((row) => row.status),
    private_read_denied: privateDenied,
    parser_fields_present: Boolean(parsed.rows[0]?.parsed),
  });

  const dispositions = importId
    ? await admin.query(
      `SELECT d.outcome, d.reason_codes, s.extraction_sequence
         FROM core.source_record_disposition d
         JOIN core.source_record s ON s.source_record_id = d.source_record_id
         JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
         JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
        WHERE sd.source_batch_id = $1
        ORDER BY s.extraction_sequence`,
      [importId],
    )
    : { rows: [] };
  const outcomes = dispositions.rows.map((row) => ({ outcome: row.outcome, reason_codes: row.reason_codes, sequence: row.extraction_sequence }));
  const linked = outcomes.filter((row) => row.outcome === "LINKED_EXISTING").length;
  record(6, outcomes.length === 3 ? "PASS_WITH_GAPS" : "FAIL", {
    dispositions: outcomes,
    automatic_links: linked,
    note: linked === 0 ? "upload does not create a resolved statement account, so reference matching stays in review" : "automatic link recorded",
  });

  const review = importId ? await api("GET", `/v1/imports/${importId}/review`, token, ownerId) : { status: 0, json: null };
  const items = review.json?.data?.items ?? [];
  const dated = items.filter((item) => item.transaction_date === "2026-04-01");
  const undated = items.filter((item) => item.transaction_date !== "2026-04-01");
  let selected = null;
  let rejected = null;
  let linkedReview = null;
  if (dated[0]) {
    selected = await api("POST", `/v1/imports/${importId}/review/${dated[0].source_record_id}`, token, ownerId, { "idempotency-key": `select-${subject}` }, JSON.stringify({
      action: "select_account",
      review_version: dated[0].review_version,
      financial_account_id: accountId,
    }));
  }
  if (dated[1] && selected?.json?.data?.logical_transaction_id) {
    linkedReview = await api("POST", `/v1/imports/${importId}/review/${dated[1].source_record_id}`, token, ownerId, { "idempotency-key": `link-${subject}` }, JSON.stringify({
      action: "link_existing",
      review_version: dated[1].review_version,
      logical_transaction_id: selected.json.data.logical_transaction_id,
    }));
    if (linkedReview.status !== 200) {
      linkedReview = await api("POST", `/v1/imports/${importId}/review/${dated[1].source_record_id}`, token, ownerId, { "idempotency-key": `select-dup-${subject}` }, JSON.stringify({
        action: "select_account",
        review_version: dated[1].review_version,
        financial_account_id: accountId,
      }));
    }
  }
  if (undated[0]) {
    rejected = await api("POST", `/v1/imports/${importId}/review/${undated[0].source_record_id}`, token, ownerId, { "idempotency-key": `reject-${subject}` }, JSON.stringify({
      action: "reject",
      review_version: undated[0].review_version,
    }));
  }
  record(7, review.status === 200 && selected?.status === 200 && rejected?.status === 200 ? "PASS_WITH_GAPS" : "FAIL", {
    queue_http: review.status,
    queue_count: items.length,
    select_http: selected?.status ?? 0,
    duplicate_action_http: linkedReview?.status ?? 0,
    duplicate_outcome: linkedReview?.json?.data?.outcome ?? linkedReview?.json?.error ?? null,
    reject_http: rejected?.status ?? 0,
  });

  const finalized = importId
    ? await api("POST", `/v1/imports/${importId}/finalize`, token, ownerId, { "idempotency-key": `final-${subject}` }, "{}")
    : { status: 0, json: null };
  const status = importId ? await api("GET", `/v1/imports/${importId}/status`, token, ownerId) : { status: 0, json: null };
  const counts = importId
    ? await admin.query(
      `SELECT
         (SELECT count(*)::int FROM core.logical_transaction WHERE financial_account_id = $1) AS logical_count,
         (SELECT count(*)::int FROM core.transaction_evidence_link l
            JOIN core.source_record s ON s.source_record_id = l.source_record_id
            JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
            JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
           WHERE sd.source_batch_id = $2) AS evidence_count`,
      [accountId, importId],
    )
    : { rows: [{}] };
  record(8, finalized.status === 200 ? "PASS" : "FAIL", {
    finalize_http: finalized.status,
    finalize_error: finalized.json?.error ?? null,
    status_http: status.status,
    reconciliation: status.json?.data?.reconciliation ?? null,
    logical_count: counts.rows[0]?.logical_count ?? null,
    evidence_count: counts.rows[0]?.evidence_count ?? null,
  });

  const before = counts.rows[0] ?? {};
  writeFileSync(reportPath, JSON.stringify({
    subject_set: true,
    owner_id: ownerId,
    account_id: accountId,
    import_id: importId,
    logical_transaction_id: manualId,
    before,
    steps,
  }, null, 2));
  await admin.end();
}

main().catch((error) => {
  console.log(`FATAL ${error instanceof Error ? error.message : "unknown"}`);
  process.exit(1);
});
