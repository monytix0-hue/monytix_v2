import type { FastifyPluginAsync } from "fastify";
import { openPool } from "../db/pool.js";

export type MissionsStub = {
  module: "missions";
  status: "stub";
};

const ownerUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const emptyBoard = {
  contract: "ui-missions-v0.1",
  empty_state: true,
  active_mission_count: 0,
  summary: { available: false },
  active: [],
  completed: [],
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

/** Phone reads published missions. Without a database the list stays empty. */
export const missionsRoutes: FastifyPluginAsync<{ databaseUrl?: string }> = async (app, options) => {
  const pool = options.databaseUrl ? openPool(options.databaseUrl) : null;
  if (pool) {
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }

  app.get("/missions", async (): Promise<MissionsStub> => {
    return { module: "missions", status: "stub" };
  });

  app.get("/v1/ui/missions", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (!pool || !request.ownerId || !ownerUuid.test(request.ownerId)) return emptyBoard;
    const result = await pool.query<{ board: Record<string, unknown> | null }>(
      "SELECT ops.phone_mission_board($1::uuid) AS board",
      [request.ownerId],
    );
    return result.rows[0]?.board ?? emptyBoard;
  });

  app.get<{ Params: { code: string } }>("/v1/ui/missions/definitions/:code", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (!pool) return reply.status(404).send({ error: "not_found" });
    const result = await pool.query<{ doc: Record<string, unknown> | null }>(
      "SELECT ops.phone_mission_definition($1) AS doc",
      [request.params.code],
    );
    const doc = result.rows[0]?.doc;
    if (!doc) return reply.status(404).send({ error: "not_found" });
    return doc;
  });

  app.get<{ Params: { missionId: string } }>("/v1/ui/missions/:missionId", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (!pool || !request.ownerId || !ownerUuid.test(request.ownerId) || !ownerUuid.test(request.params.missionId)) {
      return reply.status(404).send({ error: "not_found" });
    }
    const result = await pool.query<{ doc: Record<string, unknown> | null }>(
      "SELECT ops.phone_mission_detail($1::uuid, $2::uuid) AS doc",
      [request.ownerId, request.params.missionId],
    );
    const doc = result.rows[0]?.doc;
    if (!doc) return reply.status(404).send({ error: "not_found" });
    return doc;
  });

  app.get<{ Params: { missionId: string } }>("/v1/ui/missions/:missionId/journal", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (!pool || !request.ownerId || !ownerUuid.test(request.ownerId) || !ownerUuid.test(request.params.missionId)) {
      return reply.status(404).send({ error: "not_found" });
    }
    const result = await pool.query<{ doc: Record<string, unknown> | null }>(
      "SELECT ops.phone_mission_journal($1::uuid, $2::uuid) AS doc",
      [request.ownerId, request.params.missionId],
    );
    const doc = result.rows[0]?.doc;
    if (!doc) return reply.status(404).send({ error: "not_found" });
    return doc;
  });

  app.get<{ Params: { missionId: string } }>("/v1/ui/missions/:missionId/completion", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (!pool || !request.ownerId || !ownerUuid.test(request.ownerId) || !ownerUuid.test(request.params.missionId)) {
      return reply.status(404).send({ error: "not_found" });
    }
    const result = await pool.query<{ doc: Record<string, unknown> | null }>(
      "SELECT ops.phone_mission_completion($1::uuid, $2::uuid) AS doc",
      [request.ownerId, request.params.missionId],
    );
    const doc = result.rows[0]?.doc;
    if (!doc) return reply.status(404).send({ error: "not_found" });
    return doc;
  });

  app.post("/v1/missions", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (!pool || !request.ownerId || !ownerUuid.test(request.ownerId)) return reply.status(404).send({ error: "not_found" });
    const body = request.body as { canonical_mission_code?: string; reach_amount?: number; current_amount?: number } | null;
    const reach = Number(body?.reach_amount);
    if (!body?.canonical_mission_code || !Number.isFinite(reach) || reach <= 0) return reply.status(400).send({ error: "invalid_request" });
    const result = await pool.query<{ id: string | null }>(
      "SELECT ops.create_user_mission($1::uuid, $2, $3, $4)::text AS id",
      [request.ownerId, body.canonical_mission_code, reach, Number(body.current_amount) || 0],
    );
    const id = result.rows[0]?.id;
    if (!id) return reply.status(404).send({ error: "not_found" });
    return { mission_id: id };
  });

  app.post<{ Params: { missionId: string } }>("/v1/missions/:missionId/actions", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (!pool || !request.ownerId || !ownerUuid.test(request.ownerId) || !ownerUuid.test(request.params.missionId)) {
      return reply.status(404).send({ error: "not_found" });
    }
    const body = request.body as { action?: string; amount?: number; note?: string } | null;
    if (body?.action !== "ADD_PROGRESS") return reply.status(400).send({ error: "invalid_request" });
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return reply.status(400).send({ error: "invalid_request" });
    const keyHeader = request.headers["idempotency-key"];
    const key = (typeof keyHeader === "string" && keyHeader) || `mission-progress:${request.params.missionId}:${amount}:${body.note || ""}`;
    const result = await pool.query<{ saved: Record<string, unknown> | null }>(
      "SELECT ops.add_mission_progress($1::uuid, $2::uuid, $3, $4, $5) AS saved",
      [request.ownerId, request.params.missionId, amount, body.note ?? null, key],
    );
    const saved = result.rows[0]?.saved;
    if (!saved) return reply.status(404).send({ error: "not_found" });
    return saved;
  });
};
