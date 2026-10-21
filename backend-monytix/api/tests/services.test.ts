import assert from "node:assert/strict";
import test from "node:test";
import { aaClientFromEnv } from "../src/aa.js";
import { AuthError, MemoryIdentity, createApp, type GmailClient } from "../src/app.js";
import { ExtractError } from "../src/extract.js";
import { memorySnapshots } from "../src/cache.js";
import { MemoryFinance } from "../src/finance.js";
import { buildHome, convert } from "../src/home.js";
import { MemoryMongo } from "../src/mongo.js";
import type { Normalized } from "../src/types.js";

const token = "internal-token";

function appFor(extra: Partial<Parameters<typeof createApp>[0]> = {}) {
  const mongo = new MemoryMongo();
  const finance = new MemoryFinance();
  const queued: { task: string; queue: string }[] = [];
  const identity = new MemoryIdentity();
  const gmail: GmailClient = {
    async exchangeCode() {
      return { refresh_token: "refresh", access_token: "access", email: "a@b.c" };
    },
    async listMessages() {
      return [{ id: "m1", text: "debited", subject: "alert" }];
    },
    async watch() {
      return { history_id: "10", expiration: "999" };
    },
    async refresh() {
      return { access_token: "renewed" };
    },
  };
  const app = createApp({
    verifier: { async verify(value) { if (value !== "good") throw new AuthError(401, "unauthorized"); return { subject: "user-1", email: "a@b.c" }; } },
    identity,
    mongo,
    finance,
    intelligence: { async normalize() { return empty(); } },
    aa: null,
    keys: null,
    gmail,
    gmailClientId: "gmail-client",
    gmailTokenKey: "gmail-key",
    webhookSecret: "aa",
    objects: new Map(),
    internalToken: token,
    queue: {
      async enqueue(input) {
        queued.push({ task: input.task, queue: input.queue });
      },
    },
    ...extra,
  });
  return { app, mongo, finance, queued, gmail };
}

