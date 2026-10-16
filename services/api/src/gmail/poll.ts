import { finalObjectKey } from "../imports/store.js";
import type { ObjectStorage } from "../imports/storage.js";
import { extractMimeMessage, messageFrom, type ExtractedHandoff } from "./mime.js";
import { detectPipelineTarget } from "./pipeline.js";
import { readDueDate } from "./reminders.js";

const gmailApi = "https://gmail.googleapis.com/gmail/v1/users/me";
const attachmentQuery = "newer_than:90d filename:(pdf OR csv OR xls OR xlsx)";
const reminderQuery = 'newer_than:90d (subject:due OR subject:premium OR subject:renewal OR subject:"amount due")';

const maxAttachmentBytes = 10 * 1024 * 1024;

const fileMime: Record<ExtractedHandoff["fileType"], string> = {
  PDF: "application/pdf",
  CSV: "text/csv",
  XLS: "application/vnd.ms-excel",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export type PollFetch = (url: string, init?: RequestInit) => Promise<PollResponse>;

export type PollResponse = {
  status: number;
  json: () => Promise<unknown>;
};

export type PollConnection = {
  gmailConnectionId: string;
  ownerId: string;
  actorId: string;
  refreshToken: string;
  historyCheckpoint: string | null;
  initialWindowDrained: boolean;
};

export type PollPorts = {
  fetchImpl: PollFetch;
  clientId: string;
  clientSecret: string;
  tokenUri: string;
  alreadyImported: (messageId: string, partIndex: number, idempotencyKey: string) => Promise<boolean>;
  saveCandidate: (input: {
    messageId: string;
    partIndex: number;
    mimeType: string;
    contentSha256: string;
    provenance: Record<string, unknown>;
  }) => Promise<void>;
  saveHandoff: (handoff: ExtractedHandoff) => Promise<void>;
  saveDueDate: (input: {
    messageId: string;
    biller: string;
    amount: string;
    dueDate: string;
    category: string;
  }) => Promise<void>;
  authorize: (input: {
    idempotencyKey: string;
    fileType: string;
    byteSize: number;
    sha256: string;
    filename: string;
    sourceMetadata: Record<string, unknown>;
  }) => Promise<{ outcome: string; importId: string | null }>;
  storage: ObjectStorage;
  complete: (input: {
    importId: string;
    size: number;
    mime: string;
    sha256: string;
    etag: string;
  }) => Promise<void>;
  setCheckpoint: (checkpoint: string) => Promise<void>;
  markWindowDrained: () => Promise<void>;
};

export type PollResult = { stored: number; skipped: number };

const emptyPoll: PollResult = { stored: 0, skipped: 0 };

function addPoll(left: PollResult, right: PollResult): PollResult {
  return { stored: left.stored + right.stored, skipped: left.skipped + right.skipped };
}

export async function pollConnection(connection: PollConnection, ports: PollPorts): Promise<PollResult> {
  const accessToken = await refreshAccessToken(connection.refreshToken, ports);
  if (!connection.initialWindowDrained) {
    const totals = await searchMailbox(connection, accessToken, ports);
    await ports.markWindowDrained();
    return totals;
  }
  if (connection.historyCheckpoint) {
    const history = await listHistory(accessToken, connection.historyCheckpoint, ports.fetchImpl);
    if (history.expired) {
      return searchMailbox(connection, accessToken, ports);
    }
    if (history.records.length === 0) {
      return emptyPoll;
    }
    let totals = emptyPoll;
    for (const record of history.records) {
      for (const messageId of record.messageIds) {
        totals = addPoll(totals, await readMessage(connection, accessToken, messageId, true, ports));
      }
      await ports.setCheckpoint(record.id);
    }
    return totals;
  }
  return searchMailbox(connection, accessToken, ports);
}

async function searchMailbox(connection: PollConnection, accessToken: string, ports: PollPorts): Promise<PollResult> {
  let totals = emptyPoll;
  const attachments = await listAllMatchingMessages(ports.fetchImpl, accessToken, attachmentQuery);
  for (const messageId of attachments) {
    totals = addPoll(totals, await readMessage(connection, accessToken, messageId, true, ports));
  }
  const reminders = await listAllMatchingMessages(ports.fetchImpl, accessToken, reminderQuery);
  for (const messageId of reminders) {
    totals = addPoll(totals, await readMessage(connection, accessToken, messageId, false, ports));
  }
  const profile = await gmailJson(accessToken, `${gmailApi}/profile`, ports.fetchImpl);
  const historyId = textField(profile, "historyId");
  if (historyId) {
    await ports.setCheckpoint(historyId);
  }
  return totals;
}

async function readMessage(
  connection: PollConnection,
  accessToken: string,
  messageId: string,
  allowImport: boolean,
  ports: PollPorts,
): Promise<PollResult> {
  const payload = await gmailJson(accessToken, `${gmailApi}/messages/${encodeURIComponent(messageId)}?format=raw`, ports.fetchImpl);
  const rawField = textField(payload, "raw");
  if (!rawField) {
    return emptyPoll;
  }
  const raw = Buffer.from(rawField, "base64url").toString("latin1");
  const extracted = extractMimeMessage({
    ownerId: connection.ownerId,
    gmailConnectionId: connection.gmailConnectionId,
    gmailMessageId: messageId,
    raw,
  });
  for (const candidate of extracted.candidates) {
    await ports.saveCandidate({
      messageId,
      partIndex: candidate.partIndex,
      mimeType: candidate.mimeType,
      contentSha256: candidate.contentSha256,
      provenance: candidate.provenance,
    });
  }
  const reminder = readDueDate(extracted.texts.map((part) => part.text).join("\n"));
  if (reminder) {
    await ports.saveDueDate({ messageId, ...reminder });
  }
  if (!allowImport) {
    return emptyPoll;
  }
  let totals = emptyPoll;
  const sender = messageFrom(raw);
  for (const handoff of extracted.handoffs) {
    const idempotencyKey = `gmail:${connection.gmailConnectionId}:${messageId}:${handoff.partIndex}`;
    if (await ports.alreadyImported(messageId, handoff.partIndex, idempotencyKey)) {
      continue;
    }
    if (!isValidAttachmentSize(handoff.byteSize)) {
      totals = addPoll(totals, { stored: 0, skipped: 1 });
      continue;
    }
    const filename = sanitizeFilename(handoff.originalFilename, handoff.fileType);
    const pipelineTarget = detectPipelineTarget(filename, sender);
    const authorized = await ports.authorize({
      idempotencyKey,
      fileType: handoff.fileType,
      byteSize: handoff.byteSize,
      sha256: handoff.sha256,
      filename,
      sourceMetadata: {
        channel: "gmail",
        gmail_connection_id: connection.gmailConnectionId,
        gmail_message_id: messageId,
        part_index: handoff.partIndex,
        pipeline_target: pipelineTarget,
        sender,
      },
    });
    if (authorized.outcome === "forbidden") {
      throw workerError("gmail statement authorize forbidden", "forbidden");
    }
    if (authorized.outcome === "invalid" || authorized.outcome === "conflict") {
      totals = addPoll(totals, { stored: 0, skipped: 1 });
      continue;
    }
    if (authorized.outcome !== "created" && authorized.outcome !== "replay" && authorized.outcome !== "pending") {
      totals = addPoll(totals, { stored: 0, skipped: 1 });
      continue;
    }
    if (!authorized.importId) {
      totals = addPoll(totals, { stored: 0, skipped: 1 });
      continue;
    }
    const stagingKey = `owners/${connection.ownerId}/imports/${authorized.importId}/staging`;
    await ports.storage.putObject({
      key: stagingKey,
      body: handoff.bytes,
      contentType: fileMime[handoff.fileType],
    });
    const etag = await ports.storage.copyObject(stagingKey, finalObjectKey(connection.ownerId, authorized.importId));
    await ports.storage.deleteObject(stagingKey);
    await ports.complete({
      importId: authorized.importId,
      size: handoff.byteSize,
      mime: fileMime[handoff.fileType],
      sha256: handoff.sha256,
      etag: etag.replaceAll("\"", ""),
    });
    await ports.saveHandoff({ ...handoff, originalFilename: filename });
    totals = addPoll(totals, { stored: 1, skipped: 0 });
  }
  return totals;
}

function isValidAttachmentSize(byteLength: number): boolean {
  return byteLength > 0 && byteLength <= maxAttachmentBytes;
}

function sanitizeFilename(rawFilename: string | undefined, fileType: ExtractedHandoff["fileType"]): string {
  let cleaned = (rawFilename ?? "").replace(/[\u0000-\u001F\u007F/\\]/g, "").trim();
  if (cleaned.length > 255) {
    const extMatch = cleaned.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? `.${extMatch[1]}` : "";
    const room = 255 - ext.length;
    cleaned = room > 0 ? cleaned.slice(0, room) + ext : cleaned.slice(0, 255);
  }
  if (!cleaned) {
    const ext = fileType === "CSV" ? "csv" : fileType === "XLS" ? "xls" : fileType === "XLSX" ? "xlsx" : "pdf";
    return `statement.${ext}`;
  }
  return cleaned;
}

async function refreshAccessToken(refreshToken: string, ports: PollPorts): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: ports.clientId,
    client_secret: ports.clientSecret,
  });
  const response = await ports.fetchImpl(ports.tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json();
  const token = textField(payload, "access_token");
  if (response.status !== 200 || !token) {
    const googleError = textField(payload, "error");
    const code = googleError && /^[a-z0-9_]{1,32}$/.test(googleError) ? googleError : `http_${response.status}`;
    throw workerError("gmail token refresh failed", code);
  }
  return token;
}

