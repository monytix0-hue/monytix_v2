import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { anonymousApp, signToken } from "./auth-fixture.js";

const body = {
  file_type: "CSV",
  byte_size: 12,
  sha256: "a".repeat(64),
  original_filename: "statement.csv",
};

test("POST /v1/imports rejects a missing token", async () => {
  const app = await anonymousApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/imports",
    headers: { "idempotency-key": "key-1", "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("POST /v1/imports rejects an invalid token", async () => {
  const app = await anonymousApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/imports",
    headers: { authorization: "Bearer not-a-jwt", "idempotency-key": "key-1", "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("POST /v1/imports rejects an unsupported file before any write", async () => {
  const { token, options } = await signToken({ subject: "import-user", expiresIn: "1h" });
  let called = false;
  const app = await buildApp({
    ...options,
    imports: {
      async authorize() {
        called = true;
        throw new Error("must not be called");
      },
      async saveGrant() {
        throw new Error("must not be called");
      },
      async complete() {
        throw new Error("must not be called");
      },
      async fail() {},
      async status() {
        throw new Error("must not be called");
      },
      async close() {},
    },
    objectStorage: {
      async presignUpload() {
        return { url: "http://storage.invalid/upload", headers: {} };
      },
      async readObject() {
        return null;
      },
      async copyObject() {
        return "";
      },
      async deleteObject() {},
      async probe() {},
      async close() {},
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/imports",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "key-1",
      "content-type": "application/json",
      "x-monytix-owner-id": "owner-allowed",
    },
    payload: JSON.stringify({ ...body, file_type: "EXE" }),
  });
  assert.equal(response.statusCode, 422);
  assert.equal(called, false);
  await app.close();
});

test("POST /v1/imports rejects statement bytes and a missing idempotency key", async () => {
  const { token, options } = await signToken({ subject: "import-user", expiresIn: "1h" });
  const app = await buildApp({
    ...options,
    imports: {
      async authorize() {
        throw new Error("must not be called");
      },
      async saveGrant() {
        throw new Error("must not be called");
      },
      async complete() {
        throw new Error("must not be called");
      },
      async fail() {},
      async status() {
        throw new Error("must not be called");
      },
      async close() {},
    },
    objectStorage: null,
  });
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-monytix-owner-id": "owner-allowed",
  };
  const withFile = await app.inject({
    method: "POST",
    url: "/v1/imports",
    headers: { ...headers, "idempotency-key": "key-file" },
    payload: JSON.stringify({ ...body, file: "statement-bytes" }),
  });
  const missingKey = await app.inject({
    method: "POST",
    url: "/v1/imports",
    headers,
    payload: JSON.stringify(body),
  });
  assert.equal(withFile.statusCode, 422);
  assert.equal(missingKey.statusCode, 422);
  await app.close();
});

test("POST /v1/imports rejects a revoked token", async () => {
  const { token, options } = await signToken({
    subject: "import-revoked",
    expiresIn: "1h",
    revokedSubjects: new Set(["import-revoked"]),
  });
  const app = await buildApp(options);
  const response = await app.inject({
    method: "POST",
    url: "/v1/imports",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": "key-1",
      "content-type": "application/json",
      "x-monytix-owner-id": "owner-allowed",
    },
    payload: JSON.stringify(body),
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});
