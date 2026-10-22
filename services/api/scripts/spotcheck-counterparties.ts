import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { displayTransactionTitle } from "../src/live/displayTitle.js";

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
  const client = new pg.Client({
    host: env.POSTGRES_HOST,
    port: Number(env.POSTGRES_PORT || 5432),
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const id = "01a15ed2-ea63-7499-984c-901f3e0e4594";

  const counts = await client.query(
    `SELECT count(*)::int AS spots,
            count(*) FILTER (WHERE logical_transaction_id IS NOT NULL)::int AS promoted
       FROM core.gmail_spot_transaction WHERE gmail_connection_id = $1::uuid`,
    [id],
  );
  const bad = await client.query(
    `SELECT count(*)::int AS n FROM core.gmail_spot_transaction
      WHERE gmail_connection_id = $1::uuid AND (
        counterparty ILIKE '%support you%'
        OR counterparty ILIKE '%account ending in%'
        OR counterparty ILIKE '%Insta Alerts%'
        OR counterparty ILIKE '%available balance%'
        OR counterparty ILIKE '%unsubscribe%'
        OR counterparty ILIKE '%E-mandates%'
      )`,
    [id],
  );
  const top = await client.query(
    `SELECT counterparty, count(*)::int AS n
       FROM core.gmail_spot_transaction WHERE gmail_connection_id = $1::uuid
      GROUP BY 1 ORDER BY n DESC LIMIT 30`,
    [id],
  );
  const sample = await client.query(
    `SELECT s.counterparty, s.channel, left(cv.raw_description, 100) AS title
       FROM core.gmail_spot_transaction s
       LEFT JOIN core.canonical_transaction_version cv
         ON cv.logical_transaction_id = s.logical_transaction_id AND cv.is_current
      WHERE s.gmail_connection_id = $1::uuid
      ORDER BY s.created_at DESC LIMIT 20`,
    [id],
  );
  const brands = await client.query(
    `SELECT counterparty, count(*)::int AS n FROM core.gmail_spot_transaction
      WHERE gmail_connection_id = $1::uuid AND (
        counterparty ~* '(swiggy|zomato|uber|amazon|apple|netflix|spotify|APPLESERVICES)'
      ) GROUP BY 1 ORDER BY n DESC LIMIT 20`,
    [id],
  );
  const fallbacks = await client.query(
    `SELECT counterparty, count(*)::int AS n FROM core.gmail_spot_transaction
      WHERE gmail_connection_id = $1::uuid
        AND counterparty IN ('General Spend', 'Bank Transfer', 'Unknown', 'UPI merchant')
      GROUP BY 1`,
    [id],
  );
  const rawVpa = await client.query(
    `SELECT count(*)::int AS n FROM core.gmail_spot_transaction
      WHERE gmail_connection_id = $1::uuid AND counterparty ~ '@'`,
    [id],
  );

  console.log(JSON.stringify({
    counts: counts.rows[0],
    bad_boilerplate: bad.rows[0],
    raw_vpa_titles: rawVpa.rows[0],
    fallbacks: fallbacks.rows,
    brands: brands.rows,
    top: top.rows.map((r) => ({
      n: r.n,
      counterparty: r.counterparty,
      live: displayTransactionTitle(r.counterparty),
    })),
    sample: sample.rows,
  }, null, 2));
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
