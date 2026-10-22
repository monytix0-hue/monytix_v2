/**
 * Re-evaluate F2/F3 for ledger rows missing human_context eligibility
 * (e.g. after category backfill cleared prior results).
 *
 *   MAILBOX=santoshmalla221989@gmail.com npx tsx scripts/reeval-human-context.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

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

type Fact = {
  transaction_id: string;
  owner_id: string;
  amount: number;
  flow: string;
  channel: string;
  clean_merchant: string;
  category_id: string;
  subcategory_id: string | null;
  fee_role: string;
};

type Scored = {
  transaction_id: string;
  owner_id: string;
  eligibility: { state: string; reason_code: string; evidence: Record<string, unknown> };
  inference_run: {
    primary_inferred_weight: string;
    secondary_inferred_weight: string | null;
    confidence_score: number;
    rule_id: string;
    model_version: string;
  } | null;
  weight_associations: { weight_code: string; is_primary: boolean; intensity: number }[];
};

function scoreBatch(facts: Fact[]): Scored[] {
  const intelligenceRoot = resolve(process.cwd(), "../../backend-monytix/intelligence");
  const py = resolve(intelligenceRoot, ".venv/bin/python");
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(intelligenceRoot)})
from app.human_context import TransactionEvaluationInput, run_human_context_pipeline
payload = json.load(sys.stdin)
out = []
for fact in payload:
    result = run_human_context_pipeline(TransactionEvaluationInput(**fact))
    out.append(result)
print(json.dumps(out))
`;
  const result = spawnSync(py, ["-c", code], {
    input: JSON.stringify(facts),
    encoding: "utf8",
    cwd: intelligenceRoot,
    env: { ...process.env, PYTHONPATH: intelligenceRoot },
  });
  if (result.status !== 0) {
    throw new Error(`score failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim()) as Scored[];
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

  const owner = await client.query<{ owner_id: string }>(
    `SELECT owner_id::text FROM core.gmail_connection WHERE lower(mailbox_address) = $1 LIMIT 1`,
    [mailbox],
  );
  const ownerId = owner.rows[0]?.owner_id;
  if (!ownerId) throw new Error(`no owner for ${mailbox}`);

  const pending = await client.query<{
    transaction_id: string;
    amount: string;
    flow: string;
    channel: string;
    clean_merchant: string;
    category_id: string;
    subcategory_id: string | null;
    fee_role: string;
  }>(
    `SELECT lt.id::text AS transaction_id, lt.amount::text, lt.flow, lt.channel,
            lt.clean_merchant, lt.category_id, lt.subcategory_id, lt.fee_role
       FROM finance.ledger_transactions lt
      WHERE lt.owner_id = $1::uuid
        AND NOT EXISTS (
          SELECT 1 FROM human_context.weight_eligibility_results el WHERE el.transaction_id = lt.id
        )
      ORDER BY lt.posted_at, lt.line_no`,
    [ownerId],
  );

  const facts: Fact[] = pending.rows.map((row) => ({
    transaction_id: row.transaction_id,
    owner_id: ownerId,
    amount: Number(row.amount),
    flow: row.flow,
    channel: row.channel,
    clean_merchant: row.clean_merchant,
    category_id: row.category_id,
    subcategory_id: row.subcategory_id,
    fee_role: row.fee_role || "BASE",
  }));

  console.log(JSON.stringify({ event: "reeval_start", ownerId, pending: facts.length }));
  if (facts.length === 0) {
    await client.end();
    return;
  }

  const scored = scoreBatch(facts);
  let applied = 0;
  const weightCounts: Record<string, number> = {};

  for (const result of scored) {
    await client.query(
      `INSERT INTO human_context.weight_eligibility_results (transaction_id, owner_id, state, reason_code, evidence_summary)
       VALUES ($1::uuid, $2::uuid, $3::human_context.eligibility_state, $4, $5::jsonb)
       ON CONFLICT (transaction_id) DO UPDATE
       SET state = EXCLUDED.state, reason_code = EXCLUDED.reason_code, evidence_summary = EXCLUDED.evidence_summary, evaluated_at = NOW()`,
      [
        result.transaction_id,
        result.owner_id,
        result.eligibility.state,
        result.eligibility.reason_code,
        JSON.stringify(result.eligibility.evidence ?? {}),
      ],
    );
    if (result.inference_run && result.weight_associations.length > 0) {
      await client.query(
        `DELETE FROM human_context.weight_inference_runs WHERE transaction_id = $1::uuid`,
        [result.transaction_id],
      );
      await client.query(
        `INSERT INTO human_context.weight_inference_runs (
           transaction_id, owner_id, primary_inferred_weight, secondary_inferred_weight, confidence_score, rule_id, model_version
         ) VALUES (
           $1::uuid, $2::uuid, $3::human_context.weight_code, $4::human_context.weight_code, $5, $6, $7
         )`,
        [
          result.transaction_id,
          result.owner_id,
          result.inference_run.primary_inferred_weight,
          result.inference_run.secondary_inferred_weight,
          result.inference_run.confidence_score,
          result.inference_run.rule_id,
          result.inference_run.model_version,
        ],
      );
      await client.query(
        `UPDATE human_context.weight_associations
            SET is_effective = false, superseded_at = NOW()
          WHERE target_type = 'TRANSACTION' AND target_id = $1::uuid AND is_effective`,
        [result.transaction_id],
      );
      for (const weight of result.weight_associations) {
        await client.query(
          `INSERT INTO human_context.weight_associations (
             owner_id, target_type, target_id, weight_code, is_primary, intensity, effective_source
           ) VALUES (
             $1::uuid, 'TRANSACTION', $2::uuid, $3::human_context.weight_code, $4, $5, 'SYSTEM_INFERENCE'
           )`,
          [result.owner_id, result.transaction_id, weight.weight_code, weight.is_primary, weight.intensity],
        );
        weightCounts[weight.weight_code] = (weightCounts[weight.weight_code] ?? 0) + (weight.is_primary ? 1 : 0);
      }
    }
    applied += 1;
  }

  const pendingOutcomes = await client.query<{
    mission_code: string;
    category_id: string;
    n: number;
  }>(
    `SELECT md.canonical_mission_code AS mission_code, lt.category_id, count(*)::int AS n
       FROM finance.ledger_transactions lt
       JOIN action.mission m ON m.owner_id = lt.owner_id AND m.state = 'ACTIVE'
       JOIN ref.mission_definition md ON md.mission_definition_version_id = m.canonical_mission_definition_version_id
       LEFT JOIN action.financial_outcome fo
         ON fo.source_reference_id = lt.id AND fo.mission_id = m.mission_id
      WHERE lt.owner_id = $1::uuid
        AND fo.financial_outcome_id IS NULL
        AND (
          (md.canonical_mission_code IN ('M01', 'M02', 'M06')
            AND (lt.category_id = 'FINANCIAL_SERVICES' OR lt.flow = 'IN'))
          OR
          (md.canonical_mission_code = 'M30'
            AND lt.flow = 'OUT'
            AND lt.category_id IN ('FOOD_DINING', 'SHOPPING_RETAIL'))
        )
      GROUP BY 1, 2
      ORDER BY 1, 3 DESC`,
    [ownerId],
  );

  console.log(JSON.stringify({
    event: "reeval_done",
    applied,
    primaryWeightHistogram: weightCounts,
    pendingOutcomeMatches: pendingOutcomes.rows,
  }));
  await client.end();
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "reeval_fatal",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exit(1);
});
