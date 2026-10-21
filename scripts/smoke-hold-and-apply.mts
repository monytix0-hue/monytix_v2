import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { AuthError, MemoryIdentity, createApp } from "../backend-monytix/api/src/app.js";
import { MemoryFinance } from "../backend-monytix/api/src/finance.js";
import { httpIntelligence } from "../backend-monytix/api/src/http-intelligence.js";
import { MemoryMongo } from "../backend-monytix/api/src/mongo.js";
import { buildApp } from "../services/api/src/app.js";

const token = process.env.INTERNAL_TOKEN?.trim();
if (!token) throw new Error("INTERNAL_TOKEN required");
const password = process.env.STATEMENT_PASSWORD?.trim();
if (!password) throw new Error("STATEMENT_PASSWORD required");

const intelligence = httpIntelligence(process.env.INTELLIGENCE_URL || "http://127.0.0.1:8091", token);
const identity = new MemoryIdentity();
const ownerId = "11111111-1111-4111-8111-111111111111";
const actorId = await identity.provisionActor("smoke-user", "smoke@monytix.test");
identity.membership.add(`${actorId}:${ownerId}`);
const finance = new MemoryFinance();
const mongo = new MemoryMongo();
const smokeBearer = "smoke-e2e-token";

const financeApp = createApp({
  verifier: {
    async verify(v) {
      if (v !== smokeBearer) throw new AuthError(401, "unauthorized");
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

financeApp.addHook("onError", async (request, _reply, error) => {
  if (request.url.startsWith("/v1/internal/apply")) {
    console.error("APPLY_ON_ERROR", error);
  }
});
financeApp.addHook("onResponse", async (request, reply) => {
  if (request.url.startsWith("/v1/internal/apply")) {
    console.log("APPLY_RESPONSE", reply.statusCode);
  }
});

await financeApp.listen({ port: 8090, host: "127.0.0.1" });
const gateway = await buildApp({
  logger: false,
  financeBackendUrl: "http://127.0.0.1:8090",
  auth: {
    configured: true,
    verify: async (v) => {
      if (v !== smokeBearer) throw Object.assign(new Error("unauthorized"), { code: "unauthorized" });
      return { subject: "smoke-user", email: "smoke@monytix.test", authTime: 1 };
    },
  },
  identity: {
    async provisionActor() {
      return { actorId };
    },
    async resolveOwner(_a, r) {
      return r || ownerId;
    },
    async ping() {},
    async close() {},
  },
});
await gateway.listen({ port: 8080, host: "127.0.0.1" });
console.log("HOLD_READY");

const pdf = readFileSync(new URL("../Acct Statement_6544_13092026_14.31.29.pdf", import.meta.url));
const headers = { authorization: `Bearer ${smokeBearer}`, "x-monytix-owner-id": ownerId };
const created = await fetch("http://127.0.0.1:8080/v1/imports", {
  method: "POST",
  headers: { ...headers, "content-type": "application/json", "idempotency-key": randomUUID() },
  body: JSON.stringify({
    file_type: "PDF",
    byte_size: pdf.length,
    sha256: createHash("sha256").update(pdf).digest("hex"),
    original_filename: "stmt.pdf",
  }),
});
const createdBody = await created.json();
const importId = createdBody.data.import_id as string;
const objectKey = createdBody.data.object_key as string;
await fetch("http://127.0.0.1:8090/v1/imports/bytes", {
  method: "PUT",
  headers: { ...headers, "content-type": "application/octet-stream", "x-object-key": objectKey },
  body: pdf,
});
await fetch(`http://127.0.0.1:8080/v1/imports/${importId}/complete`, {
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: "{}",
});
const opened = await fetch(`http://127.0.0.1:8080/v1/imports/${importId}/open`, {
  method: "POST",
  headers: { ...headers, "content-type": "application/json", "idempotency-key": randomUUID() },
  body: JSON.stringify({ statement_password: password }),
});
console.log("OPEN", opened.status, await opened.text());

for (let i = 0; i < 45; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  console.log(`tick ${i} ledger=${finance.ledger.length} decisions=${finance.decisions.length} mongo=${mongo.records.size}`);
  if (finance.ledger.length > 0) {
    const d = await fetch("http://127.0.0.1:8080/v1/ui/decisions", { headers });
    console.log("DECISIONS", (await d.text()).slice(0, 800));
    break;
  }
}

console.log(JSON.stringify({ ledger: finance.ledger.length, decisions: finance.decisions.length }, null, 2));
await gateway.close();
await financeApp.close();
