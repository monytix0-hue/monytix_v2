import { AuthError, type TokenVerifier, type Verified } from "./app.js";
import { isFirebaseConfigured } from "./env.js";

export async function createFirebaseVerifier(env: NodeJS.ProcessEnv = process.env): Promise<TokenVerifier | null> {
  if (!isFirebaseConfigured(env)) return null;
  const projectId = env.FIREBASE_PROJECT_ID?.trim() ?? "";
  const { applicationDefault, cert, getApps, initializeApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  if (getApps().length === 0) {
    const inline = env.GOOGLE_CREDENTIALS_JSON?.trim() ?? "";
    const credential = inline.length > 0
      ? cert(JSON.parse(inline) as { projectId?: string; privateKey?: string; clientEmail?: string })
      : applicationDefault();
    initializeApp({ credential, projectId });
  }
  const revoked = new Set((env.MONYTIX_REVOKED_SUBJECTS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  return {
    async verify(token: string): Promise<Verified> {
      if (token.split(".").length !== 3) throw new AuthError(401, "unauthorized");
      try {
        const decoded = await getAuth().verifyIdToken(token, true);
        const audience = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
        if (!audience.includes(projectId) || !decoded.uid) throw new AuthError(401, "unauthorized");
        if (revoked.has(decoded.uid)) throw new AuthError(401, "revoked");
        return { subject: decoded.uid, email: decoded.email ?? null };
      } catch (error) {
        if (error instanceof AuthError) throw error;
        const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
        if (code === "auth/id-token-revoked" || code === "auth/user-disabled" || code === "auth/session-cookie-revoked") {
          throw new AuthError(401, "revoked");
        }
        throw new AuthError(401, "unauthorized");
      }
    },
  };
}
