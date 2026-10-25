import type { FastifyPluginAsync } from "fastify";
import { openPool } from "../db/pool.js";

export type DecisionsStub = {
  module: "decisions";
  status: "stub";
};

const ownerUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const emptyBoard = {
  contract: "ui-decisions-v0.1",
  empty_state: true,
  active_decision_count: 0,
  heaviest: { available: false },
  decisions: [],
};

/** Phone reads the published board. Without a database the list stays empty. */
export const decisionsRoutes: FastifyPluginAsync<{ databaseUrl?: string }> = async (app, options) => {
  const pool = options.databaseUrl ? openPool(options.databaseUrl) : null;
  if (pool) {
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }

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
    if (!pool || !ownerUuid.test(request.ownerId)) return emptyBoard;
    const result = await pool.query<{ board: Record<string, unknown> | null }>(
      "SELECT ops.phone_decision_board($1::uuid) AS board",
      [request.ownerId],
    );
    return result.rows[0]?.board ?? emptyBoard;
  });

  app.get<{ Params: { decisionId: string } }>("/v1/ui/decisions/:decisionId/weights", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    if (!pool || !ownerUuid.test(request.ownerId) || !ownerUuid.test(request.params.decisionId)) {
      return reply.status(404).send({ error: "not_found" });
    }
    const result = await pool.query<{ screen: Record<string, unknown> | null }>(
      "SELECT ops.phone_decision_screen($1::uuid, $2::uuid) AS screen",
      [request.ownerId, request.params.decisionId],
    );
    const screen = result.rows[0]?.screen;
    if (!screen) return reply.status(404).send({ error: "not_found" });
    return screen;
  });
};
