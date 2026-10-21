import assert from "node:assert/strict";
import test from "node:test";
import { AuthError, MemoryIdentity, createApp, signBody, type AaClient, type GmailClient } from "../src/app.js";
import { MemoryFinance } from "../src/finance.js";
import { MemoryMongo } from "../src/mongo.js";
import type { InboundRecord, Normalized } from "../src/types.js";
import { routeRecord } from "../src/worker.js";

const secret = "aa-secret";

function harness() {
  const mongo = new MemoryMongo();
  const finance = new MemoryFinance();
  const calls: InboundRecord[] = [];
  const intelligence = {
    async normalize(record: InboundRecord): Promise<Normalized> {
      calls.push(record);
      if (String(record.payload.raw_text ?? "").includes("Amount due")) {
        return empty("DUE_DATE", { due: { biller_name: "HDFC Card", amount_due: "4500.00", due_date: "2026-10-28", instrument_type: "CREDIT_CARD", currency_code: "INR" } });
      }
      if (record.payload.fi_type === "MUTUAL_FUNDS") {
        return empty("MUTUAL_FUND", { mutual_funds: [{ folio_number: "F1", scheme_name: "Flexi", isin: "INF1", units: "10", nav: "1", nav_date: "2026-10-01", current_value: "10", currency_code: "INR", transactions: [] }] });
      }
      return empty("LEDGER", { ledger: [{
        line_no: 1, amount: "350.00", flow: "OUT", channel: "UPI", payment_ref: "REF123456",
        raw_narration: "UPI/41234/SWIGGY-BANGALORE", clean_merchant: "Swiggy", category_id: "FOOD_DINING",
        subcategory_id: "FOOD_DELIVERY", posted_at: "2026-10-19T00:00:00", masked_account: "4321",
        institution: "HDFC", currency_code: "INR",
      }] });
    },
  };
  const aa: AaClient = {
    async createConsent(ownerId) {
      return { consent_id: `c-${ownerId}`, redirect_url: "https://aa.example/consent" };
    },
    async createFiRequest() {
      return "session-1";
    },
    async fetchFi() {
      return { consentId: "c-1", FI: [{ fipId: "FIP-HDFC-01", fiType: "MUTUAL_FUNDS", data: { cipher_data: "abc" } }] };
    },
  };
  const gmail: GmailClient = {
    async exchangeCode() {
      return { refresh_token: "refresh", access_token: "access", email: "a@b.c" };
    },
    async listMessages() {
      return [{ id: "m1", text: "debited Rs 350.00 via UPI/41234/SWIGGY-BANGALORE", subject: "alert" }];
    },
  };
  const identity = new MemoryIdentity();
  const app = createApp({
    verifier: { async verify(token) { if (token !== "good") throw new AuthError(401, "unauthorized"); return { subject: "user-1", email: "a@b.c" }; } },
    identity,
    mongo,
    finance,
    intelligence,
    aa,
    keys: { async issue() { return { our_nonce: "bm9uY2U=", key_material: { curve: "Curve25519" } }; } },
    gmail,
    gmailClientId: "gmail-client",
    webhookSecret: secret,
    objects: new Map(),
  });
  return { app, mongo, finance, calls, identity };
}

