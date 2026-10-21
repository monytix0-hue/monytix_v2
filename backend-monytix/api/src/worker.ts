import type { InboundRecord, Normalized } from "./types.js";
import type { FinanceWriter } from "./finance.js";
import type { MongoStore } from "./mongo.js";

export type IntelligenceClient = {
  normalize(record: InboundRecord): Promise<Normalized>;
};

export async function routeRecord(mongo: MongoStore, finance: FinanceWriter, intelligence: IntelligenceClient, recordId: string): Promise<string | null> {
  const record = await mongo.get(recordId);
  if (!record || record.ingest_status === "ROUTED") return null;
  try {
    const normalized = await intelligence.normalize(record);
    const table = await finance.apply(record.owner_id, record._id, normalized);
    if (normalized.decrypted_fi) await mongo.setDecrypted(record._id, normalized.decrypted_fi);
    await mongo.markRouted(record._id);
    return table;
  } catch {
    await mongo.markFailed(recordId, "route_failed");
    throw new Error("route_failed");
  }
}

export async function routePending(mongo: MongoStore, finance: FinanceWriter, intelligence: IntelligenceClient): Promise<string | null> {
  const record = await mongo.leasePending();
  if (!record) return null;
  return routeRecord(mongo, finance, intelligence, record._id);
}
