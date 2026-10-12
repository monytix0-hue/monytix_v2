import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { accountsRoutes } from "./accounts/index.js";
import { authRoutes } from "./auth/index.js";
import { registerAuthGuard, type AuthConfig } from "./auth/guard.js";
import type { IdentityStore } from "./auth/identity.js";
import { businessRoutes } from "./business/index.js";
import { decisionsRoutes } from "./decisions/index.js";
import { missionsRoutes } from "./missions/index.js";
import { nudgesRoutes } from "./nudges/index.js";
import { personalRoutes } from "./personal/index.js";
import { platformRoutes } from "./platform/index.js";
import { projectionsRoutes } from "./projections/index.js";
import { sourcesRoutes } from "./sources/index.js";
import { statementsRoutes } from "./statements/index.js";
import type { LedgerRead } from "./ledger/read.js";
import { ledgerRoutes } from "./ledger/routes.js";
import type { ManualTransactionStore } from "./transactions/manual.js";
import type { ImportStore } from "./imports/store.js";
import type { ObjectStorage } from "./imports/storage.js";
import { importRoutes } from "./imports/routes.js";
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
};

const redactedPaths = [
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

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const auth = options.auth ?? { configured: false, verify: async () => {
    throw new Error("auth is not configured");
  } };
  const identity = options.identity ?? null;
  const manualTransactions = options.manualTransactions ?? null;
  const ledger = options.ledger ?? null;
  const imports = options.imports ?? null;
  const objectStorage = options.objectStorage ?? null;

  registerAuthGuard(app, auth, identity);
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
  await app.register(importRoutes, { imports, storage: objectStorage });
  await app.register(sourcesRoutes);
  await app.register(statementsRoutes);
  await app.register(personalRoutes);
  await app.register(businessRoutes);
  await app.register(decisionsRoutes);
  await app.register(missionsRoutes);
  await app.register(nudgesRoutes);
  await app.register(projectionsRoutes);
  await app.register(platformRoutes);

  return app;
}