test("mobile import initiate complete status enqueues intake.record", async () => {
  const objects = new Map<string, Buffer>();
  const { app, mongo, queued } = appFor({
    objects,
    extractor: { async extractPdf() { return "debited Rs 10 via UPI/SWIGGY"; } },
  });
  const created = await app.inject({
    method: "POST",
    url: "/v1/imports",
    headers: {
      authorization: "Bearer good",
      "content-type": "application/json",
      "idempotency-key": "mobile-idem-1",
    },
    payload: {
      file_type: "PDF",
      byte_size: 32,
      sha256: "deadbeef",
      original_filename: "hdfc.pdf",
    },
  });
  assert.equal(created.statusCode, 201);
  const importId = created.json().data.import_id as string;
  const objectKey = created.json().data.object_key as string;
  assert.ok(importId);
  assert.ok(objectKey.startsWith("pdf/"));
  assert.equal(created.json().data.declared_mime_type, "application/pdf");
  assert.ok(created.json().data.upload.url);

  objects.set(objectKey, Buffer.from("%PDF-mobile-bytes"));
  const completed = await app.inject({
    method: "POST",
    url: `/v1/imports/${importId}/complete`,
    headers: { authorization: "Bearer good", "content-type": "application/json", "idempotency-key": "mobile-complete-1" },
    payload: {},
  });
  assert.equal(completed.statusCode, 200);
  assert.deepEqual(queued, [{ task: "intake.record", queue: "intake" }]);
  assert.equal(mongo.records.size, 1);

  const status = await app.inject({
    method: "GET",
    url: `/v1/imports/${importId}/status`,
    headers: { authorization: "Bearer good" },
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().data.import_id, importId);
  assert.equal(status.json().data.stage, "Processing");
  assert.equal(status.json().data.parser_eligible, false);
});

test("mobile import complete waits for password then open unlocks", async () => {
  const objects = new Map<string, Buffer>();
  let attempts = 0;
  const { app, queued } = appFor({
    objects,
    extractor: {
      async extractPdf(_bytes, password) {
        attempts += 1;
        if (!password) throw new ExtractError("PASSWORD_REQUIRED");
        if (password !== "secret") throw new ExtractError("PASSWORD_REJECTED");
        return "debited Rs 99 via UPI/CAFE";
      },
    },
  });
  const created = await app.inject({
    method: "POST",
    url: "/v1/imports",
    headers: {
      authorization: "Bearer good",
      "content-type": "application/json",
      "idempotency-key": "mobile-pw-1",
    },
    payload: { file_type: "PDF", byte_size: 8, sha256: "aa", original_filename: "locked.pdf" },
  });
  const importId = created.json().data.import_id as string;
  objects.set(created.json().data.object_key, Buffer.from("%PDF-locked"));

  const completed = await app.inject({
    method: "POST",
    url: `/v1/imports/${importId}/complete`,
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    payload: {},
  });
  assert.equal(completed.statusCode, 200);
  assert.equal(queued.length, 0);

  const waiting = await app.inject({
    method: "GET",
    url: `/v1/imports/${importId}/status`,
    headers: { authorization: "Bearer good" },
  });
  assert.equal(waiting.json().data.parser_eligible, true);
  assert.equal(waiting.json().data.extraction_failure, "WAITING_FOR_PASSWORD");

  const pending = await app.inject({
    method: "GET",
    url: "/v1/imports/pending-unlock",
    headers: { authorization: "Bearer good" },
  });
  assert.equal(pending.statusCode, 200);
  assert.equal(pending.json().imports.length, 1);

  const opened = await app.inject({
    method: "POST",
    url: `/v1/imports/${importId}/open`,
    headers: { authorization: "Bearer good", "content-type": "application/json", "idempotency-key": "open-1" },
    payload: { statement_password: "secret" },
  });
  assert.equal(opened.statusCode, 200);
  assert.ok(attempts >= 2);
  assert.deepEqual(queued, [{ task: "intake.record", queue: "intake" }]);
});

test("a pdf insert enqueues intake and apply writes one ledger row", async () => {
  const { app, mongo, finance, queued } = appFor();
  const created = await app.inject({
    method: "POST",
    url: "/v1/imports/complete",
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    payload: { idempotency_key: "k1", raw_text: "debited Rs 10 via UPI/SWIGGY" },
  });
  assert.equal(created.statusCode, 200);
  assert.deepEqual(queued, [{ task: "intake.record", queue: "intake" }]);
  assert.equal(finance.ledger.length, 0);
  const record = [...mongo.records.values()][0];
  const applied = await app.inject({
    method: "POST",
    url: "/v1/internal/apply",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: {
      record,
      normalized: empty("LEDGER", { ledger: [{
        line_no: 1, amount: "10.00", flow: "OUT", channel: "UPI", payment_ref: null,
        raw_narration: "SWIGGY", clean_merchant: "Swiggy", category_id: "FOOD_DINING",
        subcategory_id: "FOOD_DELIVERY", posted_at: "2026-10-19T00:00:00", masked_account: "1111",
        institution: null, currency_code: "INR",
      }] }),
    },
  });
  assert.equal(applied.statusCode, 200);
  assert.equal(applied.json().table, "ledger_transactions");
  assert.deepEqual(queued.filter((item) => item.task === "finance.reconcile"), [{ task: "finance.reconcile", queue: "reconciliation" }]);
  assert.deepEqual(queued.filter((item) => item.task === "human.evaluate"), [{ task: "human.evaluate", queue: "context" }]);
  assert.deepEqual(queued.filter((item) => item.task === "outcomes.reconcile"), [{ task: "outcomes.reconcile", queue: "reconciliation" }]);
  assert.equal(record && mongo.records.get(record._id)?.ingest_status, "ROUTED");
  const denied = await app.inject({
    method: "POST",
    url: "/v1/internal/apply",
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    payload: {},
  });
  assert.equal(denied.statusCode, 401);
});

test("gmail watch push verifies the caller and enqueues history once", async () => {
  const { app, mongo, queued } = appFor({
    gmailPush: { async verify(value) { if (value !== "oidc") throw new Error("unauthorized"); return { subject: "push", email: "push@gserviceaccount.com" }; } },
  });
  const owner = await app.inject({
    method: "POST",
    url: "/v1/gmail/connect/code",
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    payload: { code: "auth-code" },
  });
  assert.equal(owner.statusCode, 200);
  assert.deepEqual(owner.json().backfill_ids, []);
  assert.equal(queued[0]?.task, "gmail.backfill");
  const mailbox = await mongo.findGmailByEmail("a@b.c");
  assert.equal(mailbox?.history_id, "10");
  assert.equal(mailbox?.sealed.startsWith("sealed:"), false);
  const data = Buffer.from(JSON.stringify({ emailAddress: "a@b.c", historyId: "11" })).toString("base64");
  const body = { message: { messageId: "push-1", data } };
  const denied = await app.inject({ method: "POST", url: "/gmail/webhook", headers: { "content-type": "application/json" }, payload: body });
  assert.equal(denied.statusCode, 401);
  const accepted = await app.inject({
    method: "POST",
    url: "/gmail/webhook",
    headers: { authorization: "Bearer oidc", "content-type": "application/json" },
    payload: body,
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(queued.filter((item) => item.task === "gmail.history").length, 1);
  const duplicate = await app.inject({
    method: "POST",
    url: "/gmail/webhook",
    headers: { authorization: "Bearer oidc", "content-type": "application/json" },
    payload: body,
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(queued.filter((item) => item.task === "gmail.history").length, 1);
});

test("an infected pdf is not queued", async () => {
  const objects = new Map<string, Buffer>([["pdf/owner/file", Buffer.from("eicar")]]);
  const { app, mongo, queued } = appFor({
    objects,
    scanner: { async scan() { return "INFECTED"; } },
  });
  const created = await app.inject({
    method: "POST",
    url: "/v1/imports/complete",
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    payload: { idempotency_key: "bad", object_key: "pdf/owner/file", raw_text: "debited Rs 10" },
  });
  assert.equal(created.statusCode, 422);
  assert.equal(created.json().error, "infected");
  assert.equal(mongo.records.size, 0);
  assert.equal(queued.length, 0);
});

test("a pdf without text is extracted and queued", async () => {
  const queued: { task: string }[] = [];
  const { app, mongo } = appFor({
    objects: new Map([["pdf/owner/file", Buffer.from("pdf")]]),
    extractor: { async extractPdf() { return "debited Rs 10 via UPI"; } },
    queue: { async enqueue(input) { queued.push(input); } },
  });
  const created = await app.inject({
    method: "POST",
    url: "/v1/imports/complete",
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    payload: { idempotency_key: "pdf-1", object_key: "pdf/owner/file" },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(mongo.records.size, 1);
  assert.equal([...mongo.records.values()][0]?.payload.raw_text, "debited Rs 10 via UPI");
  assert.equal(queued[0]?.task, "intake.record");
});

test("an encrypted pdf waits for its password", async () => {
  const { app } = appFor({
    objects: new Map([["pdf/owner/file", Buffer.from("pdf")]]),
    extractor: { async extractPdf() { throw new ExtractError("PASSWORD_REQUIRED"); } },
  });
  const created = await app.inject({
    method: "POST",
    url: "/v1/imports/complete",
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    payload: { idempotency_key: "pdf-1", object_key: "pdf/owner/file" },
  });
  assert.equal(created.statusCode, 422);
  assert.equal(created.json().error, "WAITING_FOR_PASSWORD");
});

test("account aggregator starts from gateway credentials and the consent alias", async () => {
  assert.equal(aaClientFromEnv({}), null);
  assert.ok(aaClientFromEnv({ AA_GATEWAY_URL: "https://aa.example", AA_CLIENT_ID: "id", AA_CLIENT_SECRET: "secret" }));
  const { app } = appFor({ aa: null });
  const denied = await app.inject({
    method: "POST",
    url: "/v1/aa/consent",
    headers: { authorization: "Bearer good" },
  });
  assert.equal(denied.statusCode, 503);
  assert.equal(denied.json().error, "AA_UNAVAILABLE");
});

test("home snapshot converts with the fx table and then serves the cache", async () => {
  const snapshots = memorySnapshots();
  const { app, finance } = appFor({ snapshots });
  await finance.upsertFx("2026-10-16", [
    { base_code: "EUR", quote_code: "USD", rate: "1.08", source: "ECB" },
    { base_code: "EUR", quote_code: "INR", rate: "90.00", source: "ECB" },
  ]);
  await finance.apply("owner-1", "mongo-1", empty("LEDGER", { ledger: [{
    line_no: 1, amount: "90.00", flow: "OUT", channel: "UPI", payment_ref: null,
    raw_narration: "SWIGGY", clean_merchant: "Swiggy", category_id: "FOOD_DINING",
    subcategory_id: "FOOD_DELIVERY", posted_at: "2026-10-19T00:00:00", masked_account: "1111",
    institution: null, currency_code: "INR",
  }] }));
  const snapshot = await buildHome(finance, "owner-1", "USD");
  const row = snapshot.transactions[0] as { display_amount: string; currency_code: string };
  assert.equal(row.currency_code, "INR");
  assert.equal(row.display_amount, "1.08");
  assert.equal(convert("90.00", "INR", "USD", new Map([["USD", 1.08], ["INR", 90]])), "1.08");
  const first = await app.inject({ method: "GET", url: "/v1/home", headers: { authorization: "Bearer good" } });
  finance.ledger.push({ ...finance.ledger[0], owner_id: "other" });
  const second = await app.inject({ method: "GET", url: "/v1/home", headers: { authorization: "Bearer good" } });
  assert.deepEqual(second.json(), first.json());
});

test("eligibility ignores own-account transfers and fees, and a replacement keeps the inference", async () => {
  const { app, mongo, finance } = appFor();
  await app.inject({
    method: "POST",
    url: "/v1/imports/complete",
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    payload: { idempotency_key: "human", raw_text: "debited Rs 10" },
  });
  const record = [...mongo.records.values()][0];
  assert.ok(record);
  const applied = await app.inject({
    method: "POST",
    url: "/v1/internal/apply",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: {
      record,
      normalized: empty("LEDGER", { ledger: [
        ledgerRow("Swiggy", "FOOD_DINING", "FOOD_DELIVERY", "350.00", "debited Rs 350 via UPI SWIGGY", "1111"),
        ledgerRow("Foreign Exchange Fee", "BANK_FEES", "FOREX_MARKUP", "8.40", "FCY MARK UP FEE", "1111", 2, "FCY_MARKUP"),
        ledgerRow("Savings", "TRANSFER", "PEER_TO_PEER", "1000.00", "IMPS to 2222 debited Rs 1000.00", "1111", 3),
      ] }),
    },
  });
  assert.equal(applied.statusCode, 200);
  finance.accounts.push({ id: "acct-2222", owner_id: record.owner_id, masked_account: "2222" });
  const pending = await app.inject({
    method: "POST",
    url: "/v1/internal/human/pending",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: { owner_id: record.owner_id },
  });
  assert.equal(pending.statusCode, 200);
  const facts = pending.json().transactions as { transaction_id: string; clean_merchant: string; channel: string }[];
  const swiggy = finance.ledger.find((row) => row.clean_merchant === "Swiggy");
  const fee = finance.ledger.find((row) => row.clean_merchant === "Foreign Exchange Fee");
  const transfer = finance.ledger.find((row) => row.clean_merchant === "Savings");
  assert.ok(swiggy && fee && transfer);
  assert.equal(facts.find((item) => item.transaction_id === transfer.id)?.channel, "OWN_ACCOUNT_TRANSFER");
  assert.equal(transfer.channel, "OWN_ACCOUNT_TRANSFER");
  const stored = await app.inject({
    method: "POST",
    url: "/v1/internal/apply-human-context",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: contextResult(swiggy.id, record.owner_id, "WEIGHT", ["W02_COMFORT", "W08_ATTENTION"]),
  });
  assert.equal(stored.statusCode, 200);
  await app.inject({
    method: "POST",
    url: "/v1/internal/apply-human-context",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: contextResult(fee.id, record.owner_id, "IGNORE", []),
  });
  await app.inject({
    method: "POST",
    url: "/v1/internal/apply-human-context",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: contextResult(transfer.id, record.owner_id, "IGNORE", []),
  });
  assert.equal(finance.eligibility.find((item) => item.transaction_id === swiggy.id)?.state, "WEIGHT");
  assert.deepEqual(
    finance.associations.filter((item) => item.target_id === swiggy.id && item.is_effective).map((item) => item.weight_code).sort(),
    ["W02_COMFORT", "W08_ATTENTION"],
  );
  assert.equal(finance.associations.filter((item) => item.target_id === fee.id).length, 0);
  assert.equal(finance.eligibility.find((item) => item.transaction_id === transfer.id)?.state, "IGNORE");
  const replaced = await app.inject({
    method: "POST",
    url: `/v1/transactions/${swiggy.id}/weights`,
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    payload: {
      weight_code: "W02_COMFORT",
      action: "REPLACED",
      replaced_weight_code: "W05_IDENTITY",
      client_idempotency_key: "replace-1",
    },
  });
  assert.equal(replaced.statusCode, 200);
  assert.equal(finance.inferences.find((item) => item.transaction_id === swiggy.id)?.primary_inferred_weight, "W02_COMFORT");
  const context = await app.inject({
    method: "GET",
    url: `/v1/transactions/${swiggy.id}/context`,
    headers: { authorization: "Bearer good" },
  });
  assert.equal(context.statusCode, 200);
  const weights = context.json().effective_weights as { code: string; source: string }[];
  assert.equal(weights.find((item) => item.code === "W05_IDENTITY")?.source, "USER_FEEDBACK");
  assert.equal(weights.some((item) => item.code === "W02_COMFORT"), false);
});

test("a promote row enqueues decision ranking and the ui lists the candidate", async () => {
  const { app, mongo, finance, queued } = appFor();
  await app.inject({
    method: "POST",
    url: "/v1/imports/complete",
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    payload: { idempotency_key: "decide", raw_text: "debited Rs 10" },
  });
  const record = [...mongo.records.values()][0];
  assert.ok(record);
  await app.inject({
    method: "POST",
    url: "/v1/internal/apply",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: {
      record,
      normalized: empty("LEDGER", {
        ledger: [ledgerRow("Amazon", "SHOPPING_RETAIL", "ECOMMERCE", "15000.00", "VISA ECOM AMAZON", "3333")],
      }),
    },
  });
  const amazon = finance.ledger.find((row) => row.clean_merchant === "Amazon");
  assert.ok(amazon);
  const promote = await app.inject({
    method: "POST",
    url: "/v1/internal/apply-human-context",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: contextResult(amazon.id, record.owner_id, "PROMOTE", ["W02_COMFORT"]),
  });
  assert.equal(promote.statusCode, 200);
  assert.deepEqual(
    queued.filter((item) => item.task === "decision.evaluate"),
    [{ task: "decision.evaluate", queue: "decisions" }],
  );
  const candidate = {
    decision_family_code: "D10",
    display_name: "Expense Spike Review",
    decision_group: "CASHFLOW",
    base_weight_fit: 1.2,
    urgency_multiplier: 1.1,
    confidence_multiplier: 0.95,
    context_modifier: 1.0,
    decision_score: 1.254,
    priority_band: "MODERATE",
    trigger_summary: { source_transaction_id: amazon.id, amount: 15000, clean_merchant: "Amazon" },
    option_set: [{ id: "OPT_1", label: "Weigh trade-off", action: "CONSIDER" }],
  };
  const first = await app.inject({
    method: "POST",
    url: "/v1/internal/apply-decision-evaluation",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: {
      owner_id: record.owner_id,
      transaction_id: amazon.id,
      top_candidate: candidate,
      evaluation_meta: { idempotency_key: `dec_eval:${amazon.id}:D10` },
    },
  });
  assert.equal(first.statusCode, 200);
  const second = await app.inject({
    method: "POST",
    url: "/v1/internal/apply-decision-evaluation",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: {
      owner_id: record.owner_id,
      transaction_id: amazon.id,
      top_candidate: { ...candidate, decision_score: 1.5, priority_band: "HIGH" },
      evaluation_meta: { idempotency_key: `dec_eval:${amazon.id}:D10` },
    },
  });
  assert.equal(second.statusCode, 200);
  assert.equal(finance.decisions.length, 1);
  assert.equal(finance.decisions[0]?.current_priority_band, "HIGH");
  const listed = await app.inject({
    method: "GET",
    url: "/v1/ui/decisions",
    headers: { authorization: "Bearer good" },
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().meta.api_version, "v1.2");
  assert.equal(listed.json().data.empty_state, false);
  assert.equal(listed.json().data.heaviest_decision.decision_family_code, "D10");
});

test("accepting a decision spawns a mission; snooze and reminder update expiry", async () => {
  const finance = new MemoryFinance();
  const identity = new MemoryIdentity();
  const ownerId = "owner-missions";
  const actor = await identity.provisionActor("user-1");
  identity.membership.add(`${actor}:${ownerId}`);
  finance.decisions.push({
    decision_id: "dec-1",
    owner_id: ownerId,
    decision_family_code: "D10",
    title: "Expense Spike Review",
    state: "CANDIDATE",
    current_rank: 1,
    current_priority_band: "HIGH",
    trigger_summary: {},
    option_set: [],
    decision_score: 1.8,
    idempotency_key: "decision_instance:dec_eval:txn:D10",
  });
  const { app } = appFor({ identity, finance });
  const ownerHeaders = {
    authorization: "Bearer good",
    "content-type": "application/json",
    "x-monytix-owner-id": ownerId,
  };

  const missingRemind = await app.inject({
    method: "POST",
    url: "/v1/decisions/dec-1/actions",
    headers: ownerHeaders,
    payload: { action: "SET_REMINDER" },
  });
  assert.equal(missingRemind.statusCode, 400);

  const accept = await app.inject({
    method: "POST",
    url: "/v1/decisions/dec-1/actions",
    headers: { ...ownerHeaders, "idempotency-key": "act-accept-1" },
    payload: { action: "ACCEPT", selected_option_id: "OPT_1" },
  });
  assert.equal(accept.statusCode, 200);
  assert.equal(accept.json().data.current_state, "SELECTED");
  assert.equal(accept.json().data.mission_code, "M30");
  assert.ok(accept.json().data.linked_mission_id);
  assert.equal(finance.missions.length, 1);
  assert.equal(finance.decisionTransitions.length, 1);

  const again = await app.inject({
    method: "POST",
    url: "/v1/decisions/dec-1/actions",
    headers: { ...ownerHeaders, "idempotency-key": "act-accept-1" },
    payload: { action: "ACCEPT" },
  });
  assert.equal(again.statusCode, 200);
  assert.equal(finance.decisionTransitions.length, 1);
  assert.equal(finance.missions.length, 1);

  const missions = await app.inject({
    method: "GET",
    url: "/v1/ui/missions",
    headers: { authorization: "Bearer good", "x-monytix-owner-id": ownerId },
  });
  assert.equal(missions.statusCode, 200);
  assert.equal(missions.json().meta.api_version, "v1.2");
  assert.equal(missions.json().data.active_missions.length, 1);
  assert.equal(missions.json().data.active_missions[0].canonical_code, "M30");

  finance.decisions.push({
    decision_id: "dec-2",
    owner_id: ownerId,
    decision_family_code: "D1",
    title: "Emergency Fund Allocation",
    state: "CANDIDATE",
    current_rank: 1,
    current_priority_band: "MODERATE",
    trigger_summary: {},
    option_set: [],
    decision_score: 1.5,
    idempotency_key: "decision_instance:dec_eval:txn2:D1",
  });
  const snooze = await app.inject({
    method: "POST",
    url: "/v1/decisions/dec-2/actions",
    headers: { ...ownerHeaders, "idempotency-key": "act-snooze-1" },
    payload: { action: "SNOOZE" },
  });
  assert.equal(snooze.statusCode, 200);
  assert.equal(snooze.json().data.current_state, "PRESENTED");
  assert.equal(snooze.json().data.linked_mission_id, null);
  assert.ok(finance.decisions.find((item) => item.decision_id === "dec-2")?.expires_at);

  const hiddenWhileSnoozed = await app.inject({
    method: "GET",
    url: "/v1/ui/decisions",
    headers: { authorization: "Bearer good", "x-monytix-owner-id": ownerId },
  });
  assert.equal(hiddenWhileSnoozed.statusCode, 200);
  assert.equal(
    (hiddenWhileSnoozed.json().data.upcoming_decisions || []).some(
      (item: { decision_id: string }) => item.decision_id === "dec-2",
    ),
    false,
  );

  const remindAt = "2026-11-01T10:00:00.000Z";
  const remind = await app.inject({
    method: "POST",
    url: "/v1/decisions/dec-2/actions",
    headers: { ...ownerHeaders, "idempotency-key": "act-remind-1" },
    payload: { action: "SET_REMINDER", remind_at: remindAt },
  });
  assert.equal(remind.statusCode, 200);
  assert.equal(finance.decisions.find((item) => item.decision_id === "dec-2")?.expires_at, remindAt);

  finance.decisions.find((item) => item.decision_id === "dec-2")!.expires_at = "2020-01-01T00:00:00.000Z";
  const swept = await app.inject({
    method: "POST",
    url: "/v1/internal/decisions/sweep-expired",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: { owner_id: ownerId },
  });
  assert.equal(swept.statusCode, 200);
  assert.equal(swept.json().swept, 1);
  assert.equal(finance.decisions.find((item) => item.decision_id === "dec-2")?.expires_at, null);
});

function contextResult(id: string, ownerId: string, state: string, weights: string[]) {
  const reason =
    state === "IGNORE" ? "SYSTEM_FEE_OR_TAX" : state === "PROMOTE" ? "HIGH_MAGNITUDE_OUTFLOW" : "DISCRETIONARY_CANDIDATE";
  return {
    transaction_id: id,
    owner_id: ownerId,
    eligibility: { state, reason_code: reason, evidence: {} },
    inference_run: weights.length === 0 ? null : {
      primary_inferred_weight: weights[0],
      secondary_inferred_weight: weights[1] ?? null,
      confidence_score: 0.95,
      rule_id: "R_COMFORT_DINING",
      model_version: "f10_rulebook_v1.2",
    },
    weight_associations: weights.map((code, index) => ({ weight_code: code, is_primary: index === 0, intensity: index === 0 ? 1 : 0.6 })),
  };
}

function ledgerRow(
  merchant: string,
  category: string,
  subcategory: string,
  amount: string,
  narration: string,
  mask: string,
  line = 1,
  fee: "BASE" | "FCY_MARKUP" | "GST_TAX" = "BASE",
) {
  return {
    line_no: line, amount, flow: "OUT" as const, channel: "UPI", payment_ref: null,
    raw_narration: narration, clean_merchant: merchant, category_id: category,
    subcategory_id: subcategory, fee_role: fee, posted_at: "2026-10-19T00:00:00", masked_account: mask,
    institution: null, currency_code: "INR",
  };
}

function empty(domain: Normalized["domain"] = "LEDGER", extra: Partial<Normalized> = {}): Normalized {
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
