import { randomUUID } from "node:crypto";
import {
  assertCredentialRef,
  backoffMs,
  decideNotification,
  type AttachmentHandoff,
  type GmailConnection,
  type HistoryJob,
  type MessageCandidate,
  type NotificationDisposition,
  type OAuthState,
} from "./model.js";

type ConnectionRow = GmailConnection & { lockWorker: string | null };
type NotificationRow = {
  ownerId: string;
  gmailConnectionId: string;
  pubsubMessageId: string;
  historyId: string;
  disposition: NotificationDisposition;
};
type MessageRow = { ownerId: string; gmailConnectionId: string; gmailMessageId: string; historyId: string };

export class MemoryGmailStore {
  private readonly connections = new Map<string, ConnectionRow>();
  private readonly notifications: NotificationRow[] = [];
  private readonly jobs: HistoryJob[] = [];
  private readonly messages: MessageRow[] = [];
  private readonly candidates: MessageCandidate[] = [];
  private readonly handoffs: AttachmentHandoff[] = [];

  insertConnection(input: {
    ownerId: string;
    sourceConnectionId: string;
    mailboxAddress: string;
    oauthState?: OAuthState;
    credentialRef: string;
    watchExpiresAt?: string | null;
  }): GmailConnection {
    assertCredentialRef(input.credentialRef);
    const row: ConnectionRow = {
      gmailConnectionId: randomUUID(),
      ownerId: input.ownerId,
      sourceConnectionId: input.sourceConnectionId,
      mailboxAddress: input.mailboxAddress.trim().toLowerCase(),
      oauthState: input.oauthState ?? "AUTHORIZED",
      credentialRef: input.credentialRef.trim(),
      watchExpiresAt: input.watchExpiresAt ?? null,
      historyCheckpoint: null,
      syncState: "IDLE",
      errorState: null,
      lockWorker: null,
    };
    this.connections.set(row.gmailConnectionId, row);
    return this.view(row);
  }

  findByMailbox(mailboxAddress: string): GmailConnection | null {
    const mailbox = mailboxAddress.trim().toLowerCase();
    const row = [...this.connections.values()].find((connection) => connection.mailboxAddress === mailbox);
    return row ? this.view(row) : null;
  }

  recordNotification(input: {
    ownerId: string;
    gmailConnectionId: string;
    pubsubMessageId: string;
    historyId: string;
  }): { disposition: NotificationDisposition; jobId?: string } {
    const connection = this.owned(input.gmailConnectionId, input.ownerId);
    const knownMessageId = this.notifications.some((row) => row.pubsubMessageId === input.pubsubMessageId);
    const pendingHistoryIds = this.jobs
      .filter((job) => job.gmailConnectionId === connection.gmailConnectionId && (job.status === "PENDING" || job.status === "RUNNING"))
      .map((job) => job.historyId);
    const disposition = decideNotification({
      knownMessageId,
      checkpoint: connection.historyCheckpoint,
      historyId: input.historyId,
      pendingHistoryIds,
    });
    if (disposition !== "DUPLICATE") {
      this.notifications.push({
        ownerId: connection.ownerId,
        gmailConnectionId: connection.gmailConnectionId,
        pubsubMessageId: input.pubsubMessageId,
        historyId: input.historyId,
        disposition,
      });
    }
    if (disposition === "BASELINE") {
      connection.historyCheckpoint = input.historyId;
      return { disposition };
    }
    if (disposition !== "QUEUED") {
      return { disposition };
    }
    const job: HistoryJob = {
      jobId: randomUUID(),
      ownerId: connection.ownerId,
      gmailConnectionId: connection.gmailConnectionId,
      historyId: input.historyId,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: 0,
      pageToken: null,
      rangeDurable: false,
    };
    this.jobs.push(job);
    return { disposition, jobId: job.jobId };
  }

  notificationForOwner(ownerId: string, pubsubMessageId: string): NotificationRow | null {
    return this.notifications.find((row) => row.ownerId === ownerId && row.pubsubMessageId === pubsubMessageId) ?? null;
  }

  tryLock(gmailConnectionId: string, ownerId: string, workerId: string): boolean {
    const connection = this.connections.get(gmailConnectionId);
    if (!connection || connection.ownerId !== ownerId || connection.lockWorker) {
      return false;
    }
    connection.lockWorker = workerId;
    if (connection.syncState !== "RESYNC_REQUIRED") {
      connection.syncState = "RUNNING";
    }
    return true;
  }

  unlock(gmailConnectionId: string, ownerId: string, workerId: string): void {
    const connection = this.owned(gmailConnectionId, ownerId);
    if (connection.lockWorker !== workerId) {
      return;
    }
    connection.lockWorker = null;
    if (connection.syncState === "RUNNING") {
      connection.syncState = "IDLE";
    }
  }

