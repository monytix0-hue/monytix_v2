import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError } from "./errors.js";
import type { IdentityStore } from "./identity.js";
import type { TokenVerifier } from "./verifier.js";

export type AuthConfig = {
  configured: boolean;
  verify: TokenVerifier;
};

const ownerHeader = "x-monytix-owner-id";

export function registerAuthGuard(
  app: FastifyInstance,
  auth: AuthConfig,
  identity: IdentityStore | null,
): void {
  app.addHook("onRequest", async (request, reply) => {
    if (isPublic(request.url)) {
      return;
    }

    if (!auth.configured) {
      return sendAuthError(reply, new AuthError(503, "auth_unconfigured"));
    }

    const token = bearerToken(request.headers.authorization);
    if (!token) {
      return sendAuthError(reply, new AuthError(401, "unauthorized"));
    }

    try {
      const verified = await auth.verify(token);
      if (!identity) {
        throw new AuthError(503, "auth_unconfigured");
      }
      const actor = await identity.provisionActor({
        subject: verified.subject,
        email: verified.email,
      });
      const requestedOwner = headerValue(request.headers[ownerHeader]);
      const ownerId = await identity.resolveOwner(actor.actorId, requestedOwner);
      request.actorId = actor.actorId;
      request.ownerId = ownerId;
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code === "revoked" || code === "ERR_JWT_EXPIRED" || code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
        return sendAuthError(reply, new AuthError(401, code === "revoked" ? "revoked" : "unauthorized"));
      }
      return sendAuthError(reply, new AuthError(401, "unauthorized"));
    }
  });
}

function isPublic(url: string): boolean {
  const path = url.split("?")[0];
  return path === "/platform/health" || path === "/platform/ready" || path === "/gmail/webhook";
}

function bearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sendAuthError(reply: FastifyReply, error: AuthError): FastifyReply {
  return reply.status(error.statusCode).send({ error: error.code });
}

declare module "fastify" {
  interface FastifyRequest {
    actorId?: string;
    ownerId?: string | null;
  }
}
