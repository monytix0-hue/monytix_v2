import { parseTransactionFromEmail, spotIdempotencyKey, type SpotAlert } from "./alertParser.js";
import { senderCountry } from "./institutions.js";
import { resolveLocalePack, searchQueryFor, type LocalePack } from "./locales/index.js";
import { redactGmailLog } from "./log.js";
import { extractMimeMessage, messageDate, messageFrom, messageSubject, type ExtractedText } from "./mime.js";
import { readDueDate } from "./reminders.js";

const gmailApi = "https://gmail.googleapis.com/gmail/v1/users/me";
/**
 * The default alert search: the Indian pack's verbs. Kept exported because it is
 * the contract other modules and tests assert on; per-owner search uses
 * `searchQueryFor(pack)` with the owner's own market.
 */
export const spotTxnQuery = searchQueryFor(resolveLocalePack({ country: "IN" }));
const reminderQuery = 'newer_than:90d (subject:due OR subject:premium OR subject:renewal OR subject:"amount due")';

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
  /** Owner's market, for the vocabulary pack and the currency fallback. */
  country?: string | null;
  /** Owner's locale tag, e.g. `de-DE`. */
  locale?: string | null;
  /** Owner's IANA timezone, for alert timestamps that carry no offset. */
  timezone?: string | null;
  /** Owner's home currency. The detector terminates here. */
  defaultCurrency?: string | null;
};

export type SpotSave = {
  messageId: string;
  idempotencyKey: string;
  flow: SpotAlert["flow"];
  amount: string;
  currency: string;
  currencyBasis: string;
  currencyConfidence: number;
  statedAmount?: string;
  statedCurrency?: string;
  accountLast4?: string;
  paymentRef?: string;
  channel: SpotAlert["channel"];
  counterparty: string;
  postedAt?: string;
  rawExcerpt: string;
};

export type PollPorts = {
  fetchImpl: PollFetch;
  clientId: string;
  clientSecret: string;
  tokenUri: string;
  dryRun?: boolean;
  debug?: (event: Record<string, unknown>) => void;
  saveCandidate: (input: {
    messageId: string;
    partIndex: number;
    mimeType: string;
    contentSha256: string;
    provenance: Record<string, unknown>;
  }) => Promise<void>;
  saveDueDate: (input: {
    messageId: string;
    biller: string;
    amount: string;
    currency: string;
    dueDate: string;
    category: string;
  }) => Promise<void>;
  saveSpotTransaction: (input: SpotSave) => Promise<"created" | "replay">;
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
    if (!ports.dryRun) {
      await ports.markWindowDrained();
    }
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
      if (!ports.dryRun) {
        await ports.setCheckpoint(record.id);
      }
    }
    return totals;
  }
  return searchMailbox(connection, accessToken, ports);
}

async function searchMailbox(connection: PollConnection, accessToken: string, ports: PollPorts): Promise<PollResult> {
  let totals = emptyPoll;
  const locale = packFor(connection);
  // The search terms follow the owner's market. A German owner's mail says
  // "belastet", which the English query would never match.
  const alerts = await listAllMatchingMessages(ports.fetchImpl, accessToken, searchQueryFor(locale));
  for (const messageId of alerts) {
    totals = addPoll(totals, await readMessage(connection, accessToken, messageId, true, ports));
  }
  const reminders = await listAllMatchingMessages(ports.fetchImpl, accessToken, reminderQuery);
  for (const messageId of reminders) {
    totals = addPoll(totals, await readMessage(connection, accessToken, messageId, false, ports));
  }
  const profile = await gmailJson(accessToken, `${gmailApi}/profile`, ports.fetchImpl);
  const historyId = textField(profile, "historyId");
  if (historyId && !ports.dryRun) {
    await ports.setCheckpoint(historyId);
  }
  return totals;
}

function packFor(connection: PollConnection): LocalePack {
  return resolveLocalePack({ country: connection.country, locale: connection.locale });
}

