import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { GmailExchangeError } from "../src/gmail/connect.js";
import { MemoryGmailConnectStore } from "../src/gmail/connect-store.js";
import { signToken } from "./auth-fixture.js";

test("a signed-in actor without an owner is given a personal owner", () => {
  const identity = readFileSync(new URL("../src/auth/identity.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../../database/migrations/0024_personal_owner.sql", import.meta.url), "utf8");
  const access = identity.indexOf("actor_can_access_owner");
  const existing = identity.indexOf("default_owner_for_actor");
  const ensure = identity.indexOf("ensure_personal_owner");
  assert.ok(access > 0 && access < existing && existing < ensure);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /'PERSON'/);
  assert.match(migration, /is_default_owner/);
});

test("gmail connect returns an authorize url and stores a sealed credential", async () => {
  const signed = await signToken({ subject: "user-1", expiresIn: "1h" });
  const store = new MemoryGmailConnectStore();
  const refreshToken = "1//mailbox-credential";
  let exchanges = 0;
  signed.options.identity = {
    async provisionActor() {
      return { actorId: "actor-1" };
    },
    async resolveOwner() {
      return "owner-1";
    },
    async ping() {},
    async close() {},
  };
  signed.options.gmailConnect = {
    store,
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://api.monytix.ai/gmail/oauth/callback",
    tokenUri: "https://oauth.example/token",
    encryptionKey: "test-key",
    exchange: async () => {
      exchanges += 1;
      return { refreshToken, email: "Owner@Example.com" };
    },
  };
  const app = await buildApp(signed.options);
  const start = await app.inject({
    method: "GET",
    url: "/gmail/oauth/start",
    headers: { authorization: `Bearer ${signed.token}` },
  });
  assert.equal(start.statusCode, 200);
  assert.equal(start.json().server_client_id, "client-id");
  assert.equal(JSON.stringify(start.json()).includes("client-secret"), false);
  const url = new URL(start.json().url as string);
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.toString().includes("client-secret"), false);
  const state = url.searchParams.get("state") ?? "";
  const callback = await app.inject({
    method: "GET",
    url: `/gmail/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
  });
  assert.equal(callback.statusCode, 302);
  assert.equal(callback.headers.location, "monytix://gmail/connected");
  assert.equal(String(callback.headers.location).includes(refreshToken), false);
  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0]?.mailbox, "owner@example.com");
  assert.match(store.saved[0]?.credentialRef ?? "", /^gmail-oauth:/);
  assert.equal(store.saved[0]?.ciphertext.includes(refreshToken), false);
  const reused = await app.inject({
    method: "GET",
    url: `/gmail/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
  });
  assert.equal(reused.statusCode, 302);
  assert.match(String(reused.headers.location), /error=state/);
  assert.equal(exchanges, 1);
  const posted = await app.inject({
    method: "POST",
    url: "/v1/gmail/connect",
    headers: { authorization: `Bearer ${signed.token}` },
    payload: {},
  });
  assert.equal(posted.statusCode, 200);
  const postedUrl = new URL(posted.json().authorization_url as string);
  assert.equal(postedUrl.searchParams.get("client_id"), "client-id");
  assert.equal(postedUrl.toString().includes("client-secret"), false);
  await app.close();
});

test("an in-app account code is sealed without the browser redirect", async () => {
  const signed = await signToken({ subject: "user-1", expiresIn: "1h" });
  const store = new MemoryGmailConnectStore();
  const refreshToken = "1//mailbox-credential";
  let redirectUri = "unset";
  signed.options.identity = {
    async provisionActor() {
      return { actorId: "actor-1" };
    },
    async resolveOwner() {
      return "owner-1";
    },
    async ping() {},
    async close() {},
  };
  signed.options.gmailConnect = {
    store,
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://api.monytix.ai/gmail/oauth/callback",
    tokenUri: "https://oauth.example/token",
    encryptionKey: "test-key",
    exchange: async (input) => {
      redirectUri = input.redirectUri;
      if (input.code === "missing-refresh") {
        throw new GmailExchangeError("refresh_token");
      }
      return { refreshToken, email: "Owner@Example.com" };
    },
  };
  const app = await buildApp(signed.options);
  const headers = { authorization: `Bearer ${signed.token}` };
  const blank = await app.inject({
    method: "POST",
    url: "/v1/gmail/connect/code",
    headers,
    payload: {},
  });
  assert.equal(blank.statusCode, 400);
  assert.equal(blank.json().error, "invalid_request");
  const saved = await app.inject({
    method: "POST",
    url: "/v1/gmail/connect/code",
    headers,
    payload: { code: "server-auth-code" },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().connected, true);
  assert.equal(JSON.stringify(saved.json()).includes(refreshToken), false);
  assert.equal(redirectUri, "");
  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0]?.mailbox, "owner@example.com");
  assert.equal(store.saved[0]?.ciphertext.includes(refreshToken), false);
  const rejected = await app.inject({
    method: "POST",
    url: "/v1/gmail/connect/code",
    headers,
    payload: { code: "missing-refresh" },
  });
  assert.equal(rejected.statusCode, 422);
  assert.equal(rejected.json().error, "refresh_token");
  assert.equal(store.saved.length, 1);
  await app.close();
});

test("connect registers a mailbox watch when a pubsub topic is configured", async () => {
  const signed = await signToken({ subject: "user-1", expiresIn: "1h" });
  const store = new MemoryGmailConnectStore();
  let watched: { accessToken: string; topic: string } | null = null;
  signed.options.identity = {
    async provisionActor() {
      return { actorId: "actor-1" };
    },
    async resolveOwner() {
      return "owner-1";
    },
    async ping() {},
    async close() {},
  };
  signed.options.gmailConnect = {
    store,
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://api.monytix.ai/gmail/oauth/callback",
    tokenUri: "https://oauth.example/token",
    encryptionKey: "test-key",
    pubsubTopic: "projects/demo/topics/gmail-txns",
    exchange: async () => ({
      refreshToken: "1//mailbox-credential",
      email: "Owner@Example.com",
      accessToken: "ya29.access",
    }),
    watch: async (input) => {
      watched = input;
      return { expiresAt: "2026-10-25T00:00:00.000Z" };
    },
  };
  const app = await buildApp(signed.options);
  const saved = await app.inject({
    method: "POST",
    url: "/v1/gmail/connect/code",
    headers: { authorization: `Bearer ${signed.token}` },
    payload: { code: "server-auth-code" },
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(watched, { accessToken: "ya29.access", topic: "projects/demo/topics/gmail-txns" });
  assert.equal(store.saved[0]?.watchExpiresAt, "2026-10-25T00:00:00.000Z");
  assert.equal(JSON.stringify(saved.json()).includes("ya29.access"), false);
  await app.close();
});
