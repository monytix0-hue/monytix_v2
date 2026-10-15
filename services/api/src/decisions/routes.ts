import type { FastifyPluginAsync } from "fastify";

export type DecisionsStub = {
  module: "decisions";
  status: "stub";
};

/** Decision records. Published decisions are not stored yet, so the UI read is empty. */
export const decisionsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/decisions", async (): Promise<DecisionsStub> => {
    return { module: "decisions", status: "stub" };
  });

  app.get("/v1/ui/decisions", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    return {
      contract: "ui-decisions-v0.1",
      empty_state: true,
      active_decision_count: 0,
      heaviest: { available: false },
      decisions: [],
    };
  });

  app.get<{ Params: { decisionId: string } }>("/v1/ui/decisions/:decisionId/weights", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    return reply.status(404).send({ error: "not_found" });
  });
};