async function readMessage(
  connection: PollConnection,
  accessToken: string,
  messageId: string,
  allowImport: boolean,
  ports: PollPorts,
): Promise<PollResult> {
  const payload = await gmailJson(accessToken, `${gmailApi}/messages/${encodeURIComponent(messageId)}?format=raw`, ports.fetchImpl);
  if (!payload) {
    return emptyPoll;
  }
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
  const body = alertBody(extracted.texts);
  const locale = packFor(connection);
  const sender = messageFrom(raw);
  // The sender's bank country outranks the owner's: a Chase alert on an Indian
  // owner's mailbox is USD, whatever the owner's home currency is.
  const institutionCountry = senderCountry(sender);
  if (!ports.dryRun) {
    for (const candidate of extracted.candidates) {
      await ports.saveCandidate({
        messageId,
        partIndex: candidate.partIndex,
        mimeType: candidate.mimeType,
        contentSha256: candidate.contentSha256,
        provenance: candidate.provenance,
      });
    }
    const reminder = readDueDate(body, {
      locale,
      defaultCurrency: connection.defaultCurrency ?? null,
      country: connection.country ?? null,
      sender,
      institutionCountry,
      localeTag: connection.locale ?? null,
    });
    if (reminder) {
      await ports.saveDueDate({ messageId, ...reminder });
    }
  }
  if (!allowImport) {
    return emptyPoll;
  }
  const alert = parseTransactionFromEmail(body, {
    postedAt: messageDate(raw),
    subject: messageSubject(raw),
    locale,
    timezone: connection.timezone ?? undefined,
    defaultCurrency: connection.defaultCurrency ?? undefined,
    country: connection.country ?? null,
    sender,
    institutionCountry,
  });
  if (!alert) {
    const entry = redactGmailLog({
      event: "gmail_unparsed_alert",
      messageId,
      from: sender,
      excerpt: body.slice(0, 240),
    });
    (ports.debug ?? logDryRun)(entry as Record<string, unknown>);
    return { stored: 0, skipped: 1 };
  }
  if (ports.dryRun) {
    const entry = redactGmailLog({
      event: "debug_ingest",
      messageId,
      amount: alert.amount,
      flow: alert.flow,
      channel: alert.channel,
      counterparty: alert.counterparty,
      paymentRef: alert.paymentRef ?? null,
    });
    (ports.debug ?? logDryRun)(entry as Record<string, unknown>);
    return emptyPoll;
  }
  const outcome = await ports.saveSpotTransaction({
    messageId,
    idempotencyKey: spotIdempotencyKey(connection.ownerId, alert, messageId),
    flow: alert.flow,
    amount: alert.amount,
    currency: alert.currency,
    currencyBasis: alert.currencyBasis,
    currencyConfidence: alert.currencyConfidence,
    ...(alert.statedAmount && alert.statedCurrency
      ? { statedAmount: alert.statedAmount, statedCurrency: alert.statedCurrency }
      : {}),
    accountLast4: alert.accountLast4,
    paymentRef: alert.paymentRef,
    channel: alert.channel,
    counterparty: alert.counterparty,
    postedAt: alert.postedAt,
    rawExcerpt: alert.rawExcerpt,
  });
  return outcome === "created" ? { stored: 1, skipped: 0 } : { stored: 0, skipped: 1 };
}

function alertBody(texts: ExtractedText[]): string {
  const plain = texts.filter((part) => part.mimeType === "text/plain").map((part) => part.text);
  const chosen = plain.length > 0 ? plain : texts.map((part) => part.text);
  return chosen.join("\n");
}

function logDryRun(event: Record<string, unknown>): void {
  console.log(JSON.stringify(event));
}

export async function refreshAccessToken(refreshToken: string, ports: PollPorts): Promise<string> {
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
  const records: { id: string; messageIds: string[] }[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${gmailApi}/history`);
    url.searchParams.set("startHistoryId", startHistoryId);
    url.searchParams.set("historyTypes", "messageAdded");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }
    const response = await fetchImpl(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
    if (response.status === 404) {
      return { expired: true, records: [] };
    }
    const payload = await response.json();
    if (response.status !== 200 || !payload || typeof payload !== "object") {
      throw workerError("gmail history list failed", `http_${response.status}`);
    }
    const history = (payload as { history?: unknown }).history;
    if (Array.isArray(history)) {
      for (const row of history) {
        if (!row || typeof row !== "object") {
          continue;
        }
        const id = textField(row, "id");
        if (!id) {
          continue;
        }
        const added = (row as { messagesAdded?: unknown }).messagesAdded;
        const messageIds = Array.isArray(added)
          ? added.flatMap((item) => {
            const message = item && typeof item === "object" ? (item as { message?: unknown }).message : null;
            const messageId = message && typeof message === "object" ? textField(message, "id") : null;
            return messageId ? [messageId] : [];
          })
          : [];
        records.push({ id, messageIds });
      }
    }
    pageToken = textField(payload, "nextPageToken") ?? undefined;
  } while (pageToken);
  return { expired: false, records };
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
  if (response.status === 404) {
    return null;
  }
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
