/**
 * Re-fetch Gmail spot messages for one mailbox and rewrite counterparty + ledger titles.
 *
 *   MAILBOX=santoshmalla221989@gmail.com npx tsx scripts/reparse-gmail-spots.ts
 *   REPARSE_DRY_RUN=1 MAILBOX=santoshmalla221989@gmail.com npx tsx scripts/reparse-gmail-spots.ts
 */
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { parseTransactionFromEmail } from "../src/gmail/alertParser.js";
import { displayTransactionTitle } from "../src/live/displayTitle.js";
import { extractMimeMessage, messageDate, messageSubject, type ExtractedText } from "../src/gmail/mime.js";
import { unsealCredential } from "../src/gmail/secret.js";

const CONCURRENCY = Number(process.env.REPARSE_CONCURRENCY ?? 6);
const LOG = resolve(process.cwd(), "../../.local/reparse-gmail.log");

function loadEnv(): Record<string, string> {
  const path = resolve(process.cwd(), "../../.env");
  const pairs: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
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

function log(event: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  console.log(line);
  appendFileSync(LOG, `${line}\n`);
}

function alertBody(texts: ExtractedText[]): string {
  const plain = texts.filter((part) => part.mimeType === "text/plain").map((part) => part.text);
  const chosen = plain.length > 0 ? plain : texts.map((part) => part.text);
  return chosen.join("\n");
}

async function refreshAccessToken(env: Record<string, string>, refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.GMAIL_CLIENT_ID,
    client_secret: env.GMAIL_CLIENT_SECRET,
  });
  const response = await fetch(env.GMAIL_TOKEN_URI || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`token refresh failed: ${payload.error ?? response.status}`);
  }
  return payload.access_token;
}

async function fetchRaw(accessToken: string, messageId: string): Promise<"missing" | string> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=raw`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (response.status === 404) return "missing";
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error(`auth_${response.status}`), { code: "auth" });
  }
  if (!response.ok) throw new Error(`gmail get ${messageId} http_${response.status}`);
  const payload = await response.json() as { raw?: string };
  if (!payload.raw) return "missing";
  return payload.raw;
}

type SpotRow = {
  gmail_spot_transaction_id: string;
  gmail_message_id: string;
  logical_transaction_id: string | null;
  counterparty: string;
  channel: string;
};

async function writeLedgerTitle(
  db: pg.Client,
  logicalTransactionId: string,
  title: string,
  extras?: { amount?: string; direction?: "IN" | "OUT"; paymentRef?: string | null },
): Promise<boolean> {
  const current = await db.query<{
    canonical_transaction_version_id: string;
    version_no: number;
    financial_account_id: string;
    transaction_date: string;
    transaction_timestamp: string | null;
    amount: string;
    direction: string;
    currency_code: string;
    raw_description: string | null;
    source_reference: string | null;
    extraction_sequence: number | null;
  }>(
    `SELECT canonical_transaction_version_id::text, version_no, financial_account_id::text,
            transaction_date::text, transaction_timestamp::text, amount::text, direction,
            currency_code, raw_description, source_reference, extraction_sequence
       FROM core.canonical_transaction_version
      WHERE logical_transaction_id = $1::uuid AND is_current
      LIMIT 1`,
    [logicalTransactionId],
  );
  const row = current.rows[0];
  if (!row) return false;
  const amount = extras?.amount ?? row.amount;
  const direction = extras?.direction ?? row.direction;
  const sourceRef = extras?.paymentRef !== undefined ? extras.paymentRef : row.source_reference;
  if (
    row.raw_description === title
    && String(row.amount) === String(amount)
    && row.direction === direction
    && (sourceRef ?? null) === (row.source_reference ?? null)
  ) {
    return false;
  }
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO core.canonical_transaction_version (
        logical_transaction_id, version_no, is_current, supersedes_version_id, financial_account_id,
        transaction_date, transaction_timestamp, amount, direction, currency_code,
        raw_description, normalized_description, source_reference,
        extraction_sequence, normalization_status, normalization_confidence,
        normalization_reason_codes, normalization_version, change_provenance, duplicate_outcome,
        legacy_limitation_flags
     ) VALUES (
        $1::uuid, $2, false, $3::uuid, $4::uuid,
        $5::date, $6::timestamptz, $7::numeric, $8, $9,
        $10, $10, $11,
        $12, 'READY', 1,
        ARRAY['GMAIL_SPOT','GMAIL_REPARSE']::text[], 'GMAIL-SPOT-v2', 'SYSTEM_REPROCESS', 'DISTINCT',
        ARRAY['GMAIL_SPOT']::text[]
     ) RETURNING canonical_transaction_version_id::text AS id`,
    [
      logicalTransactionId,
      row.version_no + 1,
      row.canonical_transaction_version_id,
      row.financial_account_id,
      row.transaction_date,
      row.transaction_timestamp,
      amount,
      direction,
      row.currency_code,
      title,
      sourceRef,
      row.extraction_sequence ?? 1,
    ],
  );
  const newId = inserted.rows[0]?.id;
  if (!newId) return false;
  await db.query("SELECT core.activate_canonical_transaction_version($1::uuid, $2::uuid)", [
    newId,
    row.canonical_transaction_version_id,
  ]);
  return true;
}

