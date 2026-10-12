import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTPayload } from "jose";

export type VerifiedToken = {
  subject: string;
  email: string | null;
  authTime: number;
};

export type TokenVerifier = (token: string) => Promise<VerifiedToken>;

const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function createFirebaseVerifier(options: {
  projectId: string;
  publicKeyPem?: string;
  revokedSubjects?: ReadonlySet<string>;
}): Promise<TokenVerifier> {
  const issuer = `https://securetoken.google.com/${options.projectId}`;
  const revoked = options.revokedSubjects ?? new Set<string>();
  const key = options.publicKeyPem
    ? await importSPKI(options.publicKeyPem, "RS256")
    : remoteJwks();

  return async (token: string) => {
    const { payload } = await jwtVerify(token, key, {
      issuer,
      audience: options.projectId,
      algorithms: ["RS256"],
    });
    const subject = readSubject(payload);
    if (revoked.has(subject)) {
      throw Object.assign(new Error("revoked"), { code: "revoked" });
    }
    return {
      subject,
      email: typeof payload.email === "string" ? payload.email : null,
      authTime: typeof payload.auth_time === "number" ? payload.auth_time : 0,
    };
  };
}

function remoteJwks(): ReturnType<typeof createRemoteJWKSet> {
  const url = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
  const existing = jwksByUrl.get(url);
  if (existing) {
    return existing;
  }
  const created = createRemoteJWKSet(new URL(url));
  jwksByUrl.set(url, created);
  return created;
}

function readSubject(payload: JWTPayload): string {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw Object.assign(new Error("missing subject"), { code: "unauthorized" });
  }
  return payload.sub;
}

export function productionAuthKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.NODE_ENV === "production") {
    return undefined;
  }
  const key = env.MONYTIX_AUTH_PUBLIC_KEY_PEM?.trim() ?? "";
  return key.length > 0 ? key : undefined;
}

export function revokedSubjectsFromEnv(value: string | undefined): Set<string> {
  if (!value) {
    return new Set();
  }
  return new Set(
    value
      .split(",")
      .map((subject) => subject.trim())
      .filter((subject) => subject.length > 0),
  );
}