  nextJob(gmailConnectionId: string, ownerId: string, now: number): HistoryJob | null {
    const connection = this.owned(gmailConnectionId, ownerId);
    if (connection.syncState === "RESYNC_REQUIRED") {
      return null;
    }
    const pending = this.jobs
      .filter((job) => job.gmailConnectionId === gmailConnectionId && job.ownerId === ownerId && job.status === "PENDING" && job.nextAttemptAt <= now)
      .sort((left, right) => (BigInt(left.historyId) < BigInt(right.historyId) ? -1 : 1));
    return pending[0] ?? null;
  }

  recordMessages(input: { ownerId: string; gmailConnectionId: string; historyId: string; messageIds: string[] }): { inserted: string[]; duplicates: string[] } {
    this.owned(input.gmailConnectionId, input.ownerId);
    const inserted: string[] = [];
    const duplicates: string[] = [];
    for (const messageId of input.messageIds) {
      const exists = this.messages.some((row) => row.gmailConnectionId === input.gmailConnectionId && row.gmailMessageId === messageId);
      if (exists) {
        duplicates.push(messageId);
        continue;
      }
      this.messages.push({
        ownerId: input.ownerId,
        gmailConnectionId: input.gmailConnectionId,
        gmailMessageId: messageId,
        historyId: input.historyId,
      });
      inserted.push(messageId);
    }
    return { inserted, duplicates };
  }

  savePageToken(jobId: string, ownerId: string, pageToken: string | null): void {
    const job = this.job(jobId, ownerId);
    job.pageToken = pageToken;
    job.rangeDurable = pageToken === null;
  }

  advanceCheckpoint(jobId: string, ownerId: string): void {
    const job = this.job(jobId, ownerId);
    if (!job.rangeDurable) {
      throw new Error("checkpoint_before_durable_work");
    }
    const connection = this.owned(job.gmailConnectionId, ownerId);
    const stored = this.messages.filter((row) => row.gmailConnectionId === job.gmailConnectionId && row.historyId === job.historyId);
    if (stored.length === 0 && job.pageToken !== null) {
      throw new Error("checkpoint_before_durable_work");
    }
    connection.historyCheckpoint = job.historyId;
    job.status = "COMPLETED";
    job.pageToken = null;
  }

  scheduleRetry(jobId: string, ownerId: string, now: number): number {
    const job = this.job(jobId, ownerId);
    job.attemptCount += 1;
    job.status = "PENDING";
    job.rangeDurable = false;
    const delay = backoffMs(job.attemptCount);
    job.nextAttemptAt = now + delay;
    return delay;
  }

  markResync(gmailConnectionId: string, ownerId: string, jobId: string): void {
    const connection = this.owned(gmailConnectionId, ownerId);
    connection.syncState = "RESYNC_REQUIRED";
    connection.errorState = "HISTORY_ID_EXPIRED";
    const job = this.job(jobId, ownerId);
    job.status = "EXPIRED";
  }

  connection(gmailConnectionId: string, ownerId: string): GmailConnection {
    return this.view(this.owned(gmailConnectionId, ownerId));
  }

  saveCandidates(rows: MessageCandidate[]): void {
    for (const row of rows) {
      this.owned(row.gmailConnectionId, row.ownerId);
      this.candidates.push(row);
    }
  }

  saveHandoffs(rows: AttachmentHandoff[]): void {
    for (const row of rows) {
      this.owned(row.gmailConnectionId, row.ownerId);
      this.handoffs.push(row);
    }
  }

  candidatesForOwner(ownerId: string): MessageCandidate[] {
    return this.candidates.filter((row) => row.ownerId === ownerId);
  }

  handoffsForOwner(ownerId: string): AttachmentHandoff[] {
    return this.handoffs.filter((row) => row.ownerId === ownerId);
  }

  private owned(gmailConnectionId: string, ownerId: string): ConnectionRow {
    const connection = this.connections.get(gmailConnectionId);
    if (!connection || connection.ownerId !== ownerId) {
      throw new Error("owner_isolation");
    }
    return connection;
  }

  private job(jobId: string, ownerId: string): HistoryJob {
    const job = this.jobs.find((row) => row.jobId === jobId && row.ownerId === ownerId);
    if (!job) {
      throw new Error("owner_isolation");
    }
    return job;
  }

  private view(row: ConnectionRow): GmailConnection {
    return {
      gmailConnectionId: row.gmailConnectionId,
      ownerId: row.ownerId,
      sourceConnectionId: row.sourceConnectionId,
      mailboxAddress: row.mailboxAddress,
      oauthState: row.oauthState,
      credentialRef: row.credentialRef,
      watchExpiresAt: row.watchExpiresAt,
      historyCheckpoint: row.historyCheckpoint,
      syncState: row.syncState,
      errorState: row.errorState,
    };
  }
}
