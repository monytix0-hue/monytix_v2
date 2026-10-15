import type { FastifyPluginAsync } from "fastify";

const unavailable = { available: false };

function requireOwner(
  request: { actorId?: string | null; ownerId?: string | null },
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
): boolean {
  if (!request.actorId) {
    reply.status(401).send({ error: "unauthorized" });
    return false;
  }
  if (!request.ownerId) {
    reply.status(403).send({ error: "owner_forbidden" });
    return false;
  }
  return true;
}

/** Finalized M.I.L.E. is not stored yet, so the UI reads stay empty. */
export const mileRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/mile/summary", async (request, reply) => {
    if (!requireOwner(request, reply)) {
      return;
    }
    return {
      contract: "mile-summary-v0.1",
      empty_state: true,
      period: unavailable,
      distance: unavailable,
      months: [],
      impact: unavailable,
      outcomes: [],
      movement: unavailable,
      report: unavailable,
      lifetime: unavailable,
    };
  });

  app.get("/v1/mile/events", async (request, reply) => {
    if (!requireOwner(request, reply)) {
      return;
    }
    return {
      contract: "mile-events-v0.1",
      events: [],
    };
  });

  app.get<{ Params: { eventId: string } }>("/v1/mile/events/:eventId", async (request, reply) => {
    if (!requireOwner(request, reply)) {
      return;
    }
    return reply.status(404).send({ error: "not_found" });
  });
};
