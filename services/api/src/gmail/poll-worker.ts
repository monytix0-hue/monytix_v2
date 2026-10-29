import pg from "pg";
import { redactGmailLog } from "./log.js";
import { pollConnection, refreshAccessToken, workerFailure, type PollConnection } from "./poll.js";
import { unsealCredential } from "./secret.js";
import { renewWatch } from "./watch.js";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const clientId = process.env.GMAIL_CLIENT_ID?.trim() ?? "";
const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim() ?? "";
const tokenUri = process.env.GMAIL_TOKEN_URI?.trim() || "https://oauth2.googleapis.com/token";
const encryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
const pubsubTopic = process.env.GMAIL_PUBSUB_TOPIC?.trim() ?? "";
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
      owner_timezone: string | null;
      owner_currency: string | null;
      owner_country: string | null;
      owner_locale: string | null;
      mailbox_address: string;
      watch_expires_at: Date | null;
    }>("SELECT * FROM ops.list_gmail_poll_targets()");
    let stored = 0;
    let skipped = 0;
    let watchesRenewed = 0;
    for (const row of listed.rows) {
      if (!row.actor_id) {
        continue;
      }
      let refreshToken: string;
      try {
        refreshToken = unsealCredential(row.credential_ciphertext, encryptionKey);
      } catch (error) {
        logFailure("connection_failed", error);
        continue;
      }
      const connection: PollConnection = {
        gmailConnectionId: row.gmail_connection_id,
        ownerId: row.owner_id,
        actorId: row.actor_id,
        refreshToken,
        historyCheckpoint: row.history_checkpoint,
        initialWindowDrained: row.initial_window_drained === true,
        timezone: row.owner_timezone,
        defaultCurrency: row.owner_currency,
        country: row.owner_country,
        locale: row.owner_locale,
      };
      // Renew before polling: a lapsed watch is why the next tick may never be
      // triggered by push, so repairing it is what keeps the channel alive.
      if (await renewOneWatch(connection, row.mailbox_address, row.watch_expires_at, client)) {
        watchesRenewed += 1;
      }
      try {
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
      watchesRenewed,
      dryRun,
    }));
  } finally {
    await client.end();
  }
}

/**
 * Renew this connection's Gmail watch when it is missing or close to lapsing.
 * Returns true when a new watch was written. Errors are logged, never thrown: a
 * watch failure must not stop the poll that follows it.
 */
async function renewOneWatch(
  connection: PollConnection,
  mailbox: string,
  watchExpiresAt: Date | null,
  client: pg.Client,
): Promise<boolean> {
  const fetchImpl = async (target: string, init?: RequestInit) => {
    const response = await fetch(target, init);
    return { status: response.status, json: () => response.json() as Promise<unknown> };
  };
  const outcome = await renewWatch(
    {
      gmailConnectionId: connection.gmailConnectionId,
      ownerId: connection.ownerId,
      refreshToken: connection.refreshToken,
      watchExpiresAt,
    },
    {
      fetchImpl,
      topic: pubsubTopic,
      project: process.env.GCP_PROJECT_ID?.trim() ?? "",
      clientId,
      clientSecret,
      tokenUri,
      // Reuse the poller's refresh rather than a second implementation of it. The
      // remaining ports are unreachable on this path -- refreshAccessToken reads
      // only clientId, clientSecret, tokenUri and fetchImpl.
      accessToken: (refreshToken) =>
        refreshAccessToken(refreshToken, {
          fetchImpl,
          clientId,
          clientSecret,
          tokenUri,
          dryRun,
          debug: () => {},
          saveCandidate: async () => {},
          saveDueDate: async () => {},
          saveSpotTransaction: async () => "replay",
          setCheckpoint: async () => {},
          markWindowDrained: async () => {},
        }),
      saveWatch: async (input) => {
        await client.query("SELECT ops.set_gmail_watch($1::uuid, $2, $3::timestamptz)", [
          input.ownerId,
          input.mailbox,
          input.expiresAt,
        ]);
      },
      mailbox,
      log: (event) => {
        console.log(JSON.stringify(redactGmailLog(event)));
      },
    },
  );
  return outcome.status === "renewed";
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
        "SELECT ops.save_due_date_notification($1::uuid, $2::uuid, $3, $4, $5::numeric, $6::date, $7, $8)",
        [ownerId, connectionId, due.messageId, due.biller, due.amount, due.dueDate, due.category, due.currency],
      );
    },
    saveSpotTransaction: async (spot) => {
      const saved = await client.query<{ result: { outcome?: string; gmail_spot_transaction_id?: string } }>(
        `SELECT ops.save_gmail_spot_transaction(
           $1::uuid, $2::uuid, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11::timestamptz, $12,
           $13, $14, $15::numeric, $16::numeric, $17
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
          spot.currency,
          spot.currencyBasis,
          spot.currencyConfidence,
          spot.statedAmount ?? null,
          spot.statedCurrency ?? null,
        ],
      );
      const outcome = saved.rows[0]?.result?.outcome;
      const spotId = saved.rows[0]?.result?.gmail_spot_transaction_id;
      // A save that reports success but hands back no id means the RPC lost the
      // key the caller promotes on (0056 did exactly that). Fail loudly: the
      // alternative is what happened for two days -- a healthy `stored` count and
      // an empty ledger, with nothing in the log to say why.
      if (!spotId && outcome !== "invalid") {
        throw new Error(
          `save_gmail_spot_transaction returned ${outcome ?? "nothing"} with no spot id; the alert cannot be promoted`,
        );
      }
      if (spotId) {
        await client.query("SELECT ops.promote_gmail_spot($1::uuid)", [spotId]);
      }
      return outcome === "created" ? "created" : "replay";
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
