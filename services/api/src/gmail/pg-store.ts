import { openPool } from "../db/pool.js";
import type { GmailConnection } from "./model.js";
import type { GmailNotificationStore } from "./webhook.js";

type ConnectionQuery = {
  gmail_connection_id: string;
  owner_id: string;
  source_connection_id: string;
  mailbox_address: string;
  oauth_state: GmailConnection["oauthState"];
  credential_ref: string;
  watch_expires_at: Date | null;
  history_checkpoint: string | null;
  sync_state: GmailConnection["syncState"];
  error_state: string | null;
};

export function createPgGmailStore(databaseUrl: string): GmailNotificationStore {
  const pool = openPool(databaseUrl);
  return {
    async findByMailbox(mailboxAddress) {
      const result = await pool.query<ConnectionQuery>(
        `SELECT gmail_connection_id, owner_id, source_connection_id, mailbox_address, oauth_state,
                credential_ref, watch_expires_at, history_checkpoint, sync_state, error_state
           FROM core.gmail_connection
          WHERE mailbox_address = $1`,
        [mailboxAddress.trim().toLowerCase()],
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return {
        gmailConnectionId: row.gmail_connection_id,
        ownerId: row.owner_id,
        sourceConnectionId: row.source_connection_id,
        mailboxAddress: row.mailbox_address,
        oauthState: row.oauth_state,
        credentialRef: row.credential_ref,
        watchExpiresAt: row.watch_expires_at ? row.watch_expires_at.toISOString() : null,
        historyCheckpoint: row.history_checkpoint,
        syncState: row.sync_state,
        errorState: row.error_state,
      };
    },
    async recordNotification(input) {
      const result = await pool.query<{ result: { outcome: string; job_id?: string } }>(
        "SELECT ops.record_gmail_notification($1::uuid, $2::uuid, $3, $4) AS result",
        [input.ownerId, input.gmailConnectionId, input.pubsubMessageId, input.historyId],
      );
      const outcome = result.rows[0]?.result.outcome ?? "not_found";
      if (outcome === "not_found" || outcome === "invalid") {
        throw new Error("owner_isolation");
      }
      return {
        disposition: outcome.toUpperCase() as "BASELINE" | "QUEUED" | "DUPLICATE" | "OUT_OF_ORDER",
        jobId: result.rows[0]?.result.job_id,
      };
    },
    async close() {
      await pool.end();
    },
  };
}
