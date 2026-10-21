/**
 * Option A smoke: boot :8090 (Decision OS) + :8080 (gateway proxy),
 * upload the sample PDF through the mobile import contract, and wait for intake.
 *
 * Usage (stack deps already running — Redis, intelligence :8091, Celery intake+cash):
 *   INTERNAL_TOKEN=... INTELLIGENCE_URL=http://127.0.0.1:8091 \
 *     npx tsx scripts/smoke-imports-option-a.mts [path-to.pdf]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AuthError, MemoryIdentity, createApp } from "../backend-monytix/api/src/app.js";
import { MemoryFinance } from "../backend-monytix/api/src/finance.js";
import { httpIntelligence } from "../backend-monytix/api/src/http-intelligence.js";
import { MemoryMongo } from "../backend-monytix/api/src/mongo.js";
import { buildApp } from "../services/api/src/app.js";

const pdfPath = resolve(
  process.argv[2] ||
    new URL("../Acct Statement_6544_13092026_14.31.29.pdf", import.meta.url).pathname,
);
const token = process.env.INTERNAL_TOKEN?.trim() || "";
if (!token) {
  console.error("INTERNAL_TOKEN is required");
  process.exit(1);
}
const intelligenceUrl = process.env.INTELLIGENCE_URL?.trim() || "http://127.0.0.1:8091";
const financePort = Number(process.env.SMOKE_FINANCE_PORT || 8090);
const gatewayPort = Number(process.env.SMOKE_GATEWAY_PORT || 8080);
const smokeBearer = "smoke-e2e-token";
const ownerId = "11111111-1111-4111-8111-111111111111";

const pdf = readFileSync(pdfPath);
const sha256 = createHash("sha256").update(pdf).digest("hex");
console.log(JSON.stringify({ pdf: pdfPath, bytes: pdf.length, sha256 }, null, 2));

const intelligence = httpIntelligence(intelligenceUrl, token);
const identity = new MemoryIdentity();
const actorId = await identity.provisionActor("smoke-user", "smoke@monytix.test");
identity.membership.add(`${actorId}:${ownerId}`);

const financeApp = createApp({
  verifier: {
    async verify(value) {
      if (value !== smokeBearer) throw new AuthError(401, "unauthorized");
      return { subject: "smoke-user", email: "smoke@monytix.test" };
    },
  },
  identity,
  mongo: new MemoryMongo(),
  finance: new MemoryFinance(),
  intelligence,
  aa: null,
  keys: null,
  gmail: null,
  gmailClientId: "",
  webhookSecret: "",
  objects: new Map(),
  storage: null,
  extractor: intelligence,
  queue: intelligence,
  internalToken: token,
  scanner: null,
});

await financeApp.listen({ port: financePort, host: "127.0.0.1" });
console.log(`finance listening on ${financePort}`);

const gateway = await buildApp({
  logger: false,
  financeBackendUrl: `http://127.0.0.1:${financePort}`,
  auth: {
    configured: true,
    verify: async (value) => {
      if (value !== smokeBearer) {
        const err = Object.assign(new Error("unauthorized"), { code: "unauthorized" });
        throw err;
      }
      return { subject: "smoke-user", email: "smoke@monytix.test", authTime: Math.floor(Date.now() / 1000) };
    },
  },
  identity: {
    async provisionActor() {
      return { actorId };
    },
    async resolveOwner(_actor, requested) {
      if (requested && requested !== ownerId) {
        const { AuthError: GwAuth } = await import("../services/api/src/auth/errors.js");
        throw new GwAuth(403, "owner_forbidden");
      }
      return ownerId;
    },
    async ping() {},
    async close() {},
  },
});
await gateway.listen({ port: gatewayPort, host: "127.0.0.1" });
console.log(`gateway listening on ${gatewayPort}`);

const authHeaders = {
  authorization: `Bearer ${smokeBearer}`,
  "x-monytix-owner-id": ownerId,
};

try {
  const created = await fetch(`http://127.0.0.1:${gatewayPort}/v1/imports`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      file_type: "PDF",
      byte_size: pdf.length,
      sha256,
      original_filename: "Acct Statement_6544_13092026_14.31.29.pdf",
    }),
  });
  const createdBody = await created.json();
  console.log("initiate", created.status, JSON.stringify(createdBody).slice(0, 400));
  if (!created.ok) throw new Error(`initiate failed: ${created.status}`);
  const importId = createdBody.data.import_id as string;
  const objectKey = createdBody.data.object_key as string;

  // Binary upload goes to finance directly (gateway proxyPayloads:false is JSON-oriented).
  const stored = await fetch(`http://127.0.0.1:${financePort}/v1/imports/bytes`, {
    method: "PUT",
    headers: {
      ...authHeaders,
      "content-type": "application/octet-stream",
      "x-object-key": objectKey,
    },
    body: pdf,
  });
  console.log("bytes", stored.status, await stored.text());
  if (!stored.ok) throw new Error(`bytes upload failed: ${stored.status}`);

  const completed = await fetch(`http://127.0.0.1:${gatewayPort}/v1/imports/${importId}/complete`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: "{}",
  });
  const completedBody = await completed.json();
  console.log("complete", completed.status, JSON.stringify(completedBody).slice(0, 400));
  if (!completed.ok) throw new Error(`complete failed: ${completed.status}`);

  const passwordCandidates = [
    process.env.STATEMENT_PASSWORD?.trim(),
    "6544",
    "1309",
    "2026",
  ].filter((value): value is string => Boolean(value && value.length > 0));

  let lastStatus: unknown = null;
  let opened = false;
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const status = await fetch(`http://127.0.0.1:${gatewayPort}/v1/imports/${importId}/status`, {
      headers: authHeaders,
    });
    lastStatus = await status.json();
    console.log(`status[${i}]`, status.status, JSON.stringify(lastStatus).slice(0, 300));
    const stage = (lastStatus as { data?: { stage?: string; extraction_failure?: string; parser_eligible?: boolean } })?.data?.stage;
    const failure = (lastStatus as { data?: { extraction_failure?: string } })?.data?.extraction_failure;
    const eligible = (lastStatus as { data?: { parser_eligible?: boolean } })?.data?.parser_eligible;

    if (!opened && eligible && passwordCandidates.length > 0) {
      const guess = passwordCandidates.shift()!;
      const open = await fetch(`http://127.0.0.1:${gatewayPort}/v1/imports/${importId}/open`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        body: JSON.stringify({ statement_password: guess }),
      });
      const openBody = await open.text();
      console.log("open", open.status, guess, openBody.slice(0, 200));
      if (open.ok) {
        opened = true;
        continue;
      }
      if (open.status === 422 && passwordCandidates.length > 0) {
        // try next candidate on following poll
        continue;
      }
      if (open.status === 422) {
        console.log("all password candidates rejected");
        break;
      }
    }

    if (failure === "WAITING_FOR_PASSWORD" && passwordCandidates.length === 0 && !opened) {
      console.log("PDF requires a password — set STATEMENT_PASSWORD to continue.");
      break;
    }
    if (opened && (stage === "Processing" || stage === "Imported")) {
      // Hold the in-memory finance API long enough for Celery cash → apply → context.
      if (i >= 20) break;
    }
  }

  // Ledger list lives on finance (:8090); gateway does not proxy /v1/transactions.
  const txns = await fetch(`http://127.0.0.1:${financePort}/v1/transactions`, {
    headers: authHeaders,
  });
  const txnsBody = await txns.json().catch(() => ({}));
  const txnCount = Array.isArray((txnsBody as { items?: unknown[] }).items)
    ? (txnsBody as { items: unknown[] }).items.length
    : null;
  console.log("transactions", txns.status, "count=", txnCount, JSON.stringify(txnsBody).slice(0, 200));

  const decisions = await fetch(`http://127.0.0.1:${gatewayPort}/v1/ui/decisions`, {
    headers: authHeaders,
  });
  const decisionsBody = await decisions.json();
  console.log("decisions", decisions.status, JSON.stringify(decisionsBody).slice(0, 600));

  console.log(JSON.stringify({
    ok: created.ok && stored.ok && completed.ok && opened,
    import_id: importId,
    txn_count: txnCount,
    final_status: lastStatus,
  }, null, 2));
} finally {
  await gateway.close();
  await financeApp.close();
}
