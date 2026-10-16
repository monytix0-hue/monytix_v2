import pg from "pg";
import { createImportStore, type ImportStore } from "../imports/store.js";
import { createObjectStorage, storageConfigFromEnv, type ObjectStorage } from "../imports/storage.js";
import type { ExtractedHandoff } from "./mime.js";
import { pollConnection, workerError, workerFailure, type PollConnection } from "./poll.js";
import { unsealCredential } from "./secret.js";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const storageConfig = storageConfigFromEnv();
const clientId = process.env.GMAIL_CLIENT_ID?.trim() ?? "";
const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim() ?? "";
const tokenUri = process.env.GMAIL_TOKEN_URI?.trim() || "https://oauth2.googleapis.com/token";
const encryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY?.trim() ?? "";

if (!databaseUrl || !storageConfig || !clientId || !clientSecret || !encryptionKey) {
  console.error(JSON.stringify({ level: "error", module: "gmail-worker", event: "idle", reason: "unconfigured" }));
} else {
  const storage = createObjectStorage(storageConfig);
  const imports = createImportStore(databaseUrl);
  void run(databaseUrl, storage, imports);
}

async function run(url: string, storage: ObjectStorage, imports: ImportStore): Promise<void> {
  await tick(url, storage, imports).catch((error: unknown) => logFailure("tick_failed", error));
  setInterval(() => {
    void tick(url, storage, imports).catch((error: unknown) => logFailure("tick_failed", error));
  }, 60_000);
}

async function tick(url: string, storage: ObjectStorage, imports: ImportStore): Promise<void> {
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
      const actorId = row.actor_id;
      try {
        const connection: PollConnection = {
          gmailConnectionId: row.gmail_connection_id,
          ownerId: row.owner_id,
          actorId,
          refreshToken: unsealCredential(row.credential_ciphertext, encryptionKey),
          historyCheckpoint: row.history_checkpoint,
          initialWindowDrained: row.initial_window_drained === true,
        };
        const counts = await pollOne(connection, row.gmail_connection_id, row.owner_id, actorId, client, storage, imports);
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
    }));
  } finally {
    await client.end();
  }
}

async function pollOne(
  connection: PollConnection,
  connectionId: string,
  ownerId: string,
  actorId: string,
  client: pg.Client,
  storage: ObjectStorage,
  imports: ImportStore,
): Promise<{ stored: number; skipped: number }> {
  return pollConnection(connection, {
        fetchImpl: async (target, init) => {
          const response = await fetch(target, init);
          return { status: response.status, json: () => response.json() as Promise<unknown> };
        },
        clientId,
        clientSecret,
        tokenUri,
        alreadyImported: async (messageId, partIndex, idempotencyKey) => {
          const found = await client.query<{ done: boolean }>(
            "SELECT ops.gmail_part_imported($1::uuid, $2, $3, $4) AS done",
            [connectionId, messageId, partIndex, idempotencyKey],
          );
          return found.rows[0]?.done === true;
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
        saveHandoff: async (handoff) => {
          await saveHandoff(client, ownerId, handoff);
        },
        saveDueDate: async (due) => {
          await client.query(
            "SELECT ops.save_due_date_notification($1::uuid, $2::uuid, $3, $4, $5::numeric, $6::date, $7)",
            [ownerId, connectionId, due.messageId, due.biller, due.amount, due.dueDate, due.category],
          );
        },
        authorize: async (input) => {
          const result = await imports.authorize({
            actorId,
            ownerId,
            idempotencyKey: input.idempotencyKey,
            fileType: input.fileType,
            byteSize: input.byteSize,
            sha256: input.sha256,
            filename: input.filename,
            sourceMetadata: input.sourceMetadata,
            financialAccountId: null,
          });
          return { outcome: result.outcome, importId: importIdOf(result.body) };
        },
        storage,
        complete: async (input) => {
          const completed = await imports.complete({
            actorId,
            ownerId,
            importId: input.importId,
            size: input.size,
            mime: input.mime,
            sha256: input.sha256,
            etag: input.etag,
            finalKey: `owners/${ownerId}/imports/${input.importId}/object`,
          });
          if (completed.outcome !== "created" && completed.outcome !== "replay") {
            throw workerError("gmail statement complete failed", "complete_failed");
          }
        },
        setCheckpoint: async (checkpoint) => {
          await client.query("SELECT ops.set_gmail_history_checkpoint($1::uuid, $2)", [connectionId, checkpoint]);
        },
        markWindowDrained: async () => {
          await client.query("SELECT ops.mark_gmail_window_drained($1::uuid)", [connectionId]);
        },
  });
}

async function saveHandoff(client: pg.Client, ownerId: string, handoff: ExtractedHandoff): Promise<void> {
  await client.query(
    "SELECT ops.save_gmail_handoff($1::uuid, $2::uuid, $3, $4, $5, $6::bigint, $7, $8, $9::jsonb)",
    [
      ownerId,
      handoff.gmailConnectionId,
      handoff.gmailMessageId,
      handoff.partIndex,
      handoff.fileType,
      handoff.byteSize,
      handoff.sha256,
      handoff.originalFilename,
      JSON.stringify(handoff.provenance),
    ],
  );
}

function importIdOf(body: Record<string, unknown> | undefined): string | null {
  const data = body?.data;
  if (!data || typeof data !== "object") {
    return null;
  }
  const importId = (data as { import_id?: unknown }).import_id;
  return typeof importId === "string" ? importId : null;
}

function logFailure(event: "tick_failed" | "connection_failed", error: unknown): void {
  const failure = workerFailure(error);
  console.error(JSON.stringify({ level: "error", module: "gmail-worker", event, name: failure.name, code: failure.code }));
}
