import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAdminTokenVerifier, isRequestAuthConfigured, type IdTokenChecker } from "../src/auth/admin-verifier.js";

const projectId = "monytix-test";

function checker(result: () => Promise<{ uid?: string; aud?: string; email?: string; auth_time?: number }>): IdTokenChecker {
  return { verifyIdToken: async () => result() };
}

test("admin verifier accepts a token for the configured project", async () => {
  const verify = createAdminTokenVerifier({
    projectId,
    checker: checker(async () => ({ uid: "uid-1", aud: projectId, email: "a@monytix.test", auth_time: 10 })),
  });
  const verified = await verify("header.payload.signature");
  assert.deepEqual(verified, { subject: "uid-1", email: "a@monytix.test", authTime: 10 });
});

test("admin verifier rejects an expired token", async () => {
  const verify = createAdminTokenVerifier({
    projectId,
    checker: {
      verifyIdToken: async () => {
        throw Object.assign(new Error("expired"), { code: "auth/id-token-expired" });
      },
    },
  });
  await assert.rejects(verify("header.payload.signature"), (error: { code?: string; message?: string }) => {
    assert.equal(error.code, "unauthorized");
    assert.equal(error.message?.includes("header.payload.signature"), false);
    return true;
  });
});

test("admin verifier rejects a revoked token", async () => {
  const verify = createAdminTokenVerifier({
    projectId,
    checker: {
      verifyIdToken: async () => {
        throw Object.assign(new Error("revoked"), { code: "auth/id-token-revoked" });
      },
    },
  });
  await assert.rejects(verify("header.payload.signature"), (error: { code?: string }) => error.code === "revoked");
});

test("admin verifier rejects a token from another Firebase project", async () => {
  const verify = createAdminTokenVerifier({
    projectId,
    checker: checker(async () => ({ uid: "uid-1", aud: "other-project" })),
  });
  await assert.rejects(verify("header.payload.signature"), (error: { code?: string }) => error.code === "unauthorized");
});

test("admin verifier rejects a malformed token without calling Firebase", async () => {
  let called = false;
  const verify = createAdminTokenVerifier({
    projectId,
    checker: {
      verifyIdToken: async () => {
        called = true;
        return { uid: "uid-1", aud: projectId };
      },
    },
  });
  await assert.rejects(verify("not-a-jwt"), (error: { code?: string }) => error.code === "unauthorized");
  assert.equal(called, false);
});

test("admin verifier keeps the extra revoked-subject list", async () => {
  const verify = createAdminTokenVerifier({
    projectId,
    checker: checker(async () => ({ uid: "uid-listed", aud: projectId })),
    revokedSubjects: new Set(["uid-listed"]),
  });
  await assert.rejects(verify("header.payload.signature"), (error: { code?: string }) => error.code === "revoked");
});

test("request auth ignores the local PEM key", () => {
  assert.equal(
    isRequestAuthConfigured({
      NODE_ENV: "production",
      FIREBASE_PROJECT_ID: projectId,
      MONYTIX_AUTH_PUBLIC_KEY_PEM: "local-key",
    }),
    false,
  );
  assert.equal(
    isRequestAuthConfigured({
      FIREBASE_PROJECT_ID: projectId,
      GOOGLE_APPLICATION_CREDENTIALS: "/run/secrets/firebase-admin.json",
      MONYTIX_AUTH_PUBLIC_KEY_PEM: "local-key",
    }),
    true,
  );
});

test("the API process does not verify requests with the local jose key", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.equal(main.includes("createFirebaseVerifier"), false);
  assert.equal(main.includes("productionAuthKey"), false);
  assert.match(main, /createLiveAdminVerifier/);
});
