/**
 * A3 attribution & M.I.L.E. mint smoke:
 *   ₹18k SHOPPING OUT → PROMOTE → D10 → ACCEPT → M30 ACTIVE
 *   → outcomes.reconcile → A3_ASSOCIATED mile_event + progress
 *   → GET :8080/v1/ui/rewards + /v1/ui/journey
 *
 * M30 matches OUT + FOOD_DINING|SHOPPING_RETAIL (not deposit/IN).
 * Expected for ₹18000 → MS base 10 × mag 5 × sig 1.2 × A3 0.5 = 30 MILE.
 *
 *   INTERNAL_TOKEN=... npx tsx scripts/smoke-mission-progress-mile.mts
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
const expectedMile = Number(process.env.EXPECTED_MILE || 30);
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

async function gwJson(path: string) {
  const res = await fetch(`http://127.0.0.1:${gatewayPort}${path}`, { headers: authHeaders });
  const body = await res.json();
  return { status: res.status, body };
}

try {
  console.log("=== 1. Apply synthetic ≥₹15k SHOPPING OUT ===");
  const record = await mongo.insertInbound({
    owner_id: ownerId,
    source: "PDF_UPLOAD",
    channel_type: "deposit",
    payload: { synthetic: true, note: "mile-smoke" },
    idempotency_key: `mile-smoke:${randomUUID()}`,
  });

  const apply = await fetch(`http://127.0.0.1:${financePort}/v1/internal/apply`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      record: { _id: record._id, owner_id: ownerId },
      normalized: empty({
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
      }),
    }),
  });
  console.log("apply", apply.status, await apply.text());
  if (!apply.ok) throw new Error("apply failed");

  console.log("=== 2. Wait for PROMOTE → D10 candidate on gateway ===");
  let heaviest: Record<string, unknown> | null = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const { status, body } = await gwJson("/v1/ui/decisions");
    const data = (body as { data?: { heaviest_decision?: Record<string, unknown> | null } }).data;
    if (i % 4 === 0) {
      console.log(`decisions[${i}]`, status, "eligibility=", finance.eligibility.map((e) => e.state).join(",") || "-");
    }
    if (data?.heaviest_decision) {
      heaviest = data.heaviest_decision;
      break;
    }
  }
  if (!heaviest?.decision_id) throw new Error("no D10 candidate");
  console.log("heaviest", heaviest.decision_family_code, heaviest.fps_score, heaviest.priority_band);

  console.log("=== 3. ACCEPT → M30 ACTIVE ===");
  const accept = await fetch(
    `http://127.0.0.1:${gatewayPort}/v1/decisions/${heaviest.decision_id}/actions`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({ action: "ACCEPT", selected_option_id: "OPT_1" }),
    },
  );
  const acceptBody = await accept.json();
  console.log("accept", accept.status, JSON.stringify(acceptBody).slice(0, 400));
  if (!accept.ok) throw new Error("ACCEPT failed");

  const { body: missionsBefore } = await gwJson("/v1/ui/missions");
  const before = (missionsBefore as { data?: { active_missions?: { canonical_code?: string; current_progress_inr?: number }[] } })
    .data?.active_missions?.[0];
  console.log("mission_before", before?.canonical_code, "progress=", before?.current_progress_inr);

  console.log("=== 4. Enqueue outcomes.reconcile (post-ACCEPT; first apply raced before M30) ===");
  await intelligence.enqueue({
    task: "outcomes.reconcile",
    queue: "reconciliation",
    payload: { owner_id: ownerId },
  });
  console.log("outcomes.reconcile enqueued");

  let progress = 0;
  let rewardsData: Record<string, unknown> | null = null;
  let journeyData: Record<string, unknown> | null = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    progress = finance.missions[0]?.current_progress_inr ?? 0;
    const miles = finance.mileEvents.length;
    if (i % 4 === 0) {
      console.log(`mile_wait[${i}] progress=${progress} mile_events=${miles} outcomes=${finance.financialOutcomes.length}`);
    }
    if (progress > 0 && miles > 0) break;
  }

  const { status: msnStatus, body: missionsAfter } = await gwJson("/v1/ui/missions");
  const after = (missionsAfter as { data?: { active_missions?: Record<string, unknown>[] } }).data?.active_missions?.[0];
  console.log("missions", msnStatus, JSON.stringify(after).slice(0, 400));

  const rewards = await gwJson("/v1/ui/rewards");
  rewardsData = (rewards.body as { data?: Record<string, unknown> }).data ?? null;
  console.log("rewards", rewards.status, JSON.stringify(rewardsData).slice(0, 500));

  const journey = await gwJson("/v1/ui/journey");
  journeyData = (journey.body as { data?: Record<string, unknown> }).data ?? null;
  console.log(
    "journey",
    journey.status,
    "items=",
    Array.isArray((journeyData as { items?: unknown[] })?.items)
      ? (journeyData as { items: unknown[] }).items.length
      : 0,
    JSON.stringify(journeyData).slice(0, 500),
  );

  const mile = finance.mileEvents[0];
  const outcome = finance.financialOutcomes[0];
  const impact = finance.financialImpacts[0];
  const attribution = finance.outcomeAttributions[0];

  const summary = {
    ok:
      accept.ok &&
      (acceptBody as { data?: { mission_code?: string } }).data?.mission_code === "M30" &&
      progress === Number(amount) &&
      finance.mileEvents.length === 1 &&
      Math.abs((mile?.mile_awarded ?? 0) - expectedMile) < 0.01 &&
      Number(rewardsData?.total_mile_points ?? 0) === expectedMile &&
      Number(rewardsData?.clarity_moments_count ?? 0) === 1 &&
      Number((rewardsData?.currency_impact as { saved_inr?: number } | undefined)?.saved_inr ?? 0) === Number(amount),
    amount: Number(amount),
    decision_family: heaviest.decision_family_code,
    mission_code: "M30",
    current_progress_inr: progress,
    attribution_level: attribution?.level ?? null,
    verification_status: "A3_ASSOCIATED",
    impact_type: impact?.impact_type ?? null,
    mile_awarded: mile?.mile_awarded ?? null,
    expected_mile: expectedMile,
    formula: "MS(10) × min(sqrt(18000/100),5)=5 × sig(1.2) × A3(0.5) = 30",
    outcome_idempotency_key: outcome?.idempotency_key ?? null,
    mile_dedupe_key: mile?.dedupe_key ?? null,
    rewards: {
      total_mile_points: rewardsData?.total_mile_points ?? null,
      clarity_moments_count: rewardsData?.clarity_moments_count ?? null,
      currency_impact: rewardsData?.currency_impact ?? null,
    },
    journey_items: Array.isArray((journeyData as { items?: unknown[] })?.items)
      ? (journeyData as { items: unknown[] }).items.length
      : 0,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
} finally {
  await gateway.close();
  await financeApp.close();
}
