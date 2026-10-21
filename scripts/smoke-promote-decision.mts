/**
 * Close the PROMOTE verification loop:
 * apply a synthetic ≥₹15k OUT → human.evaluate → decision.evaluate →
 * GET /v1/ui/decisions → ACCEPT → mission via PRIMARY_ORBIT.
 *
 * Prerequisites: Redis, intelligence :8091, Celery workers on
 * cash/context/decisions/reconciliation with FINANCE_API_URL → :8090.
 *
 *   INTERNAL_TOKEN=... npx tsx scripts/smoke-promote-decision.mts
 */
import { randomUUID } from "node:crypto";
import { AuthError, MemoryIdentity, createApp } from "../backend-monytix/api/src/app.js";
import { MemoryFinance } from "../backend-monytix/api/src/finance.js";
import { httpIntelligence } from "../backend-monytix/api/src/http-intelligence.js";
import { MemoryMongo } from "../backend-monytix/api/src/mongo.js";
import type { Normalized } from "../backend-monytix/api/src/types.js";
import { buildApp } from "../services/api/src/app.js";

const token = process.env.INTERNAL_TOKEN?.trim() || "";
if (!token) {
  console.error("INTERNAL_TOKEN is required");
  process.exit(1);
}
const intelligenceUrl = process.env.INTELLIGENCE_URL?.trim() || "http://127.0.0.1:8091";
const financePort = Number(process.env.SMOKE_FINANCE_PORT || 8090);
const gatewayPort = Number(process.env.SMOKE_GATEWAY_PORT || 8080);
const amount = process.env.PROMOTE_AMOUNT?.trim() || "18000.00";
const smokeBearer = "smoke-e2e-token";
const ownerId = "11111111-1111-4111-8111-111111111111";

const intelligence = httpIntelligence(intelligenceUrl, token);
const identity = new MemoryIdentity();
const actorId = await identity.provisionActor("smoke-user", "smoke@monytix.test");
identity.membership.add(`${actorId}:${ownerId}`);
const finance = new MemoryFinance();
const mongo = new MemoryMongo();

const financeApp = createApp({
  verifier: {
    async verify(value) {
      if (value !== smokeBearer) throw new AuthError(401, "unauthorized");
      return { subject: "smoke-user", email: "smoke@monytix.test" };
    },
  },
  identity,
  mongo,
  finance,
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
        throw Object.assign(new Error("unauthorized"), { code: "unauthorized" });
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

const empty = (extra: Partial<Normalized> = {}): Normalized => ({
  domain: "LEDGER",
  ledger: [],
  due: null,
  mutual_funds: [],
  investments: [],
  assets: [],
  debts: [],
  policies: [],
  decrypted_fi: null,
  ...extra,
});

try {
  const record = await mongo.insertInbound({
    owner_id: ownerId,
    source: "PDF_UPLOAD",
    channel_type: "deposit",
    payload: { synthetic: true, note: "promote-smoke" },
    idempotency_key: `promote-smoke:${randomUUID()}`,
  });

  const normalized = empty({
    ledger: [
      {
        line_no: 1,
        amount,
        flow: "OUT",
        channel: "CARD",
        payment_ref: null,
        raw_narration: "VISA ECOM LAPTOP TRAVEL 18000",
        clean_merchant: "SyntheticLaptopTravel",
        category_id: "SHOPPING_RETAIL",
        subcategory_id: "ECOMMERCE",
        fee_role: "BASE",
        posted_at: "2026-10-20T10:00:00",
        masked_account: "6544",
        institution: null,
        currency_code: "INR",
      },
    ],
  });

  const apply = await fetch(`http://127.0.0.1:${financePort}/v1/internal/apply`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      record: { _id: record._id, owner_id: ownerId },
      normalized,
    }),
  });
  const applyBody = await apply.text();
  console.log("apply", apply.status, applyBody.slice(0, 300));
  if (!apply.ok) throw new Error(`apply failed: ${apply.status}`);

  console.log("ledger_rows", finance.ledger.length, "amount", finance.ledger[0]?.amount);

  let heaviest: Record<string, unknown> | null = null;
  let decisionsBody: unknown = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 750));
    const res = await fetch(`http://127.0.0.1:${gatewayPort}/v1/ui/decisions`, { headers: authHeaders });
    decisionsBody = await res.json();
    const data = (decisionsBody as { data?: { heaviest_decision?: Record<string, unknown> | null; empty_state?: boolean } })?.data;
    console.log(
      `decisions[${i}]`,
      res.status,
      "empty=",
      data?.empty_state,
      "eligibility=",
      finance.eligibility.map((e) => e.state).join(",") || "-",
      "decisions=",
      finance.decisions.length,
    );
    if (data?.heaviest_decision) {
      heaviest = data.heaviest_decision;
      break;
    }
  }

  console.log("heaviest_decision", JSON.stringify(heaviest, null, 2));
  if (!heaviest?.decision_id) {
    throw new Error("PROMOTE candidate never appeared on /v1/ui/decisions");
  }

  const decisionId = String(heaviest.decision_id);
  const accept = await fetch(`http://127.0.0.1:${gatewayPort}/v1/decisions/${decisionId}/actions`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({ action: "ACCEPT", selected_option_id: "OPT_1" }),
  });
  const acceptBody = await accept.json();
  console.log("accept", accept.status, JSON.stringify(acceptBody).slice(0, 600));
  if (!accept.ok) throw new Error(`ACCEPT failed: ${accept.status}`);

  const missions = await fetch(`http://127.0.0.1:${gatewayPort}/v1/ui/missions`, { headers: authHeaders });
  const missionsBody = await missions.json();
  console.log("missions", missions.status, JSON.stringify(missionsBody).slice(0, 600));

  const acceptData = (acceptBody as { data?: Record<string, unknown> })?.data ?? {};
  const active = (missionsBody as { data?: { active_missions?: { canonical_code?: string; mission_id?: string }[] } })?.data
    ?.active_missions ?? [];

  const summary = {
    ok:
      accept.ok &&
      acceptData.current_state === "SELECTED" &&
      Boolean(acceptData.linked_mission_id) &&
      active.length >= 1,
    amount,
    decision_family: heaviest.decision_family_code ?? heaviest.family_code ?? null,
    decision_id: decisionId,
    current_state: acceptData.current_state ?? null,
    mission_code: acceptData.mission_code ?? null,
    linked_mission_id: acceptData.linked_mission_id ?? null,
    active_missions: active.map((m) => ({
      mission_id: m.mission_id,
      canonical_code: m.canonical_code,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
} finally {
  await gateway.close();
  await financeApp.close();
}