test("health is public and other routes require firebase", async () => {
  const { app } = harness();
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  const denied = await app.inject({ method: "GET", url: "/v1/transactions" });
  assert.equal(denied.statusCode, 401);
  const ok = await app.inject({ method: "GET", url: "/v1/transactions", headers: { authorization: "Bearer good" } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().items, []);
});

test("pdf and gmail land in mongo before a ledger write", async () => {
  const { app, mongo, finance } = harness();
  const created = await app.inject({
    method: "POST",
    url: "/v1/imports/complete",
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    payload: { idempotency_key: "k1", raw_text: "debited Rs 350.00 via UPI/41234/SWIGGY-BANGALORE" },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(mongo.records.size, 1);
  assert.equal(finance.ledger.length, 0);
  const id = created.json().import_id as string;
  const routed = await app.inject({
    method: "POST",
    url: `/v1/internal/route/${id}`,
    headers: { authorization: "Bearer good" },
  });
  assert.equal(routed.statusCode, 200);
  assert.equal(routed.json().table, "ledger_transactions");
  assert.equal(finance.ledger.length, 1);
  assert.equal(finance.dues.length, 0);
  assert.equal(finance.mutual_funds.length, 0);

  const gmail = await app.inject({
    method: "POST",
    url: "/v1/gmail/connect/code",
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    payload: { code: "auth-code" },
  });
  assert.equal(gmail.statusCode, 200);
  assert.equal(gmail.json().backfill_ids.length, 1);
  assert.equal(finance.ledger.length, 1);
});

test("due date and mutual fund records do not enter the ledger", async () => {
  const { app, mongo, finance } = harness();
  const due = await app.inject({
    method: "POST",
    url: "/v1/imports/complete",
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    payload: { idempotency_key: "due", raw_text: "HDFC Card Amount due: Rs 4,500. Due: 28-Oct" },
  });
  await routeRecord(mongo, finance, appIntelligence(finance), due.json().import_id);
  assert.equal(finance.ledger.length, 0);
  assert.equal(finance.dues.length, 1);

  const owner = [...mongo.records.values()][0]?.owner_id ?? "";
  const consentBody = JSON.stringify({ consentId: "c-1", consentStatus: "ACTIVE" });
  await mongo.saveConsent("c-1", owner, "https://aa.example/consent");
  const consent = await app.inject({
    method: "POST",
    url: "/v1/aa/webhook/consent",
    headers: { "content-type": "application/json", "x-aa-signature": signBody(consentBody, secret) },
    payload: consentBody,
  });
  assert.equal(consent.statusCode, 200);
  const fiBody = JSON.stringify({ sessionId: "session-1", sessionStatus: "COMPLETED" });
  const fi = await app.inject({
    method: "POST",
    url: "/v1/aa/webhook/fi",
    headers: { "content-type": "application/json", "x-aa-signature": signBody(fiBody, secret) },
    payload: fiBody,
  });
  assert.equal(fi.statusCode, 200);
  const aa = [...mongo.records.values()].find((row) => row.source === "ACCOUNT_AGGREGATOR");
  assert.ok(aa);
  assert.equal(aa.idempotency_key, "aa_session:session-1:FIP-HDFC-01");
  const again = await app.inject({
    method: "POST",
    url: "/v1/aa/webhook/fi",
    headers: { "content-type": "application/json", "x-aa-signature": signBody(fiBody, secret) },
    payload: fiBody,
  });
  assert.equal(again.statusCode, 200);
  assert.equal([...mongo.records.values()].filter((row) => row.source === "ACCOUNT_AGGREGATOR").length, 1);
  const table = await routeRecord(mongo, finance, {
    async normalize(record) {
      assert.equal(record.payload.fi_type, "MUTUAL_FUNDS");
      return empty("MUTUAL_FUND", { mutual_funds: [{ folio_number: "F1", scheme_name: "Flexi", isin: "INF1", units: "10", nav: null, nav_date: null, current_value: null, currency_code: "INR", transactions: [] }] });
    },
  }, aa._id);
  assert.equal(table, "mf_holdings");
  assert.equal(finance.ledger.length, 0);
  assert.equal(finance.mutual_funds.length, 1);
  assert.equal(finance.debts.length, 0);
  assert.equal(finance.policies.length, 0);
  assert.equal(finance.assets.length, 0);
});

test("user override replaces the system category on the ledger only", async () => {
  const { mongo, finance } = harness();
  const owner = "owner-override";
  await finance.putOverride(owner, "SWIGGY", { category_id: "SHOPPING_RETAIL", subcategory_id: "OTHER" });
  const inserted = await mongo.insertInbound({
    owner_id: owner,
    source: "GMAIL",
    channel_type: "SPOT_ALERT",
    payload: { raw_text: "swiggy" },
    idempotency_key: "override-1",
  });
  await routeRecord(mongo, finance, {
    async normalize() {
      return empty("LEDGER", { ledger: [{
        line_no: 1, amount: "10.00", flow: "OUT", channel: "UPI", payment_ref: null,
        raw_narration: "SWIGGY", clean_merchant: "Swiggy", category_id: "FOOD_DINING",
        subcategory_id: "FOOD_DELIVERY", posted_at: "2026-10-19T00:00:00", masked_account: "1111",
        institution: null, currency_code: "INR",
      }] });
    },
  }, inserted._id);
  assert.equal(finance.ledger[0]?.category_id, "SHOPPING_RETAIL");
  assert.equal(finance.ledger[0]?.is_user_overridden, true);
});

function empty(domain: Normalized["domain"], extra: Partial<Normalized> = {}): Normalized {
  return {
    domain,
    ledger: [],
    due: null,
    mutual_funds: [],
    investments: [],
    assets: [],
    debts: [],
    policies: [],
    decrypted_fi: null,
    ...extra,
  };
}

function appIntelligence(finance: MemoryFinance) {
  return {
    async normalize(record: InboundRecord): Promise<Normalized> {
      if (String(record.payload.raw_text ?? "").includes("Amount due")) {
        return empty("DUE_DATE", { due: { biller_name: "HDFC Card", amount_due: "4500.00", due_date: "2026-10-28", instrument_type: "CREDIT_CARD", currency_code: "INR" } });
      }
      return empty("LEDGER");
    },
  };
}