async function listHistory(
  accessToken: string,
  startHistoryId: string,
  fetchImpl: PollFetch,
): Promise<{ expired: boolean; records: { id: string; messageIds: string[] }[] }> {
  const url = `${gmailApi}/history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded`;
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (response.status === 404) {
    return { expired: true, records: [] };
  }
  const payload = await response.json();
  if (response.status !== 200 || !payload || typeof payload !== "object") {
    throw workerError("gmail history list failed", `http_${response.status}`);
  }
  const history = (payload as { history?: unknown }).history;
  if (!Array.isArray(history)) {
    return { expired: false, records: [] };
  }
  return {
    expired: false,
    records: history.flatMap((row) => {
      if (!row || typeof row !== "object") {
        return [];
      }
      const id = textField(row, "id");
      if (!id) {
        return [];
      }
      const added = (row as { messagesAdded?: unknown }).messagesAdded;
      const messageIds = Array.isArray(added)
        ? added.flatMap((item) => {
          const message = item && typeof item === "object" ? (item as { message?: unknown }).message : null;
          const messageId = message && typeof message === "object" ? textField(message, "id") : null;
          return messageId ? [messageId] : [];
        })
        : [];
      return [{ id, messageIds }];
    }),
  };
}

export async function listAllMatchingMessages(fetchImpl: PollFetch, accessToken: string, query: string): Promise<string[]> {
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${gmailApi}/messages`);
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "50");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }
    const response = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (response.status !== 200) {
      throw workerError("gmail search failed", `http_${response.status}`);
    }
    const data = await response.json();
    const messages = data && typeof data === "object" ? (data as { messages?: unknown }).messages : null;
    if (Array.isArray(messages)) {
      for (const message of messages) {
        const id = message && typeof message === "object" ? textField(message, "id") : null;
        if (id) {
          messageIds.push(id);
        }
      }
    }
    const next = data && typeof data === "object" ? textField(data, "nextPageToken") : null;
    pageToken = next ?? undefined;
  } while (pageToken);
  return messageIds;
}

async function gmailJson(accessToken: string, url: string, fetchImpl: PollFetch): Promise<unknown> {
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const payload = await response.json();
  if (response.status !== 200) {
    throw workerError("gmail request failed", `http_${response.status}`);
  }
  return payload;
}

export function workerError(message: string, code: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export function workerFailure(error: unknown): { name: string; code: string } {
  const name = error instanceof Error ? error.name : "Error";
  const raw = error && typeof error === "object" && "code" in error ? error.code : "";
  const code = typeof raw === "string" && /^[A-Za-z0-9_]{1,32}$/.test(raw) ? raw : "unknown";
  return { name, code };
}

function textField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || !(key in value)) {
    return null;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}
