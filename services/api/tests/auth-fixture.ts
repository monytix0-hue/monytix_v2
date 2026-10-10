import { generateKeyPair, exportSPKI, SignJWT, type CryptoKey } from "jose";
import { buildApp, type BuildOptions } from "../src/app.js";
import { createFirebaseVerifier } from "../src/auth/verifier.js";

export const testProjectId = "monytix-test";

let publicKeyPem: string | null = null;
let privateKey: CryptoKey | null = null;

export async function testKeys(): Promise<{ publicKeyPem: string; privateKey: CryptoKey }> {
  if (publicKeyPem && privateKey) {
    return { publicKeyPem, privateKey };
  }
  const keys = await generateKeyPair("RS256");
  publicKeyPem = await exportSPKI(keys.publicKey);
  privateKey = keys.privateKey;
  return { publicKeyPem, privateKey };
}

export async function signToken(input: {
  subject: string;
  expiresIn: string;
  revokedSubjects?: ReadonlySet<string>;
}): Promise<{ token: string; options: BuildOptions }> {
  const keys = await testKeys();
  const token = await new SignJWT({ auth_time: Math.floor(Date.now() / 1000) })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject(input.subject)
    .setIssuer(`https://securetoken.google.com/${testProjectId}`)
    .setAudience(testProjectId)
    .setIssuedAt()
    .setExpirationTime(input.expiresIn)
    .sign(keys.privateKey);

  const verify = await createFirebaseVerifier({
    projectId: testProjectId,
    publicKeyPem: keys.publicKeyPem,
    revokedSubjects: input.revokedSubjects,
  });

  return {
    token,
    options: {
      logger: false,
      auth: { configured: true, verify },
      identity: {
        async provisionActor() {
          return { actorId: "actor-test" };
        },
        async resolveOwner(_actorId, requestedOwnerId) {
          if (requestedOwnerId && requestedOwnerId !== "owner-allowed") {
            const { AuthError } = await import("../src/auth/errors.js");
            throw new AuthError(403, "owner_forbidden");
          }
          return requestedOwnerId;
        },
        async close() {},
      },
    },
  };
}

export function configuredWithoutToken(): BuildOptions {
  return {
    logger: false,
    auth: {
      configured: true,
      verify: async () => {
        throw new Error("unused");
      },
    },
  };
}

export async function anonymousApp() {
  return buildApp(configuredWithoutToken());
}
