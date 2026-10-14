const secretKeys = new Set([
  "credentialref",
  "credential_ref",
  "authorization",
  "refreshtoken",
  "refresh_token",
  "messagebody",
  "body",
  "raw",
  "token",
  "password",
  "secret",
]);

export function redactGmailLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactGmailLog(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = secretKeys.has(key.toLowerCase()) ? "[redacted]" : redactGmailLog(entry);
  }
  return redacted;
}
