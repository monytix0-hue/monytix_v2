import type { FastifyPluginAsync } from "fastify";

export type AuthenticatedSession = {
  module: "auth";
  status: "authenticated";
  actorId: string;
  ownerId: string | null;
};

/** Authenticated session for the verified Firebase subject. */
export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get("/auth", async (request): Promise<AuthenticatedSession> => {
    return {
      module: "auth",
      status: "authenticated",
      actorId: request.actorId ?? "",
      ownerId: request.ownerId ?? null,
    };
  });
};
