import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const authorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const profileEndpoint = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const watchEndpoint = "https://gmail.googleapis.com/gmail/v1/users/me/watch";
const scope = "https://www.googleapis.com/auth/gmail.readonly";

export type GmailOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenUri: string;
  encryptionKey: Buffer;
  topicName: string | null;
};

export type MailboxGrant = {
  refreshToken: string;
  accessToken: string;
  emailAddress: string;
  historyId: string | null;
  watchExpiresAt: string | null;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
};

type ProfileResponse = {
  emailAddress?: string;
  historyId?: string;
};

type WatchResponse = {
  historyId?: string;
  expiration?: string;
};

export const gmailOAuthSettingNames = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REDIRECT_URI",
  "GMAIL_TOKEN_URI",
  "GMAIL_TOKEN_ENCRYPTION_KEY",
] as const;

export function missingGmailOAuthSettings(env: NodeJS.ProcessEnv): string[] {
  return gmailOAuthSettingNames.filter((name) => {
    const value = env[name]?.trim() ?? "";
    if (!value) {
      return true;
    }
    return name === "GMAIL_TOKEN_ENCRYPTION_KEY" && decodeKey(value) === null;
  });
}

export function gmailConnectUnavailableReason(env: NodeJS.ProcessEnv, storeReady: boolean): string | null {
  const missing = missingGmailOAuthSettings(env);
  if (missing.length > 0) {
    return `Set ${missing.join(", ")} before Gmail can open Google.`;
  }
  if (!storeReady) {
    return "Gmail mailbox store is not configured.";
  }
  return null;
}

export function gmailOAuthConfigFromEnv(env: NodeJS.ProcessEnv): GmailOAuthConfig | null {
  if (missingGmailOAuthSettings(env).length > 0) {
    return null;
  }
  const clientId = env.GMAIL_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GMAIL_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = env.GMAIL_REDIRECT_URI?.trim() ?? "";
  const tokenUri = env.GMAIL_TOKEN_URI?.trim() ?? "";
  const key = decodeKey(env.GMAIL_TOKEN_ENCRYPTION_KEY?.trim() ?? "");
  if (!key) {
    return null;
  }
  const project = env.GCP_PROJECT_ID?.trim() ?? "";
  const topic = env.GMAIL_PUBSUB_TOPIC?.trim() ?? "";
  return {
    clientId,
    clientSecret,
    redirectUri,
    tokenUri,
    encryptionKey: key,
    topicName: project && topic ? `projects/${project}/topics/${topic}` : null,
  };
}

export function signConnectState(config: GmailOAuthConfig, actorId: string, ownerId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ actorId, ownerId, exp: now + 10 * 60 * 1000 })).toString("base64url");
  const signature = createHmac("sha256", config.encryptionKey).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readConnectState(config: GmailOAuthConfig, state: string, now = Date.now()): { actorId: string; ownerId: string } | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) {
    return null;
  }
  const expected = createHmac("sha256", config.encryptionKey).update(payload).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { actorId?: string; ownerId?: string; exp?: number };
    if (!parsed.actorId || !parsed.ownerId || typeof parsed.exp !== "number" || parsed.exp < now) {
      return null;
    }
    return { actorId: parsed.actorId, ownerId: parsed.ownerId };
  } catch {
    return null;
  }
}

export function authorizationUrl(config: GmailOAuthConfig, state: string): string {
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${authorizeEndpoint}?${query.toString()}`;
}

export function sealRefreshToken(key: Buffer, refreshToken: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function openRefreshToken(key: Buffer, sealed: string): string {
  const body = sealed.startsWith("enc:v1:") ? sealed.slice("enc:v1:".length) : "";
  const [ivText, tagText, dataText] = body.split(".");
  if (!ivText || !tagText || !dataText) {
    throw new Error("credential_ref_rejected");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

export async function exchangeMailboxCode(config: GmailOAuthConfig, code: string): Promise<MailboxGrant> {
  const exchanged = await postForm(config.tokenUri, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  const token = readToken(exchanged);
  if (!token?.access_token || !token.refresh_token) {
    throw new Error("token_exchange_failed");
  }
  const profile = await getJson<ProfileResponse>(profileEndpoint, token.access_token);
  const email = profile.emailAddress?.trim().toLowerCase() ?? "";
  if (!email.includes("@")) {
    throw new Error("profile_failed");
  }
  let historyId = digits(profile.historyId);
  let watchExpiresAt: string | null = null;
  if (config.topicName) {
    try {
      const watch = await postJson<WatchResponse>(watchEndpoint, token.access_token, {
        topicName: config.topicName,
        labelIds: ["INBOX"],
      });
      historyId = digits(watch.historyId) ?? historyId;
      watchExpiresAt = expiry(watch.expiration);
    } catch {
      watchExpiresAt = null;
    }
  }
  return {
    refreshToken: token.refresh_token,
    accessToken: token.access_token,
    emailAddress: email,
    historyId,
    watchExpiresAt,
  };
}

function decodeKey(value: string): Buffer | null {
  if (!value) {
    return null;
  }
  const key = Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

function digits(value: string | undefined): string | null {
  return value && /^[0-9]+$/.test(value) ? value : null;
}

function expiry(value: string | undefined): string | null {
  if (!value || !/^[0-9]+$/.test(value)) {
    return null;
  }
  const millis = Number(value);
  if (!Number.isFinite(millis)) {
    return null;
  }
  return new Date(millis).toISOString();
}

function readToken(value: unknown): TokenResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const token = value as TokenResponse;
  return {
    access_token: typeof token.access_token === "string" ? token.access_token : undefined,
    refresh_token: typeof token.refresh_token === "string" ? token.refresh_token : undefined,
  };
}

async function postForm(url: string, fields: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  if (!response.ok) {
    throw new Error("token_exchange_failed");
  }
  return response.json();
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    throw new Error("profile_failed");
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, accessToken: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error("watch_failed");
  }
  return response.json() as Promise<T>;
}
