/**
 * Owner-scoped Decision OS category backfill from the India brand map.
 *
 *   MAILBOX=santoshmalla221989@gmail.com DRY_RUN=1 npx tsx scripts/backfill-ledger-categories.ts
 *   MAILBOX=santoshmalla221989@gmail.com npx tsx scripts/backfill-ledger-categories.ts
 *
 * Matchers mirror backend-monytix/intelligence/app/normalize/merchant.py (_BRANDS).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

type Hit = { merchant: string; category_id: string; subcategory_id: string | null };

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

function classifyBatch(texts: string[]): (Hit | null)[] {
  const intelligenceRoot = resolve(process.cwd(), "../../backend-monytix/intelligence");
  const py = resolve(intelligenceRoot, ".venv/bin/python");
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(intelligenceRoot)})
from app.normalize.merchant import classify_text, known_brand
payload = json.load(sys.stdin)
out = []
for text in payload:
    branded = known_brand(text or "")
    if branded:
        merchant, category, subcategory = branded
        out.append({"merchant": merchant, "category_id": category, "subcategory_id": subcategory})
        continue
    hit = classify_text(text or "")
    if not hit:
        out.append(None)
        continue
    merchant, category, subcategory = hit
    out.append({"merchant": merchant, "category_id": category, "subcategory_id": subcategory})
print(json.dumps(out))
`;
  const result = spawnSync(py, ["-c", code], {
    input: JSON.stringify(texts),
    encoding: "utf8",
    cwd: intelligenceRoot,
    env: { ...process.env, PYTHONPATH: intelligenceRoot },
  });
  if (result.status !== 0) {
    throw new Error(`classify failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim()) as (Hit | null)[];
}

function histogram(rows: { category_id: string; subcategory_id: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = `${row.category_id}/${row.subcategory_id ?? "-"}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const mailbox = (process.env.MAILBOX ?? "santoshmalla221989@gmail.com").trim().toLowerCase();
  const dryRun = process.env.DRY_RUN === "1";
  const client = new pg.Client({
    host: env.POSTGRES_HOST,
    port: Number(env.POSTGRES_PORT || 5432),
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const owner = await client.query<{ owner_id: string }>(
    `SELECT owner_id::text
       FROM core.gmail_connection
      WHERE lower(mailbox_address) = $1
      LIMIT 1`,
    [mailbox],
  );
  const ownerId = owner.rows[0]?.owner_id;
  if (!ownerId) {
    throw new Error(`no gmail connection for mailbox ${mailbox}`);
  }

  // Apply subcategory seed if migration not yet run via docker migrator.
  await client.query(`
    INSERT INTO ref.taxonomy_subcategory (taxonomy_version, category_code, subcategory_code, display_name) VALUES
      ('F10E-v1.2', 'FINANCIAL_SERVICES', 'LOAN_EMI', 'Loan EMI and NBFC debits'),
      ('F10E-v1.2', 'FINANCIAL_SERVICES', 'CREDIT_CARD_BILL', 'Credit card bill payment')
    ON CONFLICT (taxonomy_version, subcategory_code) DO NOTHING
  `);

  const overrides = await client.query<{ match_token: string }>(
    `SELECT upper(match_token) AS match_token
       FROM finance.user_category_overrides
      WHERE owner_id = $1::uuid`,
    [ownerId],
  );
  const overrideTokens = new Set(overrides.rows.map((row) => row.match_token));

  const rows = await client.query<{
    id: string;
    clean_merchant: string;
    raw_narration: string;
    category_id: string;
    subcategory_id: string | null;
  }>(
    `SELECT id::text, clean_merchant, raw_narration, category_id, subcategory_id
       FROM finance.ledger_transactions
      WHERE owner_id = $1::uuid
      ORDER BY posted_at, line_no`,
    [ownerId],
  );

  console.log(JSON.stringify({
    event: "backfill_start",
    mailbox,
    ownerId,
    dryRun,
    rows: rows.rows.length,
    before: histogram(rows.rows),
  }));

  const probes = rows.rows.map((row) => `${row.clean_merchant}\n${row.raw_narration}`);
  const hits = classifyBatch(probes);

  const updates: { id: string; hit: Hit; from: string; to: string }[] = [];
  for (let i = 0; i < rows.rows.length; i += 1) {
    const row = rows.rows[i]!;
    const hit = hits[i];
    if (!hit) continue;
    if (overrideTokens.has(row.clean_merchant.trim().toUpperCase())) continue;
    const same =
      row.category_id === hit.category_id
      && (row.subcategory_id ?? null) === (hit.subcategory_id ?? null);
    if (same) continue;
    updates.push({
      id: row.id,
      hit,
      from: `${row.category_id}/${row.subcategory_id ?? "-"}`,
      to: `${hit.category_id}/${hit.subcategory_id ?? "-"}`,
    });
  }

  console.log(JSON.stringify({
    event: "backfill_plan",
    wouldUpdate: updates.length,
    sample: updates.slice(0, 20).map((item) => ({
      id: item.id,
      from: item.from,
      to: item.to,
      merchant: item.hit.merchant,
    })),
  }));

  if (dryRun) {
    await client.end();
    return;
  }

  const changedIds: string[] = [];
  for (const item of updates) {
    await client.query(
      `UPDATE finance.ledger_transactions
          SET category_id = $2,
              subcategory_id = $3
        WHERE id = $1::uuid
          AND owner_id = $4::uuid`,
      [item.id, item.hit.category_id, item.hit.subcategory_id, ownerId],
    );
    changedIds.push(item.id);
  }

  if (changedIds.length > 0) {
    await client.query(
      `DELETE FROM human_context.weight_associations
        WHERE owner_id = $1::uuid
          AND target_type = 'TRANSACTION'
          AND target_id = ANY($2::uuid[])`,
      [ownerId, changedIds],
    );
    await client.query(
      `DELETE FROM human_context.weight_inference_runs
        WHERE owner_id = $1::uuid
          AND transaction_id = ANY($2::uuid[])`,
      [ownerId, changedIds],
    );
    await client.query(
      `DELETE FROM human_context.weight_eligibility_results
        WHERE owner_id = $1::uuid
          AND transaction_id = ANY($2::uuid[])`,
      [ownerId, changedIds],
    );
  }

  const after = await client.query<{ category_id: string; subcategory_id: string | null }>(
    `SELECT category_id, subcategory_id
       FROM finance.ledger_transactions
      WHERE owner_id = $1::uuid`,
    [ownerId],
  );

  console.log(JSON.stringify({
    event: "backfill_done",
    updated: changedIds.length,
    clearedHumanContext: changedIds.length,
    after: histogram(after.rows),
  }));
  await client.end();
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "backfill_fatal",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exit(1);
});
