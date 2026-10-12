import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import test from "node:test";
import pg from "pg";
import { productionAuthKey } from "../src/auth/verifier.js";
import { buildApp, productionLogger } from "../src/app.js";
import type { ImportStore } from "../src/imports/store.js";
import { storageConfigFromEnv, type ObjectStorage } from "../src/imports/storage.js";
import type { PlatformChecks } from "../src/platform/routes.js";
import { signToken } from "./auth-fixture.js";

const root = new URL("../../../", import.meta.url);
const compose = readFileSync(new URL("docker-compose.yml", root), "utf8");
const migrate = readFileSync(new URL("scripts/migrate.sh", root), "utf8");

test("compose requires credentials, health checks, and restarts", () => {
  assert.equal(compose.includes(":-monytix"), false);
  assert.equal(compose.includes("monytix_api_local"), false);
  assert.match(compose, /FIREBASE_PROJECT_ID:\s\$\{FIREBASE_PROJECT_ID:\?/);
  assert.match(compose, /OBJECT_STORAGE_ENDPOINT:\s\$\{OBJECT_STORAGE_ENDPOINT:\?/);
  assert.match(compose, /OBJECT_STORAGE_BUCKET:\s\$\{OBJECT_STORAGE_BUCKET:\?/);
  assert.match(compose, /OBJECT_STORAGE_ACCESS_KEY_ID:\s\$\{OBJECT_STORAGE_ACCESS_KEY_ID:\?/);
  assert.match(compose, /OBJECT_STORAGE_SECRET_ACCESS_KEY:\s\$\{OBJECT_STORAGE_SECRET_ACCESS_KEY:\?/);
  assert.match(compose, /DATABASE_URL:\s\$\{DATABASE_URL:\?/);
  assert.match(compose, /postgres:5432\/platform\/ready|fetch\('http:\/\/127\.0\.0\.1:8080\/platform\/ready'\)/);
  assert.match(compose, /8000\/health/);
  assert.match(compose, /clamdcheck\.sh/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /restart: unless-stopped/);
  assert.equal(compose.includes("redis"), false);
});

test("migration script requires passwords and checks database roles", () => {
  assert.match(migrate, /PGPASSWORD:\?PGPASSWORD is required/);
  assert.match(migrate, /API_DB_PASSWORD:\?API_DB_PASSWORD is required/);
  assert.match(migrate, /INTELLIGENCE_DB_PASSWORD:\?INTELLIGENCE_DB_PASSWORD is required/);
  assert.match(migrate, /NOT rolbypassrls AND NOT rolinherit/);
  assert.equal(migrate.includes("echo \"$PGPASSWORD\""), false);
  assert.equal(migrate.includes("echo \"$API_DB_PASSWORD\""), false);
});

test("database roles cannot bypass row security", async (t) => {
  const adminUrl = process.env.M2_TEST_ADMIN_URL;
  if (!adminUrl) {
    t.skip("local Postgres 17 is not configured");
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const roles = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_roles
        WHERE rolname IN ('monytix_api', 'monytix_intelligence')
          AND rolcanlogin
          AND NOT rolbypassrls
          AND NOT rolinherit`,
    );
    assert.equal(roles.rows[0]?.count, "2");
    const migrations = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM ops.schema_migration
        WHERE migration_code IN ('M3-19-SCAN-LEASE', 'M3-20-CURRENT-DATE-INDEX')`,
    );
    assert.equal(migrations.rows[0]?.count, "2");
  } finally {
    await admin.end();
  }
});

test("production ignores a development authentication key", () => {
  assert.equal(productionAuthKey({ NODE_ENV: "production", MONYTIX_AUTH_PUBLIC_KEY_PEM: "local-key" }), undefined);
  assert.equal(productionAuthKey({ NODE_ENV: "development", MONYTIX_AUTH_PUBLIC_KEY_PEM: " local-key " }), "local-key");
});

test("storage configuration is absent until every required value is set", () => {
  const secret = "super-secret-value";
  assert.equal(storageConfigFromEnv({
    OBJECT_STORAGE_ENDPOINT: "http://storage",
    OBJECT_STORAGE_BUCKET: "statements",
    OBJECT_STORAGE_ACCESS_KEY_ID: "access",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "",
  }), null);
  const config = storageConfigFromEnv({
    OBJECT_STORAGE_ENDPOINT: "http://storage",
    OBJECT_STORAGE_BUCKET: "statements",
    OBJECT_STORAGE_ACCESS_KEY_ID: "access",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: secret,
  });
  assert.equal(config?.bucket, "statements");
  assert.equal(JSON.stringify(config).includes(secret), true);
});

test("readiness fails closed for missing or unavailable dependencies", async () => {
  const cases: Array<{ checks: PlatformChecks; statusCode: number; status: string }> = [
    { checks: { auth: "unconfigured", database: "ok", storage: "ok", scanner: "ok" }, statusCode: 503, status: "unconfigured" },
    { checks: { auth: "ok", database: "unconfigured", storage: "ok", scanner: "ok" }, statusCode: 503, status: "unconfigured" },
    { checks: { auth: "ok", database: "ok", storage: "unconfigured", scanner: "ok" }, statusCode: 503, status: "unconfigured" },
    { checks: { auth: "ok", database: "ok", storage: "ok", scanner: "down" }, statusCode: 503, status: "down" },
    { checks: { auth: "ok", database: "down", storage: "ok", scanner: "ok" }, statusCode: 503, status: "down" },
    { checks: { auth: "ok", database: "ok", storage: "down", scanner: "ok" }, statusCode: 503, status: "down" },
    { checks: { auth: "ok", database: "ok", storage: "ok", scanner: "ok" }, statusCode: 200, status: "ok" },
  ];
  for (const entry of cases) {
    const app = await buildApp({ platformProbe: async () => entry.checks });
    const ready = await app.inject({ method: "GET", url: "/platform/ready" });
    assert.equal(ready.statusCode, entry.statusCode);
    assert.equal(ready.json().status, entry.status);
    const health = await app.inject({ method: "GET", url: "/platform/health" });
    assert.equal(health.statusCode, 200);
    await app.close();
  }
});

test("statement import stops before a write when the scanner is unavailable", async () => {
  const signed = await signToken({ subject: "scanner-down", expiresIn: "1h" });
  let authorized = false;
  const lines: string[] = [];
  const imports = {
    async authorize() {
      authorized = true;
      return { outcome: "invalid" as const };
    },
    async close() {},
  } as unknown as ImportStore;
  const storage = { async close() {} } as ObjectStorage;
  const app = await buildApp({
    ...signed.options,
    logger: {
      ...productionLogger(),
      stream: new Writable({
        write(chunk, _encoding, callback) {
          lines.push(chunk.toString());
          callback();
        },
      }),
    },
    imports,
    objectStorage: storage,
    importScanner: async () => {
      throw Object.assign(new Error("postgres://monytix_api:secret-password@postgres/monytix"), { code: "scanner_down" });
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/imports",
    headers: {
      authorization: `Bearer ${signed.token}`,
      "x-monytix-owner-id": "owner-allowed",
      "idempotency-key": "scanner-down-1",
      "content-type": "application/json",
    },
    payload: {
      file_type: "CSV",
      byte_size: 12,
      sha256: "a".repeat(64),
      original_filename: "statement.csv",
    },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, "unavailable");
  assert.equal(authorized, false);
  assert.equal(lines.join("").includes("secret-password"), false);
  await app.close();
});
