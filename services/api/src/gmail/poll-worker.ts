import pg from "pg";
import { redactGmailLog } from "./log.js";
import { pollConnection, workerFailure, type PollConnection } from "./poll.js";
import { unsealCredential } from "./secret.js";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const clientId = process.env.GMAIL_CLIENT_ID?.trim() ?? "";
const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim() ?? "";
const tokenUri = process.env.GMAIL_TOKEN_URI?.trim() || "https://oauth2.googleapis.com/token";
const encryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
const dryRun = process.env.GMAIL_DEBUG_DRY_RUN === "true";

if (!databaseUrl || !clientId || !clientSecret || !encryptionKey) {
  console.error(JSON.stringify({ level: "error", module: "gmail-worker", event: "idle", reason: "unconfigured" }));
} else {
  void run(databaseUrl);
}

async function run(url: string): Promise<void> {
  let running = false;
  let again = false;
  const kick = () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    void (async () => {
      try {
        do {
          again = false;
          await tick(url);
        } while (again);
      } catch (error: unknown) {
        logFailure("tick_failed", error);
      } finally {
        running = false;
        if (again) {
          kick();
        }
      }
    })();
  };
  await listenForIngest(url, kick).catch((error: unknown) => logFailure("tick_failed", error));
  kick();
  setInterval(kick, 60_000);
}

async function listenForIngest(url: string, kick: () => void): Promise<void> {
  const listener = new pg.Client({ connectionString: url });
  await listener.connect();
  await listener.query("LISTEN gmail_ingest");
  listener.on("notification", () => kick());
  listener.on("error", (error: unknown) => logFailure("tick_failed", error));
}

async function tick(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const listed = await client.query<{
      gmail_connection_id: string;
      owner_id: string;
      actor_id: string | null;
      history_checkpoint: string | null;
      credential_ciphertext: string;
      initial_window_drained: boolean;
    }>("SELECT * FROM ops.list_gmail_poll_targets()");
    let stored = 0;
    let skipped = 0;
    for (const row of listed.rows) {
      if (!row.actor_id) {
        continue;
      }
      try {
        const connection: PollConnection = {
          gmailConnectionId: row.gmail_connection_id,
          ownerId: row.owner_id,
          actorId: row.actor_id,
          refreshToken: unsealCredential(row.credential_ciphertext, encryptionKey),
          historyCheckpoint: row.history_checkpoint,
          initialWindowDrained: row.initial_window_drained === true,
        };
        const counts = await pollOne(connection, row.gmail_connection_id, row.owner_id, client);
        stored += counts.stored;
        skipped += counts.skipped;
      } catch (error) {
        logFailure("connection_failed", error);
      }
    }
    console.log(JSON.stringify({
      module: "gmail-worker",
      event: "tick",
      mailboxes: listed.rows.length,
      stored,
      skipped,
      dryRun,
    }));
  } finally {
    await client.end();
  }
}

async function pollOne(
  connection: PollConnection,
  connectionId: string,
  ownerId: string,
  client: pg.Client,
): Promise<{ stored: number; skipped: number }> {
  return pollConnection(connection, {
    fetchImpl: async (target, init) => {
      const response = await fetch(target, init);
      return { status: response.status, json: () => response.json() as Promise<unknown> };
    },
    clientId,
    clientSecret,
    tokenUri,
    dryRun,
    debug: (event) => {
      console.log(JSON.stringify({ module: "gmail-worker", ...event }));
    },
    saveCandidate: async (candidate) => {
      await client.query(
        "SELECT ops.save_gmail_candidate($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)",
        [
          ownerId,
          connectionId,
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
        [ownerId, connectionId, due.messageId, due.biller, due.amount, due.dueDate, due.category],
      );
    },
    saveSpotTransaction: async (spot) => {
      const saved = await client.query<{ result: { outcome?: string } }>(
        `SELECT ops.save_gmail_spot_transaction(
           $1::uuid, $2::uuid, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11::timestamptz, $12
         ) AS result`,
        [
          ownerId,
          connectionId,
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
      return saved.rows[0]?.result?.outcome === "created" ? "created" : "replay";
    },
    setCheckpoint: async (checkpoint) => {
      await client.query("SELECT ops.set_gmail_history_checkpoint($1::uuid, $2)", [connectionId, checkpoint]);
    },
    markWindowDrained: async () => {
      await client.query("SELECT ops.mark_gmail_window_drained($1::uuid)", [connectionId]);
    },
  });
}

function logFailure(event: "tick_failed" | "connection_failed", error: unknown): void {
  const failure = workerFailure(error);
  console.error(JSON.stringify(redactGmailLog({
    level: "error",
    module: "gmail-worker",
    event,
    name: failure.name,
    code: failure.code,
  })));
}
