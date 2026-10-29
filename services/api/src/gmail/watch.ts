/**
 * Gmail push watches expire. Google caps them at 7 days, and a connection whose
 * watch has lapsed receives no Pub/Sub notification at all -- the ledger then
 * advances only when a scheduled poll happens to run, which is indistinguishable
 * from "ingestion is broken".
 *
 * Nothing in this repo renewed a watch. It was registered once inside the OAuth
 * connect callback and then left to rot, so every mailbox silently dropped off the
 * push channel within a week of being connected. This module closes that.
 */

const watchEndpoint = "https://gmail.googleapis.com/gmail/v1/users/me/watch";

/** Renew when the watch is missing or falls inside this window. */
export const WATCH_RENEW_WITHIN_MS = 24 * 60 * 60 * 1000;

/** A watch request that hangs must not stall the whole tick. */
const WATCH_TIMEOUT_MS = 15_000;

export type WatchTarget = {
  gmailConnectionId: string;
  ownerId: string;
  refreshToken: string;
  /** Null means the mailbox was never successfully watched. */
  watchExpiresAt: Date | null;
};

export type WatchPorts = {
  fetchImpl: (url: string, init?: RequestInit) => Promise<{ status: number; json: () => Promise<unknown> }>;
  topic: string;
  /** GCP project id, needed to qualify a bare topic name. */
  project: string;
  clientId: string;
  clientSecret: string;
  tokenUri: string;
  /** Reused from the poller so there is one refresh implementation, not two. */
  accessToken: (refreshToken: string) => Promise<string>;
  saveWatch: (input: { ownerId: string; mailbox: string; expiresAt: string }) => Promise<void>;
  mailbox: string;
  log: (event: Record<string, unknown>) => void;
  now?: () => number;
};

/**
 * Whether this connection needs a watch call. Pure, so the renewal policy can be
 * tested without a network or a database.
 */
export function needsWatchRenewal(
  expiresAt: Date | null,
  now: number = Date.now(),
  withinMs: number = WATCH_RENEW_WITHIN_MS,
): boolean {
  if (!expiresAt) {
    return true;
  }
  const value = expiresAt.getTime();
  if (Number.isNaN(value)) {
    // An unparseable timestamp is not evidence of a live watch.
    return true;
  }
  // A watch that expired long ago still needs renewing, and so does one that
  // expires inside the window -- both are the same decision.
  return value - now <= withinMs;
}

/**
 * Gmail requires a fully-qualified resource name. The connect callback posts
 * whatever GMAIL_PUBSUB_TOPIC holds, which is the bare topic id ("gmail-events"),
 * so the request is rejected and -- before this change -- the rejection was
 * swallowed. Normalising here means both a bare name and an already-qualified
 * name work.
 */
export function qualifyTopic(topic: string, project: string): string | null {
  const value = topic.trim();
  const projectId = project.trim();
  if (!value) {
    return null;
  }
  if (value.startsWith("projects/")) {
    return value.includes("/topics/") ? value : null;
  }
  if (!projectId) {
    return null;
  }
  return `projects/${projectId}/topics/${value}`;
}

export type WatchOutcome =
  | { status: "renewed"; expiresAt: string }
  | { status: "skipped"; reason: "current" }
  | { status: "failed"; reason: string };

/** Renew one connection's watch, returning an outcome rather than throwing. */
export async function renewWatch(target: WatchTarget, ports: WatchPorts): Promise<WatchOutcome> {
  const now = (ports.now ?? Date.now)();
  if (!needsWatchRenewal(target.watchExpiresAt, now)) {
    return { status: "skipped", reason: "current" };
  }

  const topic = qualifyTopic(ports.topic, ports.project);
  if (!topic) {
    ports.log({
      level: "error",
      module: "gmail-watch",
      event: "unconfigured",
      reason: ports.topic.trim() ? "missing_project" : "missing_topic",
      gmail_connection_id: target.gmailConnectionId,
    });
    return { status: "failed", reason: "unconfigured" };
  }

  let accessToken: string;
  try {
    accessToken = await ports.accessToken(target.refreshToken);
  } catch (error) {
    const reason = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "refresh_failed";
    ports.log({
      level: "warn",
      module: "gmail-watch",
      event: "failed",
      reason,
      gmail_connection_id: target.gmailConnectionId,
    });
    return { status: "failed", reason };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WATCH_TIMEOUT_MS);
  try {
    const response = await ports.fetchImpl(watchEndpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ topicName: topic, labelIds: ["INBOX"] }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (response.status !== 200) {
      const googleError = readError(body);
      ports.log({
        level: "warn",
        module: "gmail-watch",
        event: "failed",
        reason: googleError ?? `http_${response.status}`,
        gmail_connection_id: target.gmailConnectionId,
      });
      return { status: "failed", reason: googleError ?? `http_${response.status}` };
    }
    const expiresAt = readExpiration(body);
    if (!expiresAt) {
      ports.log({
        level: "warn",
        module: "gmail-watch",
        event: "failed",
        reason: "no_expiration",
        gmail_connection_id: target.gmailConnectionId,
      });
      return { status: "failed", reason: "no_expiration" };
    }
    await ports.saveWatch({
      ownerId: target.ownerId,
      mailbox: ports.mailbox,
      expiresAt,
    });
    ports.log({
      level: "info",
      module: "gmail-watch",
      event: "renewed",
      gmail_connection_id: target.gmailConnectionId,
      expires_at: expiresAt,
    });
    return { status: "renewed", expiresAt };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "network";
    ports.log({
      level: "warn",
      module: "gmail-watch",
      event: "failed",
      reason,
      gmail_connection_id: target.gmailConnectionId,
    });
    return { status: "failed", reason };
  } finally {
    clearTimeout(timer);
  }
}

/** `expiration` arrives as epoch milliseconds, sometimes stringified. */
function readExpiration(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const raw = (body as { expiration?: unknown }).expiration;
  const value = typeof raw === "number" ? String(raw) : raw;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    return null;
  }
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readError(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  if (typeof status !== "string" || !/^[A-Z_]{1,40}$/.test(status)) {
    return null;
  }
  return status.toLowerCase();
}
