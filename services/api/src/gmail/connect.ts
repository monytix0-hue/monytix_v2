import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { credentialPointer, type GmailConnectStore } from "./connect-store.js";
import { sealCredential } from "./secret.js";

const authorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const defaultTokenUri = "https://oauth2.googleapis.com/token";
const scope = "openid email https://www.googleapis.com/auth/gmail.readonly";
const appReturn = "monytix://gmail/connected";

export type GmailCodeExchange = (input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenUri: string;
}) => Promise<{ refreshToken: string; email: string; accessToken?: string }>;

export type GmailWatch = (input: {
  accessToken: string;
  topic: string;
}) => Promise<{ expiresAt: string } | null>;

export type GmailConnectOptions = {
  store: GmailConnectStore | null;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenUri: string;
  encryptionKey: string;
  pubsubTopic?: string;
  exchange?: GmailCodeExchange;
  watch?: GmailWatch;
};

export const gmailConnectRoutes: FastifyPluginAsync<GmailConnectOptions> = async (app, options) => {
  app.get("/gmail/oauth/start", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    if (!ready(options)) {
      return reply.status(503).send({ error: "unavailable" });
    }
    return reply.send({
      url: await issueAuthorizeUrl(options, request.ownerId),
      server_client_id: options.clientId,
    });
  });

  app.post("/v1/gmail/connect", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    if (!ready(options)) {
      return reply.status(503).send({ error: "unavailable" });
    }
    return reply.send({ authorization_url: await issueAuthorizeUrl(options, request.ownerId) });
  });

  app.post("/v1/gmail/connect/code", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    if (!ready(options)) {
      return reply.status(503).send({ error: "unavailable" });
    }
    const code = readServerCode(request.body);
    if (!code) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    try {
      const exchanged = await (options.exchange ?? exchangeGoogleCode)({
        code,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectUri: "",
        tokenUri: options.tokenUri.trim() || defaultTokenUri,
      });
      const ciphertext = sealCredential(exchanged.refreshToken, options.encryptionKey);
      await options.store!.saveConnection({
        ownerId: request.ownerId,
        mailbox: exchanged.email,
        credentialRef: credentialPointer(),
        ciphertext,
      });
      await rememberWatch(options, request.ownerId, exchanged.email, exchanged.accessToken);
    } catch (error) {
      const missingRefresh = error instanceof GmailExchangeError && error.reason === "refresh_token";
      return reply.status(422).send({ error: missingRefresh ? "refresh_token" : "exchange" });
    }
    return reply.send({ connected: true });
  });

  app.get("/gmail/oauth/callback", async (request, reply) => {
    const query = request.query as { code?: unknown; state?: unknown };
    const code = typeof query.code === "string" ? query.code : "";
    const state = typeof query.state === "string" ? query.state : "";
    if (!code || !state || !ready(options)) {
      return returnToApp(reply, "unavailable");
    }
    const ownerId = await options.store!.consumeState(state);
    if (!ownerId) {
      return returnToApp(reply, "state");
    }
    try {
      const exchanged = await (options.exchange ?? exchangeGoogleCode)({
        code,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectUri: options.redirectUri,
        tokenUri: options.tokenUri.trim() || defaultTokenUri,
      });
      const ciphertext = sealCredential(exchanged.refreshToken, options.encryptionKey);
      await options.store!.saveConnection({
        ownerId,
        mailbox: exchanged.email,
        credentialRef: credentialPointer(),
        ciphertext,
      });
      await rememberWatch(options, ownerId, exchanged.email, exchanged.accessToken);
    } catch {
      return returnToApp(reply, "exchange");
    }
    return returnToApp(reply);
  });
}

async function issueAuthorizeUrl(options: GmailConnectOptions, ownerId: string): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  await options.store!.issueState(ownerId, state, new Date(Date.now() + 10 * 60 * 1000));
  return authorizeUrl(options, state);
}

function returnToApp(reply: { redirect: (url: string) => unknown }, error?: string) {
  const target = error ? `${appReturn}?error=${encodeURIComponent(error)}` : appReturn;
  return reply.redirect(target);
}

function ready(options: GmailConnectOptions): boolean {
  return Boolean(
    options.store
    && options.clientId.trim()
    && options.clientSecret.trim()
    && options.redirectUri.trim()
    && options.encryptionKey.trim(),
  );
}

function authorizeUrl(options: GmailConnectOptions, state: string): string {
  const url = new URL(authorizeEndpoint);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export class GmailExchangeError extends Error {
  readonly reason: "refresh_token" | "exchange";

  constructor(reason: "refresh_token" | "exchange") {
    super(reason);
    this.name = "GmailExchangeError";
    this.reason = reason;
  }
}

function readServerCode(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "";
  }
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code.trim() : "";
}

export async function registerGmailWatch(input: { accessToken: string; topic: string }): Promise<{ expiresAt: string } | null> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ topicName: input.topic, labelIds: ["INBOX"] }),
  });
  if (!response.ok) {
    return null;
  }
  const body = await response.json() as { expiration?: unknown };
  const expiration = typeof body.expiration === "number" ? String(body.expiration) : body.expiration;
  if (typeof expiration !== "string" || !/^[0-9]+$/.test(expiration)) {
    return null;
  }
  const expiresAt = new Date(Number(expiration));
  return Number.isNaN(expiresAt.getTime()) ? null : { expiresAt: expiresAt.toISOString() };
}

async function rememberWatch(
  options: GmailConnectOptions,
  ownerId: string,
  mailbox: string,
  accessToken: string | undefined,
): Promise<void> {
  const topic = options.pubsubTopic?.trim() ?? "";
  if (!topic || !accessToken || !options.store) {
    return;
  }
  try {
    const watched = await (options.watch ?? registerGmailWatch)({ accessToken, topic });
    if (!watched) {
      return;
    }
    await options.store.setWatch({ ownerId, mailbox, expiresAt: watched.expiresAt });
  } catch {
    return;
  }
}

export async function exchangeGoogleCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenUri: string;
}): Promise<{ refreshToken: string; email: string; accessToken?: string }> {
  const response = await fetch(input.tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    throw new GmailExchangeError("exchange");
  }
  const json = await response.json() as { refresh_token?: unknown; id_token?: unknown; access_token?: unknown };
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : "";
  const accessToken = typeof json.access_token === "string" ? json.access_token : undefined;
  const email = emailFromIdToken(typeof json.id_token === "string" ? json.id_token : "");
  if (!refreshToken) {
    throw new GmailExchangeError("refresh_token");
  }
  if (!email) {
    throw new GmailExchangeError("exchange");
  }
  return { refreshToken, email, accessToken };
}

function emailFromIdToken(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) {
    return "";
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown };
    return typeof parsed.email === "string" ? parsed.email.trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

