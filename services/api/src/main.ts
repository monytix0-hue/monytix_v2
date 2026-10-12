import { buildApp, productionLogger } from "./app.js";
import { createPgIdentity } from "./auth/identity.js";
import { createFirebaseVerifier, revokedSubjectsFromEnv } from "./auth/verifier.js";
import { createLedgerRead } from "./ledger/read.js";
import { createManualTransactionStore } from "./transactions/manual.js";
import { createImportStore } from "./imports/store.js";
import { pingScanner } from "./imports/scan.js";
import { createObjectStorage, storageConfigFromEnv } from "./imports/storage.js";

const port = Number(process.env.PORT ?? 8080);
const host = "0.0.0.0";
const projectId = process.env.FIREBASE_PROJECT_ID?.trim() ?? "";
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const publicKey = process.env.MONYTIX_AUTH_PUBLIC_KEY_PEM?.trim() ?? "";

const auth = projectId
  ? {
      configured: true,
      verify: await createFirebaseVerifier({
        projectId,
        publicKeyPem: publicKey.length > 0 ? publicKey : undefined,
        revokedSubjects: revokedSubjectsFromEnv(process.env.MONYTIX_REVOKED_SUBJECTS),
      }),
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
  platformProbe: async () => ({
    database: identity ? await identity.ping().then(() => "ok" as const).catch(() => "down" as const) : "unconfigured",
    storage: objectStorage ? await objectStorage.probe().then(() => "ok" as const).catch(() => "down" as const) : "unconfigured",
    scanner: await pingScanner(scannerHost, scannerPort).then(() => "ok" as const).catch(() => "down" as const),
  }),
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
