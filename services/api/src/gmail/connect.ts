import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { credentialPointer, type GmailConnectStore } from "./connect-store.js";
import { sealCredential } from "./secret.js";

const authorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const defaultTokenUri = "https://oauth2.googleapis.com/token";
const scope = "openid email https://www.googleapis.com/auth/gmail.readonly";

export type GmailCodeExchange = (input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenUri: string;
}) => Promise<{ refreshToken: string; email: string }>;

export type GmailConnectOptions = {
  store: GmailConnectStore | null;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenUri: string;
  encryptionKey: string;
  exchange?: GmailCodeExchange;
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
    const state = randomBytes(32).toString("base64url");
    await options.store!.issueState(request.ownerId, state, new Date(Date.now() + 10 * 60 * 1000));
    return reply.send({ url: authorizeUrl(options, state) });
  });

  app.get("/gmail/oauth/callback", async (request, reply) => {
    const query = request.query as { code?: unknown; state?: unknown };
    const code = typeof query.code === "string" ? query.code : "";
    const state = typeof query.state === "string" ? query.state : "";
    if (!code || !state || !ready(options)) {
      return reply.type("text/html").status(400).send(page("Gmail could not be connected."));
    }
    const ownerId = await options.store!.consumeState(state);
    if (!ownerId) {
      return reply.type("text/html").status(400).send(page("Gmail could not be connected."));
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
    } catch {
      return reply.type("text/html").status(400).send(page("Gmail could not be connected."));
    }
    return reply.type("text/html").send(page("Gmail is connected. Return to Monytix."));
  });
};

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

export async function exchangeGoogleCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenUri: string;
}): Promise<{ refreshToken: string; email: string }> {
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
    throw new Error("token_exchange_failed");
  }
  const json = await response.json() as { refresh_token?: unknown; id_token?: unknown };
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : "";
  const email = emailFromIdToken(typeof json.id_token === "string" ? json.id_token : "");
  if (!refreshToken || !email) {
    throw new Error("token_exchange_failed");
  }
  return { refreshToken, email };
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

function page(message: string): string {
  return `<!doctype html><title>Monytix</title><p>${message}</p>`;
}
