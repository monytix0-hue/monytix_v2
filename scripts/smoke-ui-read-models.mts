/**
 * F9 UI gateway read-models smoke (Auth B — no Firebase JWT).
 * Boots PublicAPI + FinanceAPI in-process with fake bearer smoke-e2e-token,
 * seeds MemoryFinance (ACTIVE M30 + 30 MILE), asserts four F9 envelopes
 * via the real finance proxy path.
 *
 *   INTERNAL_TOKEN=test-internal-token npx tsx scripts/smoke-ui-read-models.mts
 */
import { randomUUID } from "node:crypto";
import { AuthError, MemoryIdentity, createApp } from "../backend-monytix/api/src/app.js";
import { MemoryFinance } from "../backend-monytix/api/src/finance.js";
import { MemoryMongo } from "../backend-monytix/api/src/mongo.js";
import { buildApp } from "../services/api/src/app.js";

const token = process.env.INTERNAL_TOKEN?.trim() || "test-internal-token";
const financePort = Number(process.env.SMOKE_FINANCE_PORT || 18090);
const gatewayPort = Number(process.env.SMOKE_GATEWAY_PORT || 18080);
const smokeBearer = "smoke-e2e-token";
const ownerId = "11111111-1111-4111-8111-111111111111";

const stubIntelligence = {
  async enqueue() {
    return { queued: true as const };
  },
  async extract() {
    return { status: "ok" as const };
  },
  async normalize() {
    return { domain: "LEDGER" as const, ledger: [] };
  },
  async evaluateHuman() {
    return { status: "ok" as const };
  },
  async evaluateDecision() {
    return { status: "ok" as const };
  },
  async evaluateOutcomeMile() {
    return null;
  },
};

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
  intelligence: stubIntelligence as never,
  aa: null,
  keys: null,
  gmail: null,
  gmailClientId: "",
  webhookSecret: "",
  objects: new Map(),
  storage: null,
  extractor: stubIntelligence as never,
  queue: stubIntelligence as never,
  internalToken: token,
  scanner: null,
});

await financeApp.listen({ port: financePort, host: "127.0.0.1" });
console.log(JSON.stringify({ event: "finance_up", port: financePort }));

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
console.log(JSON.stringify({ event: "gateway_up", port: gatewayPort }));

const authHeaders = {
  authorization: `Bearer ${smokeBearer}`,
  "x-monytix-owner-id": ownerId,
};

const missionId = randomUUID();
const txnId = randomUUID();
const dedupeKey = `mile:${txnId}:${missionId}`;
const outcomeKey = `fo:${txnId}:${missionId}`;

finance.missions.push({
  mission_id: missionId,
  owner_id: ownerId,
  canonical_mission_code: "M30",
  title: "Stop Financial Leakage",
  state: "ACTIVE",
  origin_type: "USER_CREATED",
  target_definition: { default_target_inr: 15000, metric_basis: "Stop Financial Leakage" },
  idempotency_key: `msn_orbit:${ownerId}:M30`,
  current_progress_inr: 0,
});

await finance.applyOutcomesMile({
  owner_id: ownerId,
  transaction_id: txnId,
  package: {
    outcome: {
      mission_id: missionId,
      idempotency_key: outcomeKey,
      economic_event_key: `ee:${txnId}`,
      observed_amount: 10000,
      verification_status: "A3_ASSOCIATED",
    },
    attribution: { attribution_level: "A3" },
    impact: {
      economic_impact_key: `ei:${txnId}`,
      impact_type: "SAVED",
      amount: 10000,
    },
    mile_event: {
      mission_id: missionId,
      dedupe_key: dedupeKey,
      mile_awarded: 30,
      outcome_family_code: "MS",
      occurred_at: new Date().toISOString(),
      attribution_level: "A3",
      base_value: 10,
      magnitude_factor: 5,
      significance_factor: 1.2,
    },
  },
});

console.log(
  JSON.stringify({
    event: "seeded",
    missionId,
    progress: finance.missions[0]?.current_progress_inr,
    mile_events: finance.mileEvents.length,
  }),
);

type Envelope = { meta?: { api_version?: string }; data?: Record<string, unknown> };

async function assertEnvelope(
  label: string,
  path: string,
  validateData: (data: Record<string, unknown>) => boolean,
): Promise<boolean> {
  const res = await fetch(`http://127.0.0.1:${gatewayPort}${path}`, { headers: authHeaders });
  const text = await res.text();
  let payload: Envelope;
  try {
    payload = JSON.parse(text) as Envelope;
  } catch {
    console.error(JSON.stringify({ event: "assert_fail", label, error: "invalid_json", status: res.status, body: text.slice(0, 300) }));
    return false;
  }
  if (res.status !== 200) {
    console.error(JSON.stringify({ event: "assert_fail", label, error: "http", status: res.status, body: text.slice(0, 300) }));
    return false;
  }
  if (!payload.meta || payload.meta.api_version !== "v1.2") {
    console.error(JSON.stringify({ event: "assert_fail", label, error: "meta", meta: payload.meta }));
    return false;
  }
  if (!payload.data || !validateData(payload.data)) {
    console.error(JSON.stringify({ event: "assert_fail", label, error: "data", data: payload.data }));
    return false;
  }
  console.log(JSON.stringify({ event: "assert_ok", label, path, api_version: payload.meta.api_version }));
  return true;
}

let failures = 0;

try {
  const missionsOk = await assertEnvelope("MISSIONS", "/v1/ui/missions", (data) => {
    const active = (data.active_missions as { canonical_code?: string; current_progress_inr?: number }[]) || [];
    const m30 = active.find((m) => m.canonical_code === "M30");
    if (!m30) return false;
    const progress = Number(m30.current_progress_inr);
    console.log(JSON.stringify({ event: "missions_detail", progress }));
    return progress >= 10000;
  });
  if (!missionsOk) failures += 1;

  const rewardsOk = await assertEnvelope("REWARDS", "/v1/ui/rewards", (data) => {
    const points = Number(data.total_mile_points);
    const moments = Number(data.clarity_moments_count);
    console.log(JSON.stringify({ event: "rewards_detail", points, moments }));
    return points >= 30 && moments >= 1;
  });
  if (!rewardsOk) failures += 1;

  const journeyOk = await assertEnvelope("JOURNEY", "/v1/ui/journey", (data) => {
    const chapter = data.chapter as { chapter_name?: string } | undefined;
    console.log(JSON.stringify({ event: "journey_detail", chapter: chapter?.chapter_name ?? null }));
    return !!chapter;
  });
  if (!journeyOk) failures += 1;

  const decisionsOk = await assertEnvelope("DECISIONS", "/v1/ui/decisions", (data) => {
    const scoreTypeOk = typeof data.awareness_score === "number";
    console.log(JSON.stringify({ event: "decisions_detail", awareness_score: data.awareness_score }));
    return scoreTypeOk;
  });
  if (!decisionsOk) failures += 1;

  console.log(JSON.stringify({ event: failures === 0 ? "smoke_ok" : "smoke_fail", failures }));
  if (failures > 0) process.exitCode = 1;
} finally {
  await gateway.close();
  await financeApp.close();
}
