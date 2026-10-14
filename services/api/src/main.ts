import { buildApp, productionLogger } from "./app.js";
import { createPgIdentity } from "./auth/identity.js";
import { createLiveAdminVerifier, isRequestAuthConfigured } from "./auth/admin-verifier.js";
import { createLedgerRead } from "./ledger/read.js";
import { createManualTransactionStore } from "./transactions/manual.js";
import { createImportStore } from "./imports/store.js";
import { pingScanner } from "./imports/scan.js";
import { createObjectStorage, storageConfigFromEnv } from "./imports/storage.js";
import { createPgGmailStore } from "./gmail/pg-store.js";
import { verifyGoogleOidc } from "./gmail/oidc.js";

const port = Number(process.env.PORT ?? 8080);
const host = "0.0.0.0";
const projectId = process.env.FIREBASE_PROJECT_ID?.trim() ?? "";
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const auth = isRequestAuthConfigured(process.env)
  ? {
      configured: true,
      verify: await createLiveAdminVerifier(process.env),
    }
  : {
      configured: false,
      verify: async () => {
        throw new Error("auth is not configured");
      },
    };

const identity = databaseUrl.length > 0 ? createPgIdentity(databaseUrl) : null;
const objectStorage = storageConfigFromEnv() ? createObjectStorage(storageConfigFromEnv()!) : null;
const scannerHost = process.env.CLAMAV_HOST?.trim() || "clamav";
const scannerPort = Number(process.env.CLAMAV_PORT ?? 3310);

const app = await buildApp({
  logger: productionLogger(),
  auth,
  identity,
  manualTransactions: databaseUrl.length > 0 ? createManualTransactionStore(databaseUrl) : null,
  ledger: databaseUrl.length > 0 ? createLedgerRead(databaseUrl) : null,
  imports: databaseUrl.length > 0 ? createImportStore(databaseUrl) : null,
  objectStorage,
  importScanner: () => pingScanner(scannerHost, scannerPort),
  platformProbe: async () => ({
    auth: projectId ? "ok" as const : "unconfigured" as const,
    database: identity ? await identity.ping().then(() => "ok" as const).catch(() => "down" as const) : "unconfigured",
    storage: objectStorage ? await objectStorage.probe().then(() => "ok" as const).catch(() => "down" as const) : "unconfigured",
    scanner: await pingScanner(scannerHost, scannerPort).then(() => "ok" as const).catch(() => "down" as const),
  }),
  gmail: {
    store: databaseUrl.length > 0 ? createPgGmailStore(databaseUrl) : null,
    audience: process.env.GMAIL_PUBSUB_AUDIENCE?.trim() ?? "",
    allowUnauthenticated: process.env.GMAIL_PUBSUB_ALLOW_UNAUTHENTICATED === "true",
    verify: (token) => verifyGoogleOidc(token, {
      audience: process.env.GMAIL_PUBSUB_AUDIENCE?.trim() ?? "",
      publicKeyPem: process.env.GMAIL_PUBSUB_OIDC_PUBLIC_KEY?.trim() ?? "",
      serviceAccountEmail: process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT?.trim() || undefined,
    }),
  },
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
