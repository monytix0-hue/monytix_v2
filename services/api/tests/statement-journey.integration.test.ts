import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import test from "node:test";
import pg from "pg";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { buildApp } from "../src/app.js";
import { createPgIdentity } from "../src/auth/identity.js";
import { runExtractOnce } from "../src/imports/extract.js";
import { runScanOnce } from "../src/imports/scan.js";
import { createImportStore } from "../src/imports/store.js";
import { createObjectStorage } from "../src/imports/storage.js";
import { createLedgerRead } from "../src/ledger/read.js";
import { signToken } from "./auth-fixture.js";

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
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("a scanned CSV reaches the ledger reads without a second copy or a fabricated balance", async (t) => {
  if (!databaseUrl || !adminUrl || !endpoint || !clamHost) {
    t.skip("local Postgres, MinIO, and ClamAV are not configured");
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const stamp = Date.now().toString();
  const statement = [
    "txn_date,amount,direction,description",
    "2026-10-02,25.00,IN,UPI-111111111111-BANK-HDFC-XXXX1234-INTEREST CREDIT",
    "2026-10-03,40.00,OUT,UPI-222222222222-RAVI-HDFC-XXXX1234-EMI",
    "2026-10-04,15.00,OUT,UPI-333333333333-RAVI-HDFC-XXXX1234-CC PAYMENT",
    "",
  ].join("\n");
  const duplicate = [
    "txn_date,amount,direction,description",
    "2026-10-03,40.00,OUT,UPI-222222222222-RAVI-HDFC-XXXX1234-EMI",
    "",
  ].join("\n");
  try {
    const actorA = (await admin.query<{ provision_authenticated_actor: string }>(
      "SELECT ops.provision_authenticated_actor($1, $2, $3)",
      ["firebase", `journey-a-${stamp}`, null],
    )).rows[0]!.provision_authenticated_actor;
    const actorB = (await admin.query<{ provision_authenticated_actor: string }>(
      "SELECT ops.provision_authenticated_actor($1, $2, $3)",
      ["firebase", `journey-b-${stamp}`, null],
    )).rows[0]!.provision_authenticated_actor;
    const owners = await admin.query<{ owner_id: string }>(
      `INSERT INTO core.owner (owner_type, display_name)
       VALUES ('PERSON', $1), ('PERSON', $2), ('BUSINESS', $3), ('BUSINESS', $4)
       RETURNING owner_id`,
      [`journey-a-${stamp}`, `journey-b-${stamp}`, `journey-biz-${stamp}`, `journey-denied-${stamp}`],
    );
    const ownerA = owners.rows[0]!.owner_id;
    const ownerB = owners.rows[1]!.owner_id;
    const business = owners.rows[2]!.owner_id;
    const denied = owners.rows[3]!.owner_id;
    await admin.query(
      `INSERT INTO core.actor_owner_membership (actor_id, owner_id, membership_role, membership_status, is_default_owner)
       VALUES ($1, $2, 'OWNER', 'ACTIVE', true),
              ($1, $3, 'OWNER', 'ACTIVE', false),
              ($4, $5, 'OWNER', 'ACTIVE', true)`,
      [actorA, ownerA, business, actorB, ownerB],
    );
    const accounts = await admin.query<{ financial_account_id: string }>(
      `INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
       VALUES ('SAVINGS', $1, 'INR', 'ACTIVE'), ('SAVINGS', $2, 'USD', 'ACTIVE'), ('SAVINGS', $3, 'INR', 'ACTIVE')
       RETURNING financial_account_id`,
      [`INR ${stamp}`, `USD ${stamp}`, `Other ${stamp}`],
    );
    const accountA = accounts.rows[0]!.financial_account_id;
    const accountUsd = accounts.rows[1]!.financial_account_id;
    const accountB = accounts.rows[2]!.financial_account_id;
    await admin.query(
      `INSERT INTO core.account_ownership (owner_id, financial_account_id, relationship_role, verification_state, relationship_status)
       VALUES ($1, $2, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE'),
              ($1, $3, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE'),
              ($4, $5, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE')`,
      [ownerA, accountA, accountUsd, ownerB, accountB],
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
    const signedA = await signToken({ subject: `journey-a-${stamp}`, expiresIn: "1h" });
    const signedB = await signToken({ subject: `journey-b-${stamp}`, expiresIn: "1h" });
    const storage = createObjectStorage({
      endpoint,
      region: "us-east-1",
      bucket,
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    });
    const app = await buildApp({
      logger: false,
      auth: signedA.options.auth,
      identity: createPgIdentity(databaseUrl),
      imports: createImportStore(databaseUrl),
      objectStorage: storage,
      ledger: createLedgerRead(databaseUrl),
    });
    const headers = (token: string, ownerId: string, key?: string) => ({
      authorization: `Bearer ${token}`,
      "x-monytix-owner-id": ownerId,
      ...(key ? { "idempotency-key": key, "content-type": "application/json" } : {}),
    });

    async function upload(body: string, key: string, ownerId: string, token: string, accountId?: string) {
      const started = await app.inject({
        method: "POST",
        url: "/v1/imports",
        headers: headers(token, ownerId, key),
        payload: JSON.stringify({
          file_type: "CSV",
          byte_size: Buffer.byteLength(body),
          sha256: sha(body),
          original_filename: `${key}.csv`,
          ...(accountId ? { financial_account_id: accountId } : {}),
        }),
      });
      assert.equal(started.statusCode, 201, started.body);
      const created = started.json() as {
        data: { import_id: string; upload: { url: string; headers: Record<string, string>; expires_at: string } };
      };
      const expires = Date.parse(created.data.upload.expires_at);
      assert.equal(expires > Date.now(), true);
      assert.equal(expires < Date.now() + 20 * 60 * 1000, true);
      assert.equal(await putObject(created.data.upload.url, created.data.upload.headers, Buffer.from(body)), 200);
      const completed = await app.inject({
        method: "POST",
        url: `/v1/imports/${created.data.import_id}/complete`,
        headers: headers(token, ownerId),
      });
      assert.equal(completed.statusCode, 201, completed.body);
      return created.data.import_id;
    }

    async function until(read: () => Promise<boolean>) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (await read()) {
          return;
        }
        await runScanOnce(databaseUrl!, storage, clamHost!, clamPort);
        await runExtractOnce(databaseUrl!, storage);
      }
      assert.fail("import did not finish");
    }

    const health = await app.inject({ method: "GET", url: "/platform/health" });
    assert.equal(health.statusCode, 200);

    const importId = await upload(statement, `journey-${stamp}`, ownerA, signedA.token);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: headers(signedA.token, ownerA, `journey-${stamp}`),
      payload: JSON.stringify({
        file_type: "CSV",
        byte_size: Buffer.byteLength(statement),
        sha256: sha(statement),
        original_filename: `journey-${stamp}.csv`,
      }),
    });
    assert.equal(replay.statusCode, 201);
    assert.equal(replay.json().data.import_id, importId);

    const otherStatus = await app.inject({
      method: "GET",
      url: `/v1/imports/${importId}/status`,
      headers: headers(signedB.token, ownerB),
    });
    assert.equal(otherStatus.statusCode, 403);
    const otherReview = await app.inject({
      method: "GET",
      url: `/v1/imports/${importId}/review`,
      headers: headers(signedB.token, ownerB),
    });
    assert.equal(otherReview.statusCode, 403);

    await until(async () => {
      const ready = await admin.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM core.source_record s
           JOIN core.extraction_run r ON r.extraction_run_id = s.extraction_run_id
           JOIN core.source_document d ON d.source_document_id = r.source_document_id
          WHERE d.source_batch_id = $1`,
        [importId],
      );
      return (ready.rows[0]?.count ?? 0) === 3;
    });

    const preview = await app.inject({
      method: "GET",
      url: `/v1/imports/${importId}/review`,
      headers: headers(signedA.token, ownerA),
    });
    assert.equal(preview.statusCode, 200);
    const items = preview.json().data.items as Array<{ source_record_id: string; review_version: number; outcome: string; reason_codes: string[]; amount: string }>;
    assert.equal(items.length, 3);
    assert.equal(items.every((item) => item.outcome === "REVIEW_REQUIRED" && item.reason_codes.includes("ACCOUNT_UNRESOLVED")), true);

    const income = items.find((item) => item.amount.startsWith("25"))!;
    const loan = items.find((item) => item.amount.startsWith("40"))!;
    const card = items.find((item) => item.amount.startsWith("15"))!;
    const crossAccount = await app.inject({
      method: "POST",
      url: `/v1/imports/${importId}/review/${income.source_record_id}`,
      headers: headers(signedA.token, ownerA, `cross-${stamp}`),
      payload: JSON.stringify({ action: "select_account", review_version: income.review_version, financial_account_id: accountB }),
    });
    assert.equal(crossAccount.statusCode, 403);
    const bound = await app.inject({
      method: "POST",
      url: `/v1/imports/${importId}/review/${income.source_record_id}`,
      headers: headers(signedA.token, ownerA, `bind-${stamp}`),
      payload: JSON.stringify({ action: "select_account", review_version: income.review_version, financial_account_id: accountA }),
    });
    assert.equal(bound.statusCode, 200, bound.body);
    for (const item of [loan, card]) {
      const confirmed = await app.inject({
        method: "POST",
        url: `/v1/imports/${importId}/review/${item.source_record_id}`,
        headers: headers(signedA.token, ownerA, `confirm-${item.source_record_id}`),
        payload: JSON.stringify({ action: "confirm_new", review_version: item.review_version }),
      });
      assert.equal(confirmed.statusCode, 200, confirmed.body);
    }

    const listed = await app.inject({
      method: "GET",
      url: `/v1/transactions?accountId=${accountA}`,
      headers: headers(signedA.token, ownerA),
    });
    const rows = listed.json().items as Array<{
      amount: string;
      currency: string;
      direction: string;
      financialEvent: { family: string | null; outcome: string } | null;
      financialUse: { categoryCode: string | null; categoryStatus: string } | null;
    }>;
    assert.equal(rows.length, 3);
    assert.equal(rows.every((row) => row.currency === "INR"), true);
    const loanRow = rows.find((row) => row.amount.startsWith("40"));
    const cardRow = rows.find((row) => row.amount.startsWith("15"));
    assert.equal(loanRow?.financialEvent?.family, "LOAN_REPAYMENT");
    assert.equal(loanRow?.financialUse?.categoryCode ?? null, null);
    assert.equal(cardRow?.financialEvent?.family, "CREDIT_CARD_PAYMENT");
    assert.equal(cardRow?.financialUse?.categoryCode ?? null, null);

    const summaries = await app.inject({
      method: "GET",
      url: "/v1/accounts/summaries",
      headers: headers(signedA.token, ownerA),
    });
    const summaryBody = summaries.json() as { accounts: Array<{ accountId: string; availableBalance: unknown; totals: Array<{ currency: string; inflow: string; outflow: string }> }> };
    const inr = summaryBody.accounts.find((account) => account.accountId === accountA);
    const usd = summaryBody.accounts.find((account) => account.accountId === accountUsd);
    assert.equal(inr?.availableBalance ?? null, null);
    assert.equal(usd?.availableBalance ?? null, null);
    assert.equal(Number(inr?.totals.find((total) => total.currency === "INR")?.inflow), 25);
    assert.equal(Number(inr?.totals.find((total) => total.currency === "INR")?.outflow), 55);
    assert.equal(usd?.totals.length ?? 0, 0);
    assert.equal(summaryBody.accounts.some((account) => account.accountId === accountB), false);

    const overview = await app.inject({
      method: "GET",
      url: "/v1/finance/overview?from=2026-10-01&to=2026-10-31&currency=INR",
      headers: headers(signedA.token, ownerA),
    });
    const overviewBody = overview.json() as { currencies: Array<{ currency: string; inflow: string; outflow: string; ordinaryOutflow: string; transactionCount: number }> };
    assert.equal(overviewBody.currencies.length, 1);
    assert.equal(Number(overviewBody.currencies[0]?.inflow), 25);
    assert.equal(Number(overviewBody.currencies[0]?.outflow), 55);
    assert.equal(Number(overviewBody.currencies[0]?.ordinaryOutflow), 0);
    assert.equal(overviewBody.currencies[0]?.transactionCount, 3);

    const cameIn = await app.inject({
      method: "POST",
      url: "/v1/molybot/ask",
      headers: headers(signedA.token, ownerA, "unused"),
      payload: JSON.stringify({ question: "How much money came in this month?" }),
    });
    assert.equal(Number((cameIn.json() as { currencies: Array<{ currency: string; amount: string }> }).currencies.find((row) => row.currency === "INR")?.amount), 25);
    const wentOut = await app.inject({
      method: "POST",
      url: "/v1/molybot/ask",
      headers: { ...headers(signedA.token, ownerA), "content-type": "application/json" },
      payload: JSON.stringify({ question: "How much money went out this month?" }),
    });
    assert.equal(Number((wentOut.json() as { currencies: Array<{ amount: string }> }).currencies[0]?.amount), 55);
    const loans = await app.inject({
      method: "POST",
      url: "/v1/molybot/ask",
      headers: { ...headers(signedA.token, ownerA), "content-type": "application/json" },
      payload: JSON.stringify({ question: "What were my loan repayments?" }),
    });
    const loanAnswer = loans.json() as { complete: boolean; items: Array<{ amount: string }> };
    assert.equal(loanAnswer.complete, true);
    assert.equal(loanAnswer.items.length, 1);
    assert.equal(loanAnswer.items[0]?.amount.startsWith("40"), true);
    const cards = await app.inject({
      method: "POST",
      url: "/v1/molybot/ask",
      headers: { ...headers(signedA.token, ownerA), "content-type": "application/json" },
      payload: JSON.stringify({ question: "What were my credit-card payments?" }),
    });
    assert.equal((cards.json() as { items: Array<{ amount: string }> }).items[0]?.amount.startsWith("15"), true);

    const otherLedger = await app.inject({
      method: "GET",
      url: "/v1/transactions",
      headers: headers(signedB.token, ownerB),
    });
    assert.equal((otherLedger.json() as { items: unknown[] }).items.length, 0);
    const otherBot = await app.inject({
      method: "POST",
      url: "/v1/molybot/ask",
      headers: { ...headers(signedB.token, ownerB), "content-type": "application/json" },
      payload: JSON.stringify({ question: "What were my loan repayments?" }),
    });
    assert.equal((otherBot.json() as { available: boolean }).available, false);
    const businessLedger = await app.inject({
      method: "GET",
      url: "/v1/transactions",
      headers: headers(signedA.token, business),
    });
    assert.equal((businessLedger.json() as { items: unknown[] }).items.length, 0);
    const deniedLedger = await app.inject({
      method: "GET",
      url: "/v1/transactions",
      headers: headers(signedA.token, denied),
    });
    assert.equal(deniedLedger.statusCode, 403);

    const duplicateId = await upload(duplicate, `duplicate-${stamp}`, ownerA, signedA.token, accountA);
    await until(async () => {
      const mapped = await admin.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM core.source_record_disposition d
           JOIN core.source_record s ON s.source_record_id = d.source_record_id
           JOIN core.extraction_run r ON r.extraction_run_id = s.extraction_run_id
           JOIN core.source_document doc ON doc.source_document_id = r.source_document_id
          WHERE doc.source_batch_id = $1 AND d.outcome = 'LINKED_EXISTING'`,
        [duplicateId],
      );
      return (mapped.rows[0]?.count ?? 0) === 1;
    });
    const afterDuplicate = await app.inject({
      method: "GET",
      url: "/v1/finance/overview?from=2026-10-01&to=2026-10-31&currency=INR",
      headers: headers(signedA.token, ownerA),
    });
    assert.equal(Number(afterDuplicate.json().currencies[0].outflow), 55);
    assert.equal(afterDuplicate.json().currencies[0].transactionCount, 3);

    const infectedId = await upload(eicar, `eicar-${stamp}`, ownerA, signedA.token);
    await until(async () => {
      const scanned = await admin.query<{ status: string; reasons: string[] }>(
        "SELECT status, reason_codes AS reasons FROM core.source_document WHERE source_batch_id = $1",
        [infectedId],
      );
      return scanned.rows[0]?.reasons?.includes("SCAN_INFECTED") === true || scanned.rows[0]?.status === "REJECTED";
    });
    const infected = await app.inject({
      method: "GET",
      url: `/v1/imports/${infectedId}/status`,
      headers: headers(signedA.token, ownerA),
    });
    assert.equal(infected.json().data.parser_eligible, false);

    await app.close();
  } finally {
    await admin.end();
  }
});
