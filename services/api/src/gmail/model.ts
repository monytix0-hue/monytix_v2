export type OAuthState = "PENDING" | "AUTHORIZED" | "REVOKED";
export type SyncState = "IDLE" | "RUNNING" | "RESYNC_REQUIRED" | "ERROR";
export type NotificationDisposition = "BASELINE" | "QUEUED" | "DUPLICATE" | "OUT_OF_ORDER";
export type JobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "EXPIRED";

export type GmailConnection = {
  gmailConnectionId: string;
  ownerId: string;
  sourceConnectionId: string;
  mailboxAddress: string;
  oauthState: OAuthState;
  credentialRef: string;
  watchExpiresAt: string | null;
  historyCheckpoint: string | null;
  syncState: SyncState;
  errorState: string | null;
};

export type HistoryJob = {
  jobId: string;
  ownerId: string;
  gmailConnectionId: string;
  historyId: string;
  status: JobStatus;
  attemptCount: number;
  nextAttemptAt: number;
  pageToken: string | null;
  rangeDurable: boolean;
};

export type MessageCandidate = {
  ownerId: string;
  gmailConnectionId: string;
  gmailMessageId: string;
  partIndex: number;
  mimeType: "text/plain" | "text/html";
  contentSha256: string;
  provenance: Record<string, unknown>;
};

export type AttachmentHandoff = {
  ownerId: string;
  gmailConnectionId: string;
  gmailMessageId: string;
  partIndex: number;
  fileType: "PDF" | "CSV" | "XLS" | "XLSX";
  byteSize: number;
  sha256: string;
  originalFilename: string;
  provenance: Record<string, unknown>;
};

export function assertCredentialRef(value: string): void {
  const trimmed = value.trim();
  if (!trimmed || /refresh_token/i.test(trimmed) || trimmed.startsWith("ya29") || trimmed.includes("Bearer ")) {
    throw new Error("credential_ref_rejected");
  }
}

export function decideNotification(input: {
  knownMessageId: boolean;
  checkpoint: string | null;
  historyId: string;
  pendingHistoryIds: string[];
}): NotificationDisposition {
  if (input.knownMessageId) {
    return "DUPLICATE";
  }
  if (input.checkpoint === null) {
    return "BASELINE";
  }
  if (BigInt(input.historyId) <= BigInt(input.checkpoint)) {
    return "OUT_OF_ORDER";
  }
  const covered = input.pendingHistoryIds.some((historyId) => BigInt(historyId) >= BigInt(input.historyId));
  return covered ? "OUT_OF_ORDER" : "QUEUED";
}

export function backoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
}
