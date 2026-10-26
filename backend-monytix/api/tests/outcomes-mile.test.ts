import assert from "node:assert/strict";
import test from "node:test";
import { AuthError, MemoryIdentity, createApp } from "../src/app.js";
import { MemoryFinance } from "../src/finance.js";
import { MemoryMongo } from "../src/mongo.js";

const token = "internal-token";
const ownerId = "44444444-4444-4444-a444-444444444444";
const txnId = "11111111-1111-4111-a111-111111111111";
const missionId = "22222222-2222-4222-a222-222222222222";

function packageFor(mile = 30) {
  return {
    outcome: {
      outcome_family_code: "MP",
      outcome_type: "ECONOMIC_OUTCOME",
      decision_id: null,
      mission_id: missionId,
      observed_amount: 2500,
      currency: "INR",
      verification_status: "A3_ASSOCIATED",
      outcome_status: "FINALIZED",
      economic_event_key: `outcome:${txnId}:${missionId}`,
      idempotency_key: `fo:${txnId}:${missionId}`,
      observed_at: "2026-10-20T10:00:00Z",
      reason_codes: ["MISSION_MATCH_M01"],
    },
    attribution: {
      attribution_level: "A3",
      attribution_factor: 0.5,
      decision_id: null,
      mission_id: missionId,
      reason_codes: ["MISSION_MATCH_M01"],
    },
    impact: {
      outcome_family_code: "MP",
      impact_type: "GOAL_FUNDED",
      impact_basis: "ACTUAL",
      amount: 2500,
      currency: "INR",
      attribution_level: "A3",
      attribution_factor: 0.5,
      economic_impact_key: `impact:${txnId}:GOAL_FUNDED`,
      status: "FINALIZED",
    },
    mile_event: {
      event_type: "OUTCOME",
      outcome_family_code: "MP",
      attribution_level: "A3",
      base_value: 12,
      magnitude_factor: 5,
      significance_factor: 1,
      confidence_factor: 1,
      mile_awarded: mile,
      status: "FINALIZED",
      dedupe_key: `mile:${txnId}:${missionId}`,
      economic_event_key: `outcome:${txnId}:${missionId}`,
      occurred_at: "2026-10-20T10:00:00Z",
      decision_id: null,
      mission_id: missionId,
    },
  };
}

async function fixture() {
  const finance = new MemoryFinance();
  const identity = new MemoryIdentity();
  const actor = await identity.provisionActor("user-1");
  identity.membership.add(`${actor}:${ownerId}`);
  finance.accounts.push({ id: "acc-1", owner_id: ownerId, masked_account: "9999" });
  finance.ledger.push({
    id: txnId,
    owner_id: ownerId,
    account_id: "acc-1",
    source_mongo_id: "mongo-1",
    line_no: 1,
    amount: "2500.00",
    flow: "OUT",
    channel: "ACH_NACH",
    payment_ref: null,
    raw_narration: "ACH/HDFC LIQUID FUND",
    clean_merchant: "HDFC Liquid Fund",
    category_id: "FINANCIAL_SERVICES",
    subcategory_id: "SIP_AUTO_DEBIT",
    posted_at: "2026-10-20T10:00:00",
    masked_account: "9999",
    institution: null,
    currency_code: "INR",
  } as never);
  finance.missions.push({
    mission_id: missionId,
    owner_id: ownerId,
    canonical_mission_code: "M01",
    title: "Build an Emergency Buffer",
    state: "ACTIVE",
    origin_type: "DECISION_CREATED",
    target_definition: { default_target_inr: 250000 },
    idempotency_key: `msn_orbit:${ownerId}:M01`,
    current_progress_inr: 5000,
  });
  const app = createApp({
    verifier: {
      async verify(value) {
        if (value !== "good") throw new AuthError(401, "unauthorized");
        return { subject: "user-1", email: "a@b.c" };
      },
    },
    identity,
    mongo: new MemoryMongo(),
    finance,
    intelligence: { async normalize() { return { domain: "LEDGER", ledger: [], due: null, mutual_funds: [], investments: [], assets: [], debts: [], policies: [] }; } },
    aa: null,
    keys: null,
    gmail: null,
    gmailClientId: "",
    gmailTokenKey: "",
    webhookSecret: "aa",
    objects: new Map(),
    internalToken: token,
  });
  return { app, finance };
}

