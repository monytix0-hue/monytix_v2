import type { FastifyPluginAsync } from "fastify";
import type { GmailConnection, NotificationDisposition } from "./model.js";
import { OidcError } from "./oidc.js";

export type GmailNotificationStore = {
  findByMailbox(mailboxAddress: string): Promise<GmailConnection | null> | GmailConnection | null;
  recordNotification(input: {
    ownerId: string;
    gmailConnectionId: string;
    pubsubMessageId: string;
    historyId: string;
  }): Promise<{ disposition: NotificationDisposition; jobId?: string }> | { disposition: NotificationDisposition; jobId?: string };
  close?: () => Promise<void>;
};

export type GmailWebhookOptions = {
  store: GmailNotificationStore | null;
  audience: string;
  allowUnauthenticated: boolean;
  verify: (token: string) => Promise<{ subject: string; email: string }>;
};

type PubSubEnvelope = {
  messageId: string;
  emailAddress: string;
  historyId: string;
};

export const gmailWebhookRoutes: FastifyPluginAsync<GmailWebhookOptions> = async (app, options) => {
  app.post("/gmail/webhook", async (request, reply) => {
    if (!options.store || !options.audience) {
      return reply.status(503).send({ error: "unavailable" });
    }
    if (!options.allowUnauthenticated) {
      const token = bearer(request.headers.authorization);
      if (!token) {
        return reply.status(401).send({ error: "unauthorized" });
      }
      try {
        await options.verify(token);
      } catch (error) {
        if (error instanceof OidcError || error instanceof Error) {
          return reply.status(401).send({ error: "unauthorized" });
        }
        return reply.status(401).send({ error: "unauthorized" });
      }
    }
    const envelope = readEnvelope(request.body);
    if (!envelope) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    const connection = await options.store.findByMailbox(envelope.emailAddress);
    if (!connection || connection.oauthState === "REVOKED") {
      return reply.status(404).send({ error: "not_found" });
    }
    await options.store.recordNotification({
      ownerId: connection.ownerId,
      gmailConnectionId: connection.gmailConnectionId,
      pubsubMessageId: envelope.messageId,
      historyId: envelope.historyId,
    });
    return reply.status(204).send();
  });
};

function bearer(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

function readEnvelope(body: unknown): PubSubEnvelope | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const message = (body as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return null;
  }
  const messageId = (message as { messageId?: unknown }).messageId;
  const data = (message as { data?: unknown }).data;
  if (typeof messageId !== "string" || !messageId || typeof data !== "string" || !data) {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== "object") {
    return null;
  }
  const emailAddress = (decoded as { emailAddress?: unknown }).emailAddress;
  const historyValue = (decoded as { historyId?: unknown }).historyId;
  const historyId = typeof historyValue === "number" ? String(historyValue) : historyValue;
  if (typeof emailAddress !== "string" || !emailAddress.includes("@") || typeof historyId !== "string" || !/^[0-9]+$/.test(historyId)) {
    return null;
  }
  return { messageId, emailAddress, historyId };
}
