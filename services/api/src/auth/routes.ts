import type { FastifyPluginAsync } from "fastify";
import type { AuthConfig } from "./guard.js";

export type AuthenticatedSession = {
  module: "auth";
  status: "authenticated";
  actorId: string;
  ownerId: string | null;
};

export type AuthRouteOptions = {
  auth: AuthConfig;
};

/** Authenticated session for the verified Firebase subject. */
export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, options) => {
  app.get("/auth", async (request): Promise<AuthenticatedSession> => {
    return {
      module: "auth",
      status: "authenticated",
      actorId: request.actorId ?? "",
      ownerId: request.ownerId ?? null,
    };
  });

  /** Revoke Firebase refresh tokens for this subject. Local client sign-out follows. */
  app.post("/auth/logout", async (request, reply) => {
    const subject = request.authSubject ?? "";
    if (subject.length > 0 && options.auth.revokeRefreshTokens) {
      await options.auth.revokeRefreshTokens(subject);
    }
    return reply.status(204).send();
  });
};
