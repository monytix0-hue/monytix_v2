import type { FastifyPluginAsync } from "fastify";

export type MissionsStub = {
  module: "missions";
  status: "stub";
};

function requireOwner(request: { actorId?: string | null; ownerId?: string | null }, reply: { status: (code: number) => { send: (body: unknown) => unknown } }): boolean {
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

/** Mission plans. Published missions are not stored yet, so the UI read is empty. */
export const missionsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/missions", async (): Promise<MissionsStub> => {
    return { module: "missions", status: "stub" };
  });

  app.get("/v1/ui/missions", async (request, reply) => {
    if (!requireOwner(request, reply)) {
      return;
    }
    return {
      contract: "ui-missions-v0.1",
      empty_state: true,
      active_mission_count: 0,
      summary: { available: false },
      active: [],
      completed: [],
    };
  });

  app.get<{ Params: { missionId: string } }>("/v1/ui/missions/:missionId", async (request, reply) => {
    if (!requireOwner(request, reply)) {
      return;
    }
    return reply.status(404).send({ error: "not_found" });
  });

  app.get<{ Params: { missionId: string } }>("/v1/ui/missions/:missionId/journal", async (request, reply) => {
    if (!requireOwner(request, reply)) {
      return;
    }
    return reply.status(404).send({ error: "not_found" });
  });

  app.get<{ Params: { missionId: string } }>("/v1/ui/missions/:missionId/completion", async (request, reply) => {
    if (!requireOwner(request, reply)) {
      return;
    }
    return reply.status(404).send({ error: "not_found" });
  });
};
