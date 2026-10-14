import assert from "node:assert/strict";
import { generateKeyPair, exportSPKI, SignJWT } from "jose";
import test from "node:test";
import { buildApp, redactedPaths } from "../src/app.js";
import { MemoryGmailStore } from "../src/gmail/store.js";
import { verifyGoogleOidc } from "../src/gmail/oidc.js";
import { readFileSync } from "node:fs";

const audience = "https://api.monytix.ai/gmail/webhook";
const serviceAccount = "gmail-pubsub-worker@momentra-v2.iam.gserviceaccount.com";

test("webhook stores a verified notification once and does not read the mailbox", async () => {
  const keys = await generateKeyPair("RS256");
  const publicKeyPem = await exportSPKI(keys.publicKey);
  const store = new MemoryGmailStore();
  const connection = store.insertConnection({
    ownerId: "owner-a",
    sourceConnectionId: "00000000-0000-4000-8000-000000000001",
    mailboxAddress: "owner@example.com",
    credentialRef: "projects/monytix/secrets/gmail-owner-a",
  });
  store.recordNotification({
    ownerId: connection.ownerId,
    gmailConnectionId: connection.gmailConnectionId,
    pubsubMessageId: "baseline",
    historyId: "10",
  });
  const app = await buildApp({
    logger: false,
    auth: { configured: true, verify: async () => { throw new Error("firebase"); } },
    gmail: {
      store,
      audience,
      allowUnauthenticated: false,
      verify: (token) => verifyGoogleOidc(token, { audience, publicKeyPem, serviceAccountEmail: serviceAccount }),
    },
  });
  try {
    const token = await sign(keys.privateKey, { audience, email: serviceAccount });
    const stored = await app.inject({
      method: "POST",
      url: "/gmail/webhook",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: envelope("msg-1", "owner@example.com", "15"),
    });
    assert.equal(stored.statusCode, 204);
    assert.equal(store.notificationForOwner("owner-a", "msg-1")?.disposition, "QUEUED");
    assert.equal(store.notificationForOwner("owner-b", "msg-1"), null);

    const duplicate = await app.inject({
      method: "POST",
      url: "/gmail/webhook",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: envelope("msg-1", "owner@example.com", "15"),
    });
    assert.equal(duplicate.statusCode, 204);
    assert.equal(store.notificationForOwner("owner-a", "msg-1")?.disposition, "QUEUED");

    const older = await app.inject({
      method: "POST",
      url: "/gmail/webhook",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: envelope("msg-2", "owner@example.com", "12"),
    });
    assert.equal(older.statusCode, 204);
    assert.equal(store.notificationForOwner("owner-a", "msg-2")?.disposition, "OUT_OF_ORDER");

    const wrongAudience = await sign(keys.privateKey, { audience: "https://example.invalid", email: serviceAccount });
    const rejected = await app.inject({
      method: "POST",
      url: "/gmail/webhook",
      headers: { authorization: `Bearer ${wrongAudience}`, "content-type": "application/json" },
      payload: envelope("msg-3", "owner@example.com", "20"),
    });
    assert.equal(rejected.statusCode, 401);
    assert.equal(store.notificationForOwner("owner-a", "msg-3"), null);

    const otherKeys = await generateKeyPair("RS256");
    const forged = await sign(otherKeys.privateKey, { audience, email: serviceAccount });
    const invalid = await app.inject({
      method: "POST",
      url: "/gmail/webhook",
      headers: { authorization: `Bearer ${forged}`, "content-type": "application/json" },
      payload: envelope("msg-4", "owner@example.com", "21"),
    });
    assert.equal(invalid.statusCode, 401);
  } finally {
    await app.close();
  }
  const source = readFileSync(new URL("../src/gmail/webhook.ts", import.meta.url), "utf8");
  assert.equal(source.includes("listHistory"), false);
  assert.equal(source.includes("messages.get"), false);
});

test("logs and credential references exclude mailbox secrets", () => {
  assert.equal(redactedPaths.includes("*.credential_ref"), true);
  assert.equal(redactedPaths.includes("*.messageBody"), true);
  assert.throws(() => new MemoryGmailStore().insertConnection({
    ownerId: "owner-a",
    sourceConnectionId: "00000000-0000-4000-8000-000000000001",
    mailboxAddress: "owner@example.com",
    credentialRef: "ya29.refresh_token",
  }));
  const gmailSource = readFileSync(new URL("../src/gmail/pg-store.ts", import.meta.url), "utf8")
    + readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.equal(gmailSource.includes("GMAIL_PUBSUB_CREDENTIALS"), false);
  assert.equal(gmailSource.includes("googleapis"), false);
});

async function sign(key: CryptoKey, input: { audience: string; email: string }): Promise<string> {
  return new SignJWT({ email: input.email })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("https://accounts.google.com")
    .setAudience(input.audience)
    .setSubject("pubsub-push")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key);
}

function envelope(messageId: string, emailAddress: string, historyId: string): string {
  return JSON.stringify({
    message: {
      messageId,
      data: Buffer.from(JSON.stringify({ emailAddress, historyId })).toString("base64"),
      publishTime: "2026-10-14T00:00:00Z",
    },
    subscription: "projects/monytix/subscriptions/gmail",
  });
}
