import { randomUUID } from "node:crypto";
import { openPool } from "../db/pool.js";
import { assertCredentialRef } from "./model.js";

export type GmailConnectStore = {
  issueState(ownerId: string, state: string, expiresAt: Date): Promise<void>;
  consumeState(state: string): Promise<string | null>;
  saveConnection(input: {
    ownerId: string;
    mailbox: string;
    credentialRef: string;
    ciphertext: string;
  }): Promise<void>;
  setWatch(input: {
    ownerId: string;
    mailbox: string;
    expiresAt: string;
  }): Promise<void>;
  close?: () => Promise<void>;
};

type SavedConnection = {
  ownerId: string;
  mailbox: string;
  credentialRef: string;
  ciphertext: string;
  watchExpiresAt?: string;
};

export class MemoryGmailConnectStore implements GmailConnectStore {
  readonly saved: SavedConnection[] = [];
  private readonly states = new Map<string, { ownerId: string; expiresAt: number; consumed: boolean }>();

  async issueState(ownerId: string, state: string, expiresAt: Date): Promise<void> {
    this.states.set(state, { ownerId, expiresAt: expiresAt.getTime(), consumed: false });
  }

  async consumeState(state: string): Promise<string | null> {
    const row = this.states.get(state);
    if (!row || row.consumed || row.expiresAt <= Date.now()) {
      return null;
    }
    row.consumed = true;
    return row.ownerId;
  }

  async saveConnection(input: SavedConnection): Promise<void> {
    assertCredentialRef(input.credentialRef);
    const mailbox = input.mailbox.trim().toLowerCase();
    if (!mailbox.includes("@") || input.ciphertext.trim().length === 0) {
      throw new Error("gmail connection is invalid");
    }
    const existing = this.saved.find((row) => row.ownerId === input.ownerId && row.mailbox === mailbox);
    if (existing) {
      existing.credentialRef = input.credentialRef;
      existing.ciphertext = input.ciphertext;
      return;
    }
    this.saved.push({ ...input, mailbox });
  }

  async setWatch(input: { ownerId: string; mailbox: string; expiresAt: string }): Promise<void> {
    const mailbox = input.mailbox.trim().toLowerCase();
    const existing = this.saved.find((row) => row.ownerId === input.ownerId && row.mailbox === mailbox);
    if (existing) {
      existing.watchExpiresAt = input.expiresAt;
    }
  }
}

export function createPgGmailConnectStore(databaseUrl: string): GmailConnectStore {
  const pool = openPool(databaseUrl);
  return {
    async issueState(ownerId, state, expiresAt) {
      await pool.query("SELECT ops.issue_gmail_oauth_state($1, $2, $3)", [ownerId, state, expiresAt]);
    },
    async consumeState(state) {
      const result = await pool.query<{ consume_gmail_oauth_state: string | null }>(
        "SELECT ops.consume_gmail_oauth_state($1)",
        [state],
      );
      return result.rows[0]?.consume_gmail_oauth_state ?? null;
    },
    async saveConnection(input) {
      assertCredentialRef(input.credentialRef);
      await pool.query("SELECT ops.connect_gmail_mailbox($1, $2, $3, $4)", [
        input.ownerId,
        input.mailbox,
        input.credentialRef,
        input.ciphertext,
      ]);
    },
    async setWatch(input) {
      await pool.query("SELECT ops.set_gmail_watch($1::uuid, $2, $3::timestamptz)", [
        input.ownerId,
        input.mailbox,
        input.expiresAt,
      ]);
    },
    async close() {
      await pool.end();
    },
  };
}

export function credentialPointer(): string {
  return `gmail-oauth:${randomUUID()}`;
}
