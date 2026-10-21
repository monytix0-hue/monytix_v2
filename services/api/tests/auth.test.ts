import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { anonymousApp, signToken } from "./auth-fixture.js";

test("GET /auth rejects a missing token", async () => {
  const app = await anonymousApp();
  const response = await app.inject({ method: "GET", url: "/auth" });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "unauthorized" });
  await app.close();
});

test("GET /auth fails closed when Firebase is not configured", async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({
    method: "GET",
    url: "/auth",
    headers: { authorization: "Bearer anything" },
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "auth_unconfigured" });
  await app.close();
});

test("GET /auth rejects an expired token", async () => {
  const { token, options } = await signToken({ subject: "user-expired", expiresIn: "-1h" });
  const app = await buildApp(options);
  const response = await app.inject({
    method: "GET",
    url: "/auth",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "unauthorized" });
  await app.close();
});

test("GET /auth rejects a revoked token", async () => {
  const { token, options } = await signToken({
    subject: "user-revoked",
    expiresIn: "1h",
    revokedSubjects: new Set(["user-revoked"]),
  });
  const app = await buildApp(options);
  const response = await app.inject({
    method: "GET",
    url: "/auth",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "revoked" });
  await app.close();
});

test("GET /auth ignores a client-supplied user id", async () => {
  const { token, options } = await signToken({ subject: "user-ok", expiresIn: "1h" });
  const app = await buildApp(options);
  const response = await app.inject({
    method: "GET",
    url: "/auth?user_id=forged-user",
    headers: {
      authorization: `Bearer ${token}`,
      "x-user-id": "forged-user",
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().actorId, "actor-test");
  assert.equal(JSON.stringify(response.json()).includes("forged-user"), false);
  assert.equal(response.body.includes(token), false);
  await app.close();
});

test("GET /auth returns the actor when the token is valid", async () => {
  const { token, options } = await signToken({ subject: "user-ok", expiresIn: "1h" });
  const app = await buildApp(options);
  const response = await app.inject({
    method: "GET",
    url: "/auth",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    module: "auth",
    status: "authenticated",
    actorId: "actor-test",
    ownerId: null,
  });
  await app.close();
});

test("GET /auth rejects an owner the actor cannot access", async () => {
  const { token, options } = await signToken({ subject: "user-ok", expiresIn: "1h" });
  const app = await buildApp(options);
  const response = await app.inject({
    method: "GET",
    url: "/auth",
    headers: {
      authorization: `Bearer ${token}`,
      "x-monytix-owner-id": "owner-other",
    },
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: "owner_forbidden" });
  await app.close();
});

test("POST /auth/logout rejects a missing token", async () => {
  const app = await anonymousApp();
  const response = await app.inject({ method: "POST", url: "/auth/logout" });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "unauthorized" });
  await app.close();
});

test("POST /auth/logout fails closed when Firebase is not configured", async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({
    method: "POST",
    url: "/auth/logout",
    headers: { authorization: "Bearer anything" },
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "auth_unconfigured" });
  await app.close();
});

test("POST /auth/logout revokes refresh tokens for the subject", async () => {
  const revoked: string[] = [];
  const { token, options } = await signToken({ subject: "user-logout", expiresIn: "1h" });
  options.auth = {
    ...options.auth!,
    revokeRefreshTokens: async (subject) => {
      revoked.push(subject);
    },
  };
  const app = await buildApp(options);
  const response = await app.inject({
    method: "POST",
    url: "/auth/logout",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 204);
  assert.deepEqual(revoked, ["user-logout"]);
  await app.close();
});

test("POST /auth/logout succeeds when revoke is not wired", async () => {
  const { token, options } = await signToken({ subject: "user-ok", expiresIn: "1h" });
  const app = await buildApp(options);
  const response = await app.inject({
    method: "POST",
    url: "/auth/logout",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 204);
  await app.close();
});