type FkRef = { schema: string; table: string; column: string };

const logicalOwned: FkRef[] = [
  { schema: "core", table: "gmail_spot_transaction", column: "logical_transaction_id" },
  { schema: "core", table: "canonical_transaction_version", column: "logical_transaction_id" },
  { schema: "core", table: "category_choice", column: "logical_transaction_id" },
];

const versionOwned: FkRef[] = [
  { schema: "core", table: "logical_transaction", column: "current_canonical_version_id" },
  { schema: "core", table: "canonical_transaction_version", column: "supersedes_version_id" },
];

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`unexpected sql identifier: ${name}`);
  }
  return `"${name}"`;
}

async function foreignKeys(db: pg.Client, regclass: string): Promise<FkRef[]> {
  const result = await db.query<{ schema_name: string; table_name: string; column_name: string }>(
    `SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name
       FROM pg_constraint fk
       JOIN pg_class c ON c.oid = fk.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN LATERAL unnest(fk.conkey) AS k(attnum) ON true
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      WHERE fk.contype = 'f'
        AND fk.confrelid = $1::regclass`,
    [regclass],
  );
  return result.rows.map((row) => ({ schema: row.schema_name, table: row.table_name, column: row.column_name }));
}

function isOwned(ref: FkRef, owned: FkRef[]): boolean {
  return owned.some((item) => item.schema === ref.schema && item.table === ref.table && item.column === ref.column);
}

async function referenceCount(db: pg.Client, ref: FkRef, id: string): Promise<number> {
  const sql = `SELECT count(*)::int AS n FROM ${quoteIdent(ref.schema)}.${quoteIdent(ref.table)} WHERE ${quoteIdent(ref.column)} = $1::uuid`;
  const result = await db.query<{ n: number }>(sql, [id]);
  return result.rows[0]?.n ?? 0;
}

async function ledgerIsShared(
  db: pg.Client,
  logicalId: string,
  spotId: string,
  logicalFks: FkRef[],
  versionFks: FkRef[],
): Promise<boolean> {
  const owned = await db.query<{ gmail_spot_id: string | null }>(
    `SELECT identity_metadata->>'gmail_spot_id' AS gmail_spot_id
       FROM core.logical_transaction
      WHERE logical_transaction_id = $1::uuid`,
    [logicalId],
  );
  if (owned.rows[0]?.gmail_spot_id !== spotId) {
    return true;
  }
  for (const ref of logicalFks) {
    if (isOwned(ref, logicalOwned)) continue;
    if (await referenceCount(db, ref, logicalId) > 0) return true;
  }
  const versions = await db.query<{ id: string }>(
    `SELECT canonical_transaction_version_id::text AS id
       FROM core.canonical_transaction_version
      WHERE logical_transaction_id = $1::uuid
      ORDER BY version_no DESC`,
    [logicalId],
  );
  for (const version of versions.rows) {
    for (const ref of versionFks) {
      if (isOwned(ref, versionOwned)) continue;
      if (await referenceCount(db, ref, version.id) > 0) return true;
    }
  }
  return false;
}

