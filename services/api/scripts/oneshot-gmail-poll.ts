/**
 * One-shot full-window poll for one mailbox (Phase 1 validation).
 *   MAILBOX=santoshmalla221989@gmail.com npx tsx scripts/oneshot-gmail-poll.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { pollConnection, type PollConnection } from "../src/gmail/poll.js";
import { unsealCredential } from "../src/gmail/secret.js";

function loadEnv(): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of readFileSync(resolve(process.cwd(), "../../.env"), "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    pairs[trimmed.slice(0, i).trim()] = value;
  }
  return pairs;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const mailbox = (process.env.MAILBOX ?? "santoshmalla221989@gmail.com").trim().toLowerCase();
  const client = new pg.Client({
    host: env.POSTGRES_HOST,
    port: Number(env.POSTGRES_PORT || 5432),
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const row = await client.query<{
    gmail_connection_id: string;
    owner_id: string;
    credential_ciphertext: string;
    history_checkpoint: string | null;
    initial_window_drained: boolean;
    actor_id: string;
  }>(
    `SELECT g.gmail_connection_id::text, g.owner_id::text, g.credential_ciphertext,
            g.history_checkpoint, g.initial_window_drained, m.actor_id::text
       FROM core.gmail_connection g
       JOIN core.actor_owner_membership m
         ON m.owner_id = g.owner_id AND m.membership_status = 'ACTIVE'
      WHERE lower(g.mailbox_address) = $1
      LIMIT 1`,
    [mailbox],
  );
  const conn = row.rows[0];
  if (!conn?.actor_id) {
    throw new Error(`no connection/actor for ${mailbox}`);
  }

  console.log(JSON.stringify({
    event: "poll_start",
    mailbox,
    connectionId: conn.gmail_connection_id,
    drained: conn.initial_window_drained,
    checkpoint: conn.history_checkpoint,
  }));

  const connection: PollConnection = {
    gmailConnectionId: conn.gmail_connection_id,
    ownerId: conn.owner_id,
    actorId: conn.actor_id,
    refreshToken: unsealCredential(conn.credential_ciphertext, env.GMAIL_TOKEN_ENCRYPTION_KEY),
    historyCheckpoint: conn.history_checkpoint,
    initialWindowDrained: conn.initial_window_drained === true,
  };

  const result = await pollConnection(connection, {
    fetchImpl: async (target, init) => {
      const response = await fetch(target, init);
      return { status: response.status, json: () => response.json() as Promise<unknown> };
    },
    clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET,
    tokenUri: env.GMAIL_TOKEN_URI || "https://oauth2.googleapis.com/token",
    dryRun: false,
    debug: (event) => console.log(JSON.stringify({ module: "oneshot-poll", ...event })),
    saveCandidate: async (candidate) => {
      await client.query(
        "SELECT ops.save_gmail_candidate($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)",
        [
          conn.owner_id,
          conn.gmail_connection_id,
          candidate.messageId,
          candidate.partIndex,
          candidate.mimeType,
          candidate.contentSha256,
          JSON.stringify(candidate.provenance),
        ],
      );
    },
    saveDueDate: async (due) => {
      await client.query(
        "SELECT ops.save_due_date_notification($1::uuid, $2::uuid, $3, $4, $5::numeric, $6::date, $7)",
        [conn.owner_id, conn.gmail_connection_id, due.messageId, due.biller, due.amount, due.dueDate, due.category],
      );
    },
    saveSpotTransaction: async (spot) => {
      const saved = await client.query<{ result: { outcome?: string; gmail_spot_transaction_id?: string } }>(
        `SELECT ops.save_gmail_spot_transaction(
           $1::uuid, $2::uuid, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11::timestamptz, $12
         ) AS result`,
        [
          conn.owner_id,
          conn.gmail_connection_id,
          spot.messageId,
          spot.idempotencyKey,
          spot.flow,
          spot.amount,
          spot.accountLast4 ?? null,
          spot.paymentRef ?? null,
          spot.channel,
          spot.counterparty,
          spot.postedAt ?? null,
          spot.rawExcerpt,
        ],
      );
      const spotId = saved.rows[0]?.result?.gmail_spot_transaction_id;
      if (spotId) {
        await client.query("SELECT ops.promote_gmail_spot($1::uuid)", [spotId]);
      }
      return saved.rows[0]?.result?.outcome === "created" ? "created" : "replay";
    },
    setCheckpoint: async (checkpoint) => {
      await client.query("SELECT ops.set_gmail_history_checkpoint($1::uuid, $2)", [
        conn.gmail_connection_id,
        checkpoint,
      ]);
    },
    markWindowDrained: async () => {
      await client.query("SELECT ops.mark_gmail_window_drained($1::uuid)", [conn.gmail_connection_id]);
    },
  });

  console.log(JSON.stringify({ event: "poll_done", mailbox, ...result }));
  await client.end();
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "poll_fatal",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exit(1);
});
