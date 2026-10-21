import { aaClientFromEnv } from "./aa.js";
import { createApp, type AaClient, type GmailClient } from "./app.js";
import { openSnapshotCache } from "./cache.js";
import { databaseUrl, loadRepoEnv } from "./env.js";
import { createFirebaseVerifier } from "./firebase.js";
import { MemoryFinance } from "./finance.js";
import { httpIntelligence } from "./http-intelligence.js";
import { MemoryMongo } from "./mongo.js";
import { openMongo } from "./mongo-db.js";
import { verifyGoogleOidc } from "./oidc.js";
import { PgFinance } from "./pg-finance.js";
import { PgIdentity } from "./pg-identity.js";
import { openPool } from "./pool.js";
import { clamScanner } from "./scan.js";
import { createObjectStore, storageConfigFromEnv } from "./storage.js";

loadRepoEnv();

const token = process.env.INTERNAL_TOKEN ?? "";
const intelligence = httpIntelligence(process.env.INTELLIGENCE_URL ?? "http://127.0.0.1:8091", token);
const url = databaseUrl();
const pool = url ? openPool(url) : null;
const finance = pool ? new PgFinance(pool) : new MemoryFinance();
const mongo = process.env.MONGO_URL
  ? await openMongo(process.env.MONGO_URL, process.env.MONGO_DB ?? "monytix_raw")
  : new MemoryMongo();
const verifier = await createFirebaseVerifier(process.env);
const identity = pool ? new PgIdentity(pool) : null;
const storageConfig = storageConfigFromEnv();
const gmail = gmailFromEnv();
const audience = process.env.GMAIL_PUBSUB_AUDIENCE?.trim() ?? "";
const clamHost = process.env.CLAMAV_HOST?.trim() ?? "";
const redisUrl = process.env.REDIS_URL?.trim() ?? "";

const app = createApp({
  verifier,
  identity,
  mongo,
  finance,
  intelligence,
  aa: aaClientFromEnv(),
  keys: intelligence,
  gmail,
  gmailClientId: process.env.GMAIL_CLIENT_ID?.trim() ?? "",
  gmailRedirectUri: process.env.GMAIL_REDIRECT_URI?.trim() ?? "",
  gmailTokenKey: process.env.GMAIL_TOKEN_ENCRYPTION_KEY?.trim() ?? "",
  webhookSecret: process.env.AA_WEBHOOK_SECRET ?? "",
  objects: new Map(),
  storage: storageConfig ? createObjectStore(storageConfig) : null,
  extractor: token ? intelligence : null,
  queue: token ? intelligence : null,
  internalToken: token,
  scanner: clamHost ? clamScanner(clamHost, Number(process.env.CLAMAV_PORT ?? 3310)) : null,
  snapshots: redisUrl ? await openSnapshotCache(redisUrl) : null,
  gmailPush: audience
    ? {
        verify: (pushed) => verifyGoogleOidc(pushed, {
          audience,
          publicKeyPem: process.env.GMAIL_PUBSUB_OIDC_PUBLIC_KEY,
          serviceAccountEmail: process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT,
        }),
      }
    : null,
});

const port = Number(process.env.FINANCE_PORT ?? process.env.PORT ?? 8090);
await app.listen({ port, host: "0.0.0.0" });

function gmailFromEnv(): GmailClient | null {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = process.env.GMAIL_REDIRECT_URI?.trim() ?? "";
  const tokenUri = process.env.GMAIL_TOKEN_URI?.trim() || "https://oauth2.googleapis.com/token";
  if (!clientId || !clientSecret || !redirectUri) return null;
  return {
    async exchangeCode(code: string) {
      const response = await fetch(tokenUri, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!response.ok) throw new Error("gmail_exchange_failed");
      const body = await response.json() as { refresh_token?: string; access_token?: string };
      if (!body.refresh_token || !body.access_token) throw new Error("gmail_refresh_missing");
      const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { authorization: `Bearer ${body.access_token}` },
      });
      const mailbox = profile.ok ? await profile.json() as { emailAddress?: string } : {};
      return { refresh_token: body.refresh_token, access_token: body.access_token, email: mailbox.emailAddress ?? "" };
    },
    async watch(accessToken: string) {
      const topic = process.env.GMAIL_PUBSUB_TOPIC?.trim() ?? "";
      if (!topic) throw new Error("gmail_topic_missing");
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ topicName: topic, labelIds: ["INBOX"] }),
      });
      if (!response.ok) throw new Error("gmail_watch_failed");
      const body = await response.json() as { historyId?: string; expiration?: string };
      return { history_id: String(body.historyId ?? "0"), expiration: String(body.expiration ?? "") };
    },
    async refresh(refreshToken: string) {
      const response = await fetch(tokenUri, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
        }),
      });
      if (!response.ok) throw new Error("gmail_refresh_failed");
      const body = await response.json() as { access_token?: string };
      if (!body.access_token) throw new Error("gmail_refresh_failed");
      return { access_token: body.access_token };
    },
    async listMessages(accessToken: string) {
      const after = Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60;
      const listing = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=after:${after}&maxResults=100`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!listing.ok) return [];
      const page = await listing.json() as { messages?: { id: string }[] };
      const rows = [];
      for (const item of page.messages ?? []) {
        const detail = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`, {
          headers: { authorization: `Bearer ${accessToken}` },
        });
        if (!detail.ok) continue;
        const message = await detail.json() as { payload?: { headers?: { name: string; value: string }[]; body?: { data?: string }; parts?: unknown[] } };
        const headers = message.payload?.headers ?? [];
        const subject = headers.find((header) => header.name.toLowerCase() === "subject")?.value ?? "";
        rows.push({ id: item.id, text: subject, subject });
      }
      return rows;
    },
  };
}

export type { AaClient };