/** Drop a guard-rejected spot and its gmail-only logical transaction. */
async function dropRejectedSpot(
  db: pg.Client,
  spot: SpotRow,
  dryRun: boolean,
  logicalFks: FkRef[],
  versionFks: FkRef[],
): Promise<"ledger" | "spot" | "shared"> {
  if (spot.logical_transaction_id) {
    const shared = await ledgerIsShared(
      db,
      spot.logical_transaction_id,
      spot.gmail_spot_transaction_id,
      logicalFks,
      versionFks,
    );
    if (shared) return "shared";
    if (dryRun) return "ledger";
    const versions = await db.query<{ id: string }>(
      `SELECT canonical_transaction_version_id::text AS id
         FROM core.canonical_transaction_version
        WHERE logical_transaction_id = $1::uuid
        ORDER BY version_no DESC`,
      [spot.logical_transaction_id],
    );
    await db.query("BEGIN");
    try {
      await db.query(
        `UPDATE core.gmail_spot_transaction
            SET logical_transaction_id = NULL
          WHERE gmail_spot_transaction_id = $1::uuid`,
        [spot.gmail_spot_transaction_id],
      );
      await db.query(
        `DELETE FROM core.category_choice WHERE logical_transaction_id = $1::uuid`,
        [spot.logical_transaction_id],
      );
      await db.query(
        `UPDATE core.logical_transaction
            SET current_canonical_version_id = NULL
          WHERE logical_transaction_id = $1::uuid`,
        [spot.logical_transaction_id],
      );
      await db.query(
        `UPDATE core.canonical_transaction_version
            SET is_current = false
          WHERE logical_transaction_id = $1::uuid
            AND is_current`,
        [spot.logical_transaction_id],
      );
      for (const version of versions.rows) {
        await db.query(
          `DELETE FROM core.canonical_transaction_version
            WHERE canonical_transaction_version_id = $1::uuid`,
          [version.id],
        );
      }
      await db.query(
        `DELETE FROM core.logical_transaction WHERE logical_transaction_id = $1::uuid`,
        [spot.logical_transaction_id],
      );
      await db.query(
        `DELETE FROM core.gmail_spot_transaction WHERE gmail_spot_transaction_id = $1::uuid`,
        [spot.gmail_spot_transaction_id],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
    return "ledger";
  }
  if (!dryRun) {
    await db.query(
      `DELETE FROM core.gmail_spot_transaction WHERE gmail_spot_transaction_id = $1::uuid`,
      [spot.gmail_spot_transaction_id],
    );
  }
  return "spot";
}

async function main(): Promise<void> {
  writeFileSync(LOG, "");
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

  const conn = await client.query<{
    gmail_connection_id: string;
    owner_id: string;
    credential_ciphertext: string;
  }>(
    `SELECT gmail_connection_id, owner_id, credential_ciphertext
       FROM core.gmail_connection
      WHERE lower(mailbox_address) = $1
      LIMIT 1`,
    [mailbox],
  );
  const connection = conn.rows[0];
  if (!connection?.credential_ciphertext) {
    throw new Error(`mailbox not found or missing credential: ${mailbox}`);
  }

  const refreshToken = unsealCredential(connection.credential_ciphertext, env.GMAIL_TOKEN_ENCRYPTION_KEY);
  let accessToken = await refreshAccessToken(env, refreshToken);
  let tokenLock = Promise.resolve();
  const withToken = async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    try {
      return await fn(accessToken);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "auth") {
        tokenLock = tokenLock.then(async () => {
          accessToken = await refreshAccessToken(env, refreshToken);
        });
        await tokenLock;
        return fn(accessToken);
      }
      throw error;
    }
  };

  const spots = await client.query<SpotRow>(
    `SELECT gmail_spot_transaction_id::text, gmail_message_id, logical_transaction_id::text,
            counterparty, channel
       FROM core.gmail_spot_transaction
      WHERE gmail_connection_id = $1::uuid
      ORDER BY created_at ASC`,
    [connection.gmail_connection_id],
  );

  const dryRun = process.env.REPARSE_DRY_RUN === "1";
  const logicalFks = await foreignKeys(client, "core.logical_transaction");
  const versionFks = await foreignKeys(client, "core.canonical_transaction_version");
  const counts = {
    updated: 0,
    cleanedOnly: 0,
    unparsed: 0,
    missing: 0,
    failed: 0,
    done: 0,
    rejected: 0,
    ledgerRemoved: 0,
    skippedShared: 0,
  };
  log({ event: "reparse_start", mailbox, spots: spots.rows.length, concurrency: CONCURRENCY, dryRun });

  const queue = [...spots.rows];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    const local = new pg.Client({
      host: env.POSTGRES_HOST,
      port: Number(env.POSTGRES_PORT || 5432),
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      database: env.POSTGRES_DB,
      ssl: { rejectUnauthorized: false },
    });
    await local.connect();
    try {
      while (queue.length > 0) {
        const spot = queue.shift();
        if (!spot) break;
        try {
          const rawB64 = await withToken((token) => fetchRaw(token, spot.gmail_message_id));
          if (rawB64 === "missing") {
            counts.missing += 1;
            const title = displayTransactionTitle(`${spot.channel} / ${spot.counterparty}`);
            if (!dryRun && spot.logical_transaction_id && await writeLedgerTitle(local, spot.logical_transaction_id, title)) {
              counts.cleanedOnly += 1;
            }
          } else {
            const raw = Buffer.from(rawB64, "base64url").toString("latin1");
            const extracted = extractMimeMessage({
              ownerId: connection.owner_id,
              gmailConnectionId: connection.gmail_connection_id,
              gmailMessageId: spot.gmail_message_id,
              raw,
            });
            const body = alertBody(extracted.texts);
            const subject = messageSubject(raw);
            const alert = parseTransactionFromEmail(body, { postedAt: messageDate(raw), subject });
            if (!alert) {
              const outcome = await dropRejectedSpot(local, spot, dryRun, logicalFks, versionFks);
              log({
                event: "reparse_rejected",
                messageId: spot.gmail_message_id,
                spotId: spot.gmail_spot_transaction_id,
                counterparty: spot.counterparty,
                subject,
                outcome,
                dryRun,
              });
              counts.rejected += 1;
              if (outcome === "ledger") counts.ledgerRemoved += 1;
              if (outcome === "shared") counts.skippedShared += 1;
            } else if (dryRun) {
              counts.updated += 1;
            } else {
              const title = displayTransactionTitle(alert.counterparty) || alert.counterparty;
              await local.query(
                `UPDATE core.gmail_spot_transaction
                    SET flow = $2,
                        amount = $3::numeric,
                        account_last4 = $4,
                        payment_ref = $5,
                        channel = $6,
                        counterparty = left($7, 120),
                        posted_at = COALESCE($8::timestamptz, posted_at),
                        raw_excerpt = left($9, 500)
                  WHERE gmail_spot_transaction_id = $1::uuid`,
                [
                  spot.gmail_spot_transaction_id,
                  alert.flow,
                  alert.amount,
                  alert.accountLast4 ?? null,
                  alert.paymentRef ?? null,
                  alert.channel,
                  alert.counterparty,
                  alert.postedAt ?? null,
                  alert.rawExcerpt,
                ],
              );
              if (spot.logical_transaction_id) {
                await writeLedgerTitle(local, spot.logical_transaction_id, title, {
                  amount: alert.amount,
                  direction: alert.flow === "DEBIT" ? "OUT" : "IN",
                  paymentRef: alert.paymentRef ?? null,
                });
              }
              counts.updated += 1;
            }
          }
        } catch (error) {
          counts.failed += 1;
          log({
            event: "reparse_row_failed",
            messageId: spot.gmail_message_id,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          counts.done += 1;
          if (counts.done % 50 === 0 || counts.done === spots.rows.length) {
            log({ event: "reparse_progress", ...counts, total: spots.rows.length });
          }
        }
      }
    } finally {
      await local.end();
    }
  });

  await Promise.all(workers);

  const sample = await client.query(
    `SELECT s.counterparty, s.channel, left(cv.raw_description, 100) AS raw_description
       FROM core.gmail_spot_transaction s
       LEFT JOIN core.canonical_transaction_version cv
         ON cv.logical_transaction_id = s.logical_transaction_id AND cv.is_current
      WHERE s.gmail_connection_id = $1::uuid
      ORDER BY s.created_at DESC
      LIMIT 12`,
    [connection.gmail_connection_id],
  );
  log({ event: "reparse_done", mailbox, total: spots.rows.length, ...counts, sample: sample.rows });
  await client.end();
}

main().catch((error) => {
  log({ event: "reparse_fatal", error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
