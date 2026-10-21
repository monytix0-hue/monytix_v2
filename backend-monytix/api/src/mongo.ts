import { randomUUID } from "node:crypto";
import type { InboundRecord } from "./types.js";

export type GmailMailbox = {
  owner_id: string;
  sealed: string;
  email: string;
  history_id: string;
  watch_expiration: string;
};

export type MongoStore = {
  insertInbound(doc: Omit<InboundRecord, "_id" | "ingest_status" | "created_at">): Promise<InboundRecord & { inserted: boolean }>;
  get(id: string): Promise<InboundRecord | null>;
  leasePending(): Promise<InboundRecord | null>;
  setDecrypted(id: string, decoded: unknown): Promise<void>;
  markRouted(id: string): Promise<void>;
  markFailed(id: string, code: string): Promise<void>;
  saveConsent(consentId: string, ownerId: string, redirectUrl: string): Promise<void>;
  getConsent(consentId: string): Promise<{ consent_id: string; owner_id: string } | null>;
  saveSession(session: { session_id: string; consent_id: string; owner_id: string; our_nonce: string; status: string }): Promise<void>;
  getSession(sessionId: string): Promise<{ session_id: string; consent_id: string; owner_id: string; our_nonce: string; status: string } | null>;
  saveGmail(ownerId: string, sealed: string, email: string): Promise<void>;
  saveWatch(ownerId: string, historyId: string, expiration: string): Promise<void>;
  findGmailByEmail(email: string): Promise<GmailMailbox | null>;
  listGmail(): Promise<GmailMailbox[]>;
  claimPubSub(messageId: string): Promise<boolean>;
  releasePubSub(messageId: string): Promise<void>;
};

export class MemoryMongo implements MongoStore {
  records = new Map<string, InboundRecord>();
  consents = new Map<string, { consent_id: string; owner_id: string; redirect_url: string }>();
  sessions = new Map<string, { session_id: string; consent_id: string; owner_id: string; our_nonce: string; status: string }>();
  gmail = new Map<string, GmailMailbox>();
  pubsub = new Set<string>();

  async insertInbound(doc: Omit<InboundRecord, "_id" | "ingest_status" | "created_at">): Promise<InboundRecord & { inserted: boolean }> {
    for (const existing of this.records.values()) {
      if (existing.idempotency_key === doc.idempotency_key) {
        return { ...existing, inserted: false };
      }
    }
    const stored: InboundRecord = {
      ...doc,
      _id: randomUUID(),
      ingest_status: "PENDING",
      created_at: new Date().toISOString(),
    };
    this.records.set(stored._id, stored);
    return { ...stored, inserted: true };
  }

  async get(id: string): Promise<InboundRecord | null> {
    const row = this.records.get(id);
    return row ? { ...row, payload: { ...row.payload } } : null;
  }

  async leasePending(): Promise<InboundRecord | null> {
    for (const row of this.records.values()) {
      if (row.ingest_status === "PENDING") {
        return { ...row, payload: { ...row.payload } };
      }
    }
    return null;
  }

  async setDecrypted(id: string, decoded: unknown): Promise<void> {
    const row = this.records.get(id);
    if (!row) return;
    row.payload = { ...row.payload, decrypted_fi: decoded };
  }

  async markRouted(id: string): Promise<void> {
    const row = this.records.get(id);
    if (!row) return;
    row.ingest_status = "ROUTED";
    row.routed_at = new Date().toISOString();
  }

  async markFailed(id: string, code: string): Promise<void> {
    const row = this.records.get(id);
    if (!row) return;
    row.ingest_status = "FAILED";
    row.error = code;
  }

  async saveConsent(consentId: string, ownerId: string, redirectUrl: string): Promise<void> {
    this.consents.set(consentId, { consent_id: consentId, owner_id: ownerId, redirect_url: redirectUrl });
  }

  async getConsent(consentId: string) {
    const row = this.consents.get(consentId);
    return row ? { consent_id: row.consent_id, owner_id: row.owner_id } : null;
  }

  async saveSession(session: { session_id: string; consent_id: string; owner_id: string; our_nonce: string; status: string }): Promise<void> {
    this.sessions.set(session.session_id, session);
  }

  async getSession(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  async saveGmail(ownerId: string, sealed: string, email: string): Promise<void> {
    const existing = this.gmail.get(ownerId);
    this.gmail.set(ownerId, {
      owner_id: ownerId,
      sealed,
      email,
      history_id: existing?.history_id ?? "0",
      watch_expiration: existing?.watch_expiration ?? "",
    });
  }

  async saveWatch(ownerId: string, historyId: string, expiration: string): Promise<void> {
    const existing = this.gmail.get(ownerId);
    if (!existing) return;
    existing.history_id = historyId;
    existing.watch_expiration = expiration;
  }

  async findGmailByEmail(email: string): Promise<GmailMailbox | null> {
    for (const row of this.gmail.values()) {
      if (row.email.toLowerCase() === email.toLowerCase()) return { ...row };
    }
    return null;
  }

  async listGmail(): Promise<GmailMailbox[]> {
    return [...this.gmail.values()].map((row) => ({ ...row }));
  }

  async claimPubSub(messageId: string): Promise<boolean> {
    if (this.pubsub.has(messageId)) return false;
    this.pubsub.add(messageId);
    return true;
  }

  async releasePubSub(messageId: string): Promise<void> {
    this.pubsub.delete(messageId);
  }
}
