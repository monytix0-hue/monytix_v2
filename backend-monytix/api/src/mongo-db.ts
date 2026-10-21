import { MongoClient, ObjectId, type Db } from "mongodb";
import type { InboundRecord } from "./types.js";
import type { MongoStore } from "./mongo.js";

export class MongoDbStore implements MongoStore {
  constructor(private readonly db: Db) {}

  async insertInbound(doc: Omit<InboundRecord, "_id" | "ingest_status" | "created_at">): Promise<InboundRecord & { inserted: boolean }> {
    const existing = await this.db.collection("raw_inbound_records").findOne({ idempotency_key: doc.idempotency_key });
    if (existing) return { ...asRecord(existing), inserted: false };
    const stored = { ...doc, ingest_status: "PENDING" as const, created_at: new Date().toISOString() };
    const result = await this.db.collection("raw_inbound_records").insertOne(stored);
    return { ...stored, _id: String(result.insertedId), inserted: true };
  }

  async get(id: string): Promise<InboundRecord | null> {
    const row = await this.db.collection("raw_inbound_records").findOne({ _id: new ObjectId(id) });
    return row ? asRecord(row) : null;
  }

  async leasePending(): Promise<InboundRecord | null> {
    const row = await this.db.collection("raw_inbound_records").findOne({ ingest_status: "PENDING" });
    return row ? asRecord(row) : null;
  }

  async setDecrypted(id: string, decoded: unknown): Promise<void> {
    await this.db.collection("raw_inbound_records").updateOne({ _id: new ObjectId(id) }, { $set: { "payload.decrypted_fi": decoded } });
  }

  async markRouted(id: string): Promise<void> {
    await this.db.collection("raw_inbound_records").updateOne(
      { _id: new ObjectId(id) },
      { $set: { ingest_status: "ROUTED", routed_at: new Date().toISOString() } },
    );
  }

  async markFailed(id: string, code: string): Promise<void> {
    await this.db.collection("raw_inbound_records").updateOne({ _id: new ObjectId(id) }, { $set: { ingest_status: "FAILED", error: code } });
  }

  async saveConsent(consentId: string, ownerId: string, redirectUrl: string): Promise<void> {
    await this.db.collection("aa_consents").updateOne(
      { consent_id: consentId },
      { $set: { consent_id: consentId, owner_id: ownerId, redirect_url: redirectUrl } },
      { upsert: true },
    );
  }

  async getConsent(consentId: string) {
    const row = await this.db.collection("aa_consents").findOne({ consent_id: consentId });
    if (!row) return null;
    return { consent_id: String(row.consent_id), owner_id: String(row.owner_id) };
  }

  async saveSession(session: { session_id: string; consent_id: string; owner_id: string; our_nonce: string; status: string }): Promise<void> {
    await this.db.collection("aa_sessions").updateOne({ session_id: session.session_id }, { $set: session }, { upsert: true });
  }

  async getSession(sessionId: string) {
    const row = await this.db.collection("aa_sessions").findOne({ session_id: sessionId });
    if (!row) return null;
    return {
      session_id: String(row.session_id),
      consent_id: String(row.consent_id),
      owner_id: String(row.owner_id),
      our_nonce: String(row.our_nonce),
      status: String(row.status),
    };
  }

  async saveGmail(ownerId: string, sealed: string, email: string): Promise<void> {
    await this.db.collection("gmail_credentials").updateOne(
      { owner_id: ownerId },
      { $set: { owner_id: ownerId, credential_ref: sealed, email }, $setOnInsert: { history_id: "0", watch_expiration: "" } },
      { upsert: true },
    );
  }

  async saveWatch(ownerId: string, historyId: string, expiration: string): Promise<void> {
    await this.db.collection("gmail_credentials").updateOne(
      { owner_id: ownerId },
      { $set: { history_id: historyId, watch_expiration: expiration } },
    );
  }

  async findGmailByEmail(email: string) {
    const row = await this.db.collection("gmail_credentials").findOne({ email });
    return row ? asMailbox(row) : null;
  }

  async listGmail() {
    const rows = await this.db.collection("gmail_credentials").find({}).toArray();
    return rows.map((row) => asMailbox(row));
  }

  async claimPubSub(messageId: string): Promise<boolean> {
    const result = await this.db.collection("gmail_push_messages").updateOne(
      { message_id: messageId },
      { $setOnInsert: { message_id: messageId, received_at: new Date().toISOString() } },
      { upsert: true },
    );
    return result.upsertedCount === 1;
  }

  async releasePubSub(messageId: string): Promise<void> {
    await this.db.collection("gmail_push_messages").deleteOne({ message_id: messageId });
  }
}

export async function openMongo(url: string, dbName: string): Promise<MongoDbStore> {
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db(dbName);
  await db.collection("raw_inbound_records").createIndex({ idempotency_key: 1 }, { unique: true });
  await db.collection("gmail_push_messages").createIndex({ message_id: 1 }, { unique: true });
  return new MongoDbStore(db);
}

function asMailbox(row: Record<string, unknown>) {
  return {
    owner_id: String(row.owner_id),
    sealed: String(row.credential_ref ?? ""),
    email: String(row.email ?? ""),
    history_id: String(row.history_id ?? "0"),
    watch_expiration: String(row.watch_expiration ?? ""),
  };
}

function asRecord(row: Record<string, unknown>): InboundRecord {
  return {
    _id: String(row._id),
    owner_id: String(row.owner_id),
    source: row.source as InboundRecord["source"],
    channel_type: String(row.channel_type),
    payload: (row.payload as Record<string, unknown>) ?? {},
    ingest_status: row.ingest_status as InboundRecord["ingest_status"],
    idempotency_key: String(row.idempotency_key),
    created_at: String(row.created_at),
    routed_at: row.routed_at ? String(row.routed_at) : undefined,
    error: row.error ? String(row.error) : undefined,
  };
}
