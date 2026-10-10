import { createObjectStorage, storageConfigFromEnv } from "./storage.js";
import { runExtractOnce } from "./extract.js";
import { runScanOnce, sweepRetention } from "./scan.js";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const storageConfig = storageConfigFromEnv();
const host = process.env.CLAMAV_HOST?.trim() || "clamav";
const port = Number(process.env.CLAMAV_PORT ?? 3310);
const abandonedHours = Number(process.env.UNCOMPLETED_UPLOAD_RETENTION_HOURS ?? 24);
const retentionDays = Number(process.env.STATEMENT_RETENTION_DAYS ?? 90);

if (!databaseUrl || !storageConfig) {
  throw new Error("statement scanner is not configured");
}

const storage = createObjectStorage(storageConfig);

async function tick(): Promise<void> {
  await runScanOnce(databaseUrl, storage, host, port);
  await runExtractOnce(databaseUrl, storage);
  await sweepRetention(databaseUrl, storage, abandonedHours, retentionDays);
}

await tick();
setInterval(() => {
  void tick();
}, 15_000);
