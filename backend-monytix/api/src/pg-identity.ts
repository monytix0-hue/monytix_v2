import type pg from "pg";
import type { IdentityStore } from "./app.js";
import { AuthError } from "./app.js";

export class PgIdentity implements IdentityStore {
  constructor(private readonly pool: pg.Pool) {}

  async provisionActor(subject: string, email: string | null): Promise<string> {
    const result = await this.pool.query<{ actor_id: string }>(
      "SELECT ops.provision_authenticated_actor($1, $2, $3) AS actor_id",
      ["firebase", subject, email],
    );
    const actorId = result.rows[0]?.actor_id;
    if (!actorId) throw new AuthError(503, "auth_unconfigured");
    return actorId;
  }

  async resolveOwner(actorId: string, requested: string | null, email: string | null): Promise<string> {
    if (requested) {
      const allowed = await this.pool.query<{ allowed: boolean }>(
        "SELECT ops.actor_can_access_owner($1, $2) AS allowed",
        [actorId, requested],
      );
      if (!allowed.rows[0]?.allowed) throw new AuthError(403, "owner_forbidden");
      return requested;
    }
    const existing = await this.pool.query<{ owner_id: string | null }>(
      "SELECT ops.default_owner_for_actor($1) AS owner_id",
      [actorId],
    );
    if (existing.rows[0]?.owner_id) return existing.rows[0].owner_id;
    const created = await this.pool.query<{ owner_id: string }>(
      "SELECT ops.ensure_personal_owner($1, $2) AS owner_id",
      [actorId, email],
    );
    const ownerId = created.rows[0]?.owner_id;
    if (!ownerId) throw new AuthError(503, "auth_unconfigured");
    return ownerId;
  }
}
