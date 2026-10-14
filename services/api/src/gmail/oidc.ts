import { importSPKI, jwtVerify } from "jose";

export class OidcError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "OidcError";
  }
}

export async function verifyGoogleOidc(
  token: string,
  options: { audience: string; publicKeyPem: string; serviceAccountEmail?: string },
): Promise<{ subject: string; email: string }> {
  try {
    const key = await importSPKI(options.publicKeyPem, "RS256");
    const { payload } = await jwtVerify(token, key, {
      audience: options.audience,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    });
    const email = typeof payload.email === "string" ? payload.email : "";
    const subject = typeof payload.sub === "string" ? payload.sub : "";
    if (!subject || (options.serviceAccountEmail && email !== options.serviceAccountEmail)) {
      throw new OidcError();
    }
    return { subject, email };
  } catch (error) {
    if (error instanceof OidcError) {
      throw error;
    }
    throw new OidcError();
  }
}
