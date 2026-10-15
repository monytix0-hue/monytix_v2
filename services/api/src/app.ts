import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { accountsRoutes } from "./accounts/index.js";
import { authRoutes } from "./auth/index.js";
import { registerAuthGuard, type AuthConfig } from "./auth/guard.js";
import type { IdentityStore } from "./auth/identity.js";
import { businessRoutes } from "./business/index.js";
import { decisionsRoutes } from "./decisions/index.js";
import { mileRoutes } from "./mile/index.js";
import { missionsRoutes } from "./missions/index.js";
import { nudgesRoutes } from "./nudges/index.js";
import { personalRoutes } from "./personal/index.js";
import { platformRoutes, type PlatformProbe } from "./platform/index.js";
import { createRateLimit } from "./http/rate-limit.js";
import { projectionsRoutes } from "./projections/index.js";
import { sourcesRoutes } from "./sources/index.js";
import { statementsRoutes } from "./statements/index.js";
import type { LedgerRead } from "./ledger/read.js";
import { ledgerRoutes } from "./ledger/routes.js";
import { liveRoutes } from "./live/index.js";
import type { ManualTransactionStore } from "./transactions/manual.js";
import type { ImportStore } from "./imports/store.js";
import type { ObjectStorage } from "./imports/storage.js";
import { importRoutes } from "./imports/routes.js";
import { gmailWebhookRoutes, gmailConnectRoutes, type GmailWebhookOptions, type GmailConnectOptions } from "./gmail/index.js";
import { transactionsRoutes } from "./transactions/index.js";
import { usersRoutes } from "./users/index.js";

export type BuildOptions = {
  logger?: FastifyServerOptions["logger"];
  auth?: AuthConfig;
  identity?: IdentityStore | null;
  manualTransactions?: ManualTransactionStore | null;
  ledger?: LedgerRead | null;
  imports?: ImportStore | null;
  objectStorage?: ObjectStorage | null;
  importScanner?: () => Promise<void>;
  gmail?: GmailWebhookOptions;
  gmailConnect?: GmailConnectOptions;
  platformProbe?: PlatformProbe;
  rateLimit?: { limit: number; windowMs: number };
};

export const redactedPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.narration",
  "*.rawDescription",
  "*.accountNumber",
  "*.vpa",
  "*.token",
  "*.signedUrl",
  "*.email",
  "*.merchant_description",
  "*.merchantDescription",
  "*.url",
  "*.password",
  "*.secret",
  "*.secretAccessKey",
  "*.accessKeyId",
  "*.credential_ref",
  "*.credentialRef",
  "*.refresh_token",
  "*.refreshToken",
  "*.messageBody",
  "req.url",
  "req.query.code",
];

export function productionLogger(): FastifyServerOptions["logger"] {
  return {
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: redactedPaths,
      censor: "[redacted]",
    },
  };
}

const requestIdText = /^[A-Za-z0-9._:-]{8,80}$/;

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1_048_576,
    genReqId(request) {
      const header = request.headers["x-request-id"];
      if (typeof header === "string" && requestIdText.test(header)) {
        return header;
      }
      return randomUUID();
    },
  });
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  const limiter = createRateLimit(options.rateLimit?.limit ?? 300, options.rateLimit?.windowMs ?? 60_000);
  const auth = options.auth ?? { configured: false, verify: async () => {
    throw new Error("auth is not configured");
  } };
  const identity = options.identity ?? null;
  const manualTransactions = options.manualTransactions ?? null;
  const ledger = options.ledger ?? null;
  const imports = options.imports ?? null;
  const objectStorage = options.objectStorage ?? null;

  registerAuthGuard(app, auth, identity);
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (path === "/platform/health" || path === "/platform/ready" || !request.actorId) {
      return;
    }
    if (!limiter.allow(request.actorId)) {
      return reply.status(429).send({ error: "rate_limited" });
    }
  });
  if (identity) {
    app.addHook("onClose", async () => {
      await identity.close();
    });
  }
  if (manualTransactions) {
    app.addHook("onClose", async () => {
      await manualTransactions.close();
    });
  }
  if (ledger) {
    app.addHook("onClose", async () => {
      await ledger.close();
    });
  }
  if (imports) {
    app.addHook("onClose", async () => {
      await imports.close();
    });
  }
  if (objectStorage) {
    app.addHook("onClose", async () => {
      await objectStorage.close();
    });
  }

  await app.register(authRoutes);
  await app.register(usersRoutes);
  await app.register(accountsRoutes);
  await app.register(transactionsRoutes, { manual: manualTransactions });
  await app.register(ledgerRoutes, { ledger });
  await app.register(liveRoutes, { ledger });
  await app.register(importRoutes, { imports, storage: objectStorage, scanner: options.importScanner });
  await app.register(sourcesRoutes);
  await app.register(statementsRoutes);
  await app.register(personalRoutes);
  await app.register(businessRoutes);
  await app.register(decisionsRoutes);
  await app.register(missionsRoutes);
  await app.register(mileRoutes);
  await app.register(nudgesRoutes);
  await app.register(projectionsRoutes);
  await app.register(platformRoutes, { probe: options.platformProbe });
  if (options.gmail?.store?.close) {
    const close = options.gmail.store.close;
    app.addHook("onClose", async () => {
      await close();
    });
  }
  await app.register(gmailWebhookRoutes, options.gmail ?? {
    store: null,
    audience: "",
    allowUnauthenticated: false,
    verify: async () => {
      throw new Error("gmail oidc is not configured");
    },
  });
  await app.register(gmailConnectRoutes, options.gmailConnect ?? {
    store: null,
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    tokenUri: "",
    encryptionKey: "",
  });

  return app;
}
