import { randomUUID } from "node:crypto";
import { redactGmailLog } from "./log.js";
import type { MemoryGmailStore } from "./store.js";

export class HistoryExpired extends Error {
  constructor() {
    super("history_expired");
    this.name = "HistoryExpired";
  }
}

export class HistoryRetry extends Error {
  constructor() {
    super("history_retry");
    this.name = "HistoryRetry";
  }
}

export type HistoryPage = {
  historyId: string;
  messageIds: string[];
  nextPageToken?: string;
};

export type GmailHistoryClient = {
  listHistory(input: { credentialRef: string; startHistoryId: string; pageToken?: string }): Promise<HistoryPage>;
};

export type WorkerLog = (event: Record<string, unknown>) => void;

export async function runHistoryOnce(input: {
  store: MemoryGmailStore;
  client: GmailHistoryClient;
  gmailConnectionId: string;
  ownerId: string;
  now?: number;
  log?: WorkerLog;
}): Promise<{ outcome: "locked" | "idle" | "resync" | "synced" | "retry"; delayMs?: number }> {
  const workerId = randomUUID();
  const now = input.now ?? Date.now();
  if (!input.store.tryLock(input.gmailConnectionId, input.ownerId, workerId)) {
    return { outcome: "locked" };
  }
  try {
    const connection = input.store.connection(input.gmailConnectionId, input.ownerId);
    if (connection.syncState === "RESYNC_REQUIRED") {
      return { outcome: "resync" };
    }
    const job = input.store.nextJob(input.gmailConnectionId, input.ownerId, now);
    if (!job || !connection.historyCheckpoint) {
      return { outcome: "idle" };
    }
    let pageToken = job.pageToken ?? undefined;
    try {
      do {
        const page = await input.client.listHistory({
          credentialRef: connection.credentialRef,
          startHistoryId: connection.historyCheckpoint,
          pageToken,
        });
        input.store.recordMessages({
          ownerId: input.ownerId,
          gmailConnectionId: input.gmailConnectionId,
          historyId: job.historyId,
          messageIds: page.messageIds,
        });
        pageToken = page.nextPageToken;
        input.store.savePageToken(job.jobId, input.ownerId, pageToken ?? null);
        input.log?.(redactGmailLog({ event: "history_page", messageCount: page.messageIds.length }) as Record<string, unknown>);
      } while (pageToken);
      input.store.advanceCheckpoint(job.jobId, input.ownerId);
      return { outcome: "synced" };
    } catch (error) {
      if (error instanceof HistoryExpired) {
        input.store.markResync(input.gmailConnectionId, input.ownerId, job.jobId);
        input.log?.(redactGmailLog({ event: "history_expired" }) as Record<string, unknown>);
        return { outcome: "resync" };
      }
      if (error instanceof HistoryRetry) {
        const delayMs = input.store.scheduleRetry(job.jobId, input.ownerId, now);
        input.log?.(redactGmailLog({ event: "history_retry", delayMs }) as Record<string, unknown>);
        return { outcome: "retry", delayMs };
      }
      throw error;
    }
  } finally {
    input.store.unlock(input.gmailConnectionId, input.ownerId, workerId);
  }
}
