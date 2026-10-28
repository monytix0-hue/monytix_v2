import fs from "node:fs";
import path from "node:path";
import pg from "pg";

// One-off export: every transaction the review screen counts as "not categorised".
// Mirrors the filter used by LedgerRead.insights() for `uncategorised`, and reuses the
// same list projection so the output matches what the app shows on the Transaction screen.

function loadEnv(): Record<string, string> {
  const file = path.resolve(import.meta.dirname, "../../../.env");
  const env: Record<string, string> = {};
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Za-z0-9_]+)=(.*)$/.exec(raw.trim());
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = { ...loadEnv(), ...process.env };
const databaseUrl = env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

async function withOwner<T>(ownerId: string, read: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.owner_id', $1, true)", [ownerId]);
    await client.query("SELECT set_config('jit', 'off', true)");
    const value = await read(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// The app role is row-level secured: it sees nothing until `app.owner_id` is set, exactly as
// the API server does per request. Resolve which owner to export with the admin role, then
// run the export itself under the same owner context the app would use.
const adminUrl =
  env.ADMIN_DATABASE_URL ??
  (env.POSTGRES_HOST
    ? `postgresql://${env.POSTGRES_USER}:${encodeURIComponent(env.POSTGRES_PASSWORD ?? "")}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT ?? "5432"}/${env.POSTGRES_DB ?? "postgres"}?sslmode=require&uselibpqcompat=true`
    : null);

async function resolveOwner(): Promise<string> {
  const explicit = process.argv[2];
  if (explicit && /^[0-9a-f-]{36}$/i.test(explicit)) return explicit;
  if (!adminUrl) throw new Error("no admin connection available to resolve the owner");

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const rows = await admin.query<{ owner_id: string; display_name: string | null; n: number }>(
      `SELECT ao.owner_id, o.display_name, count(DISTINCT lt.logical_transaction_id)::int AS n
         FROM core.account_ownership ao
         JOIN core.owner o ON o.owner_id = ao.owner_id
         JOIN core.logical_transaction lt ON lt.financial_account_id = ao.financial_account_id
        GROUP BY ao.owner_id, o.display_name
        ORDER BY n DESC`,
    );
    console.error(JSON.stringify(rows.rows, null, 2));
    const first = rows.rows[0];
    if (!first) throw new Error("no owned accounts with transactions found");
    return first.owner_id;
  } finally {
    await admin.end();
  }
}

const ownerId = await resolveOwner();
console.error(`exporting owner ${ownerId}`);

const sql = `
WITH uncategorised AS (
  SELECT cv.logical_transaction_id
    FROM core.canonical_transaction_version cv
    JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
    LEFT JOIN LATERAL (
      SELECT choice.category_code
        FROM core.category_choice choice
       WHERE choice.logical_transaction_id = cv.logical_transaction_id
       ORDER BY choice.is_explicit DESC
       LIMIT 1
    ) choice ON true
    LEFT JOIN LATERAL (
      SELECT cr.category_code
        FROM intel.financial_event_resolution er
        JOIN intel.category_resolution cr
          ON cr.financial_event_resolution_id = er.financial_event_resolution_id
         AND cr.is_current
       WHERE er.logical_transaction_id = cv.logical_transaction_id
         AND er.canonical_transaction_version_id = cv.canonical_transaction_version_id
         AND er.is_current
       LIMIT 1
    ) resolved ON true
   WHERE cv.is_current
     AND lt.identity_status = 'ACTIVE'
     AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
     AND COALESCE(choice.category_code, resolved.category_code) IS NULL
)
SELECT cv.logical_transaction_id,
       cv.canonical_transaction_version_id,
       cv.financial_account_id,
       fa.account_display_name,
       cv.transaction_date,
       cv.amount::text AS amount,
       cv.currency_code,
       cv.direction,
       cv.raw_description,
       cv.source_reference,
       cv.duplicate_outcome,
       e.event_family,
       e.resolution_outcome,
       mw.primary_weight_code,
       wm.name AS weight_name
  FROM uncategorised u
  JOIN core.canonical_transaction_version cv
    ON cv.logical_transaction_id = u.logical_transaction_id
   AND cv.is_current
  LEFT JOIN core.financial_account fa ON fa.financial_account_id = cv.financial_account_id
  LEFT JOIN intel.financial_event_resolution e
    ON e.logical_transaction_id = cv.logical_transaction_id
   AND e.canonical_transaction_version_id = cv.canonical_transaction_version_id
   AND e.is_current
  LEFT JOIN core.movement_weight mw ON mw.logical_transaction_id = cv.logical_transaction_id
  LEFT JOIN human_context.weight_master wm ON wm.code = mw.primary_weight_code
 ORDER BY cv.transaction_date DESC, cv.logical_transaction_id DESC
`;

try {
  const items = await withOwner(ownerId, async (client) => {
    const result = await client.query(sql);
    return result.rows.map((row) => ({
      logicalTransactionId: row.logical_transaction_id,
      canonicalTransactionVersionId: row.canonical_transaction_version_id,
      transactionDate: row.transaction_date
        ? row.transaction_date instanceof Date
          ? row.transaction_date.toISOString().slice(0, 10)
          : String(row.transaction_date).slice(0, 10)
        : null,
      amount: row.amount,
      currency: row.currency_code?.trim() ?? null,
      direction: row.direction,
      description: row.raw_description,
      accountId: row.financial_account_id,
      accountName: row.account_display_name,
      reference: row.source_reference,
      eventFamily: row.event_family,
      resolutionOutcome: row.resolution_outcome,
      weightCode: row.primary_weight_code,
      weightName: row.weight_name,
      duplicateOutcome: row.duplicate_outcome,
      needsCategory: true,
    }));
  });

  const out = path.resolve(import.meta.dirname, "../uncategorised-transactions.json");
  fs.writeFileSync(out, JSON.stringify({ ownerId, count: items.length, items }, null, 2));
  console.log(JSON.stringify({ ownerId, count: items.length, out }, null, 2));
} finally {
  await pool.end();
}
