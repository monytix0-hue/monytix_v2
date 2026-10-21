import { revokedSubjectsFromEnv, type TokenVerifier } from "./verifier.js";

export type CheckedIdToken = {
  uid?: string;
  aud?: string | string[];
  email?: string;
  auth_time?: number;
};

export type IdTokenChecker = {
  verifyIdToken(token: string, checkRevoked: boolean): Promise<CheckedIdToken>;
};

export function createAdminTokenVerifier(options: {
  projectId: string;
  checker: IdTokenChecker;
  revokedSubjects?: ReadonlySet<string>;
}): TokenVerifier {
  const revoked = options.revokedSubjects ?? new Set<string>();
  return async (token: string) => {
    if (token.split(".").length !== 3) {
      throw Object.assign(new Error("unauthorized"), { code: "unauthorized" });
    }
    let decoded: CheckedIdToken;
    try {
      decoded = await options.checker.verifyIdToken(token, true);
    } catch (error) {
      const code = errorCode(error);
      if (code === "auth/id-token-revoked" || code === "auth/user-disabled" || code === "auth/session-cookie-revoked") {
        throw Object.assign(new Error("revoked"), { code: "revoked" });
      }
      throw Object.assign(new Error("unauthorized"), { code: "unauthorized" });
    }
    const audience = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud ?? ""];
    if (!audience.includes(options.projectId)) {
      throw Object.assign(new Error("unauthorized"), { code: "unauthorized" });
    }
    const subject = decoded.uid ?? "";
    if (subject.length === 0) {
      throw Object.assign(new Error("unauthorized"), { code: "unauthorized" });
    }
    if (revoked.has(subject)) {
      throw Object.assign(new Error("revoked"), { code: "revoked" });
    }
    return {
      subject,
      email: typeof decoded.email === "string" ? decoded.email : null,
      authTime: typeof decoded.auth_time === "number" ? decoded.auth_time : 0,
    };
  };
}

export function isRequestAuthConfigured(env: NodeJS.ProcessEnv): boolean {
  const projectId = env.FIREBASE_PROJECT_ID?.trim() ?? "";
  const credentials = env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ?? "";
  const inline = env.GOOGLE_CREDENTIALS_JSON?.trim() ?? "";
  return projectId.length > 0 && (credentials.length > 0 || inline.length > 0);
}

export async function createLiveAdminVerifier(env: NodeJS.ProcessEnv = process.env): Promise<TokenVerifier> {
  const projectId = env.FIREBASE_PROJECT_ID?.trim() ?? "";
  const { applicationDefault, cert, getApps, initializeApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  if (getApps().length === 0) {
    const inline = env.GOOGLE_CREDENTIALS_JSON?.trim() ?? "";
    const credential = inline.length > 0 ? cert(JSON.parse(inline) as { projectId?: string; privateKey?: string; clientEmail?: string }) : applicationDefault();
    initializeApp({ credential, projectId });
  }
  return createAdminTokenVerifier({
    projectId,
    checker: getAuth(),
    revokedSubjects: revokedSubjectsFromEnv(env.MONYTIX_REVOKED_SUBJECTS),
  });
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}
