import { openPool } from "../db/pool.js";
import { AuthError } from "./errors.js";

export type IdentityStore = {
  provisionActor(input: { subject: string; email: string | null }): Promise<{ actorId: string }>;
  resolveOwner(actorId: string, requestedOwnerId: string | null, email?: string | null): Promise<string | null>;
  ping(): Promise<void>;
  close(): Promise<void>;
};

export function createPgIdentity(databaseUrl: string): IdentityStore {
  const pool = openPool(databaseUrl);

  return {
    async provisionActor(input) {
      const result = await pool.query<{ provision_authenticated_actor: string }>(
        "SELECT ops.provision_authenticated_actor($1, $2, $3)",
        ["firebase", input.subject, input.email],
      );
      const actorId = result.rows[0]?.provision_authenticated_actor;
      if (!actorId) {
        throw new AuthError(503, "auth_unconfigured");
      }
      return { actorId };
    },

    async resolveOwner(actorId, requestedOwnerId, email = null) {
      if (requestedOwnerId) {
        const allowed = await pool.query<{ actor_can_access_owner: boolean }>(
          "SELECT ops.actor_can_access_owner($1, $2)",
          [actorId, requestedOwnerId],
        );
        if (!allowed.rows[0]?.actor_can_access_owner) {
          throw new AuthError(403, "owner_forbidden");
        }
        return requestedOwnerId;
      }

      const result = await pool.query<{ default_owner_for_actor: string | null }>(
        "SELECT ops.default_owner_for_actor($1)",
        [actorId],
      );
      const existing = result.rows[0]?.default_owner_for_actor ?? null;
      if (existing) {
        return existing;
      }

      const ensured = await pool.query<{ ensure_personal_owner: string }>(
        "SELECT ops.ensure_personal_owner($1, $2)",
        [actorId, email],
      );
      const ownerId = ensured.rows[0]?.ensure_personal_owner;
      if (!ownerId) {
        throw new AuthError(503, "auth_unconfigured");
      }
      return ownerId;
    },

    async ping() {
      await pool.query("SELECT 1");
    },

    async close() {
      await pool.end();
    },
  };
}
