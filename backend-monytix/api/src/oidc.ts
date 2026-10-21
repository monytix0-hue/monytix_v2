import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTVerifyGetKey } from "jose";

const googleCerts = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export async function verifyGoogleOidc(
  token: string,
  options: { audience: string; publicKeyPem?: string; serviceAccountEmail?: string },
): Promise<{ subject: string; email: string }> {
  const pem = options.publicKeyPem?.trim() ?? "";
  const key: JWTVerifyGetKey | CryptoKey = pem.length > 0 ? await importSPKI(pem, "RS256") : googleCerts;
  const { payload } = await jwtVerify(token, key, {
    audience: options.audience,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
  });
  const email = typeof payload.email === "string" ? payload.email : "";
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  if (!subject || (options.serviceAccountEmail && email !== options.serviceAccountEmail)) {
    throw new Error("unauthorized");
  }
  return { subject, email };
}