test("pending matches ACTIVE M01 against FINANCIAL_SERVICES ledger rows", async () => {
  const { app } = await fixture();
  const pending = await app.inject({
    method: "POST",
    url: "/v1/internal/outcomes/pending",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: { owner_id: ownerId },
  });
  assert.equal(pending.statusCode, 200);
  assert.equal(pending.json().matches.length, 1);
  assert.equal(pending.json().matches[0].active_mission.canonical_mission_code, "M01");
  assert.equal(pending.json().matches[0].transaction.id, txnId);
});

test("apply-outcomes-mile mints MILE, advances mission progress, and stays idempotent", async () => {
  const { app, finance } = await fixture();
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const payload = { owner_id: ownerId, transaction_id: txnId, package: packageFor(30) };

  const first = await app.inject({ method: "POST", url: "/v1/internal/apply-outcomes-mile", headers, payload });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json(), { status: "APPLIED" });
  assert.equal(finance.financialOutcomes.length, 1);
  assert.equal(finance.outcomeAttributions.length, 1);
  assert.equal(finance.financialImpacts.length, 1);
  assert.equal(finance.mileEvents.length, 1);
  assert.equal(finance.mileEvents[0]?.mile_awarded, 30);
  assert.equal(finance.missions[0]?.current_progress_inr, 7500);

  const second = await app.inject({ method: "POST", url: "/v1/internal/apply-outcomes-mile", headers, payload });
  assert.equal(second.statusCode, 200);
  assert.equal(finance.financialOutcomes.length, 1);
  assert.equal(finance.mileEvents.length, 1);
  assert.equal(finance.missions[0]?.current_progress_inr, 7500);
});

test("GET /v1/ui/rewards and journey reflect minted MILE and funded impact", async () => {
  const { app } = await fixture();
  await app.inject({
    method: "POST",
    url: "/v1/internal/apply-outcomes-mile",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: { owner_id: ownerId, transaction_id: txnId, package: packageFor(30) },
  });

  const rewards = await app.inject({
    method: "GET",
    url: "/v1/ui/rewards",
    headers: { authorization: "Bearer good", "x-monytix-owner-id": ownerId },
  });
  assert.equal(rewards.statusCode, 200);
  assert.equal(rewards.json().data.total_mile_points, 30);
  assert.equal(rewards.json().data.clarity_moments_count, 1);
  assert.equal(rewards.json().data.currency_impact.funded_inr, 2500);

  const journey = await app.inject({
    method: "GET",
    url: "/v1/ui/journey",
    headers: { authorization: "Bearer good", "x-monytix-owner-id": ownerId },
  });
  assert.equal(journey.statusCode, 200);
  assert.equal(journey.json().data.chapter.key_moments.length, 1);
  assert.equal(journey.json().data.items.length, 1);
  assert.equal(journey.json().data.items[0].mission_code, "M01");
  assert.equal(journey.json().data.items[0].mile_awarded, 30);

  const summary = await app.inject({
    method: "GET",
    url: "/v1/mile/summary",
    headers: { authorization: "Bearer good", "x-monytix-owner-id": ownerId },
  });
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.json().contract, "mile-summary-v0.1");
  assert.equal(summary.json().empty_state, false);
  assert.equal(summary.json().distance.available, true);
  assert.equal(summary.json().distance.value, "30");
  const safety = summary.json().outcomes.find((item: { title: string }) => item.title === "Safety");
  assert.equal(String(safety.amount).includes("2,500"), true);
  assert.equal(safety.drivers, "Build an Emergency Buffer");
  assert.equal(summary.json().report.numbers.find((item: { label: string }) => item.label === "Missions advanced").value, "1");

  const events = await app.inject({
    method: "GET",
    url: "/v1/mile/events",
    headers: { authorization: "Bearer good", "x-monytix-owner-id": ownerId },
  });
  assert.equal(events.statusCode, 200);
  assert.equal(events.json().contract, "mile-events-v0.1");
  assert.equal(events.json().events.length, 1);
  assert.equal(events.json().events[0].title, "Build an Emergency Buffer");
  assert.equal(events.json().events[0].miles, "30");

  const detail = await app.inject({
    method: "GET",
    url: `/v1/mile/events/${events.json().events[0].id}`,
    headers: { authorization: "Bearer good", "x-monytix-owner-id": ownerId },
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().event.title, "Build an Emergency Buffer");
  assert.match(detail.json().event.changed, /Safety/);
});
