import type { FastifyPluginAsync } from "fastify";
import { openPool } from "../db/pool.js";

const unavailable = { available: false };
const ownerUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const emptySummary = {
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

/** Phone reads finalized M.I.L.E. Without a database the summary stays empty. */
export const mileRoutes: FastifyPluginAsync<{ databaseUrl?: string }> = async (app, options) => {
  const pool = options.databaseUrl ? openPool(options.databaseUrl) : null;
  if (pool) {
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }

  app.get("/v1/mile/summary", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (!pool || !request.ownerId || !ownerUuid.test(request.ownerId)) return emptySummary;
    const result = await pool.query<{ doc: Record<string, unknown> | null }>(
      "SELECT ops.phone_mile_summary($1::uuid) AS doc",
      [request.ownerId],
    );
    return result.rows[0]?.doc ?? emptySummary;
  });

  app.get("/v1/mile/events", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (!pool || !request.ownerId || !ownerUuid.test(request.ownerId)) {
      return { contract: "mile-events-v0.1", events: [] };
    }
    const result = await pool.query<{ doc: Record<string, unknown> | null }>(
      "SELECT ops.phone_mile_events($1::uuid) AS doc",
      [request.ownerId],
    );
    return result.rows[0]?.doc ?? { contract: "mile-events-v0.1", events: [] };
  });

  app.get<{ Params: { eventId: string } }>("/v1/mile/events/:eventId", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (!pool || !request.ownerId || !ownerUuid.test(request.ownerId) || !ownerUuid.test(request.params.eventId)) {
      return reply.status(404).send({ error: "not_found" });
    }
    const result = await pool.query<{ doc: Record<string, unknown> | null }>(
      "SELECT ops.phone_mile_event($1::uuid, $2::uuid) AS doc",
      [request.ownerId, request.params.eventId],
    );
    const doc = result.rows[0]?.doc;
    if (!doc) return reply.status(404).send({ error: "not_found" });
    return doc;
  });
};
