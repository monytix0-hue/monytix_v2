/**
 * Activate M30, insert a ₹10,000 FOOD_DINING Swiggy outflow, mint A3 M.I.L.E. (30.0).
 *
 *   MAILBOX=santoshmalla221989@gmail.com npx tsx scripts/smoke-m30-mile.ts
 *
 * Expects FINANCE_BACKEND_URL (:8090) + INTELLIGENCE_URL (:8091) with INTERNAL_TOKEN.
 * Set SMOKE_BEARER to also hit PublicAPI :8080 /v1/ui/missions and /v1/ui/rewards.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const AMOUNT = 10000;
const EXPECTED_MILE = 30;

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

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

function fail(message: string, data: Record<string, unknown> = {}): never {
  log("smoke_fatal", { error: message, ...data });
  process.exit(1);
}

async function internalPost(
  baseUrl: string,
  path: string,
  token: string,
  body: unknown,
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${path} http_${response.status}: ${text.slice(0, 400)}`);
  }
  return payload;
}

async function probe(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function evaluateLocally(match: Record<string, unknown>): Record<string, unknown> {
  const intelligenceRoot = resolve(process.cwd(), "../../backend-monytix/intelligence");
  const py = resolve(intelligenceRoot, ".venv/bin/python");
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(intelligenceRoot)})
from app.outcomes_mile import OutcomeEvaluationInput, evaluate_outcome_mile
print(json.dumps(evaluate_outcome_mile(OutcomeEvaluationInput(**json.load(sys.stdin)))))
`;
  const result = spawnSync(py, ["-c", code], {
    input: JSON.stringify(match),
    encoding: "utf8",
    cwd: intelligenceRoot,
    env: { ...process.env, PYTHONPATH: intelligenceRoot },
  });
  if (result.status !== 0) {
    throw new Error(`local evaluate failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}

function assertPackage(pkg: Record<string, unknown>): void {
  const mile = pkg.mile_event as Record<string, unknown>;
  const outcome = pkg.outcome as Record<string, unknown>;
  const attribution = pkg.attribution as Record<string, unknown>;
  if (outcome.outcome_family_code !== "MS") fail("expected MS family", { outcome });
  if (outcome.verification_status !== "A3_ASSOCIATED") fail("expected A3_ASSOCIATED", { outcome });
  if (attribution.attribution_level !== "A3") fail("expected A3 attribution", { attribution });
  if (Number(mile.base_value) !== 10) fail("expected base_value 10", { mile });
  if (Number(mile.magnitude_factor) !== 5) fail("expected magnitude_factor 5", { mile });
  if (Number(mile.significance_factor) !== 1.2) fail("expected significance_factor 1.2", { mile });
  if (Number(mile.mile_awarded) !== EXPECTED_MILE) fail(`expected mile_awarded ${EXPECTED_MILE}`, { mile });
}

async function applyViaSql(
  client: pg.Client,
  ownerId: string,
  transactionId: string,
  pkg: Record<string, unknown>,
): Promise<void> {
  const outcome = pkg.outcome as Record<string, unknown>;
  const attribution = pkg.attribution as Record<string, unknown>;
  const impact = pkg.impact as Record<string, unknown>;
  const mile = pkg.mile_event as Record<string, unknown>;

  await client.query("SELECT set_config('app.owner_id', $1, true)", [ownerId]);

  const calibration = await client.query<{ id: string }>(
    `SELECT mile_calibration_policy_version_id::text AS id
       FROM ref.mile_calibration_policy
      WHERE policy_id = 'MILE_V1' AND status = 'ACTIVE'
      ORDER BY policy_version DESC LIMIT 1`,
  );
  const finalization = await client.query<{ id: string }>(
    `SELECT mile_finalization_policy_version_id::text AS id
       FROM ref.mile_finalization_policy
      WHERE policy_id = 'MILE_FINAL_V1' AND status = 'ACTIVE'
      ORDER BY policy_version DESC LIMIT 1`,
  );

  const inserted = await client.query<{ financial_outcome_id: string; inserted: boolean }>(
    `INSERT INTO action.financial_outcome (
       owner_id, outcome_family_code, outcome_type, decision_id, mission_id,
       source_reference_type, source_reference_id, economic_event_key, observed_amount, currency,
       verification_status, outcome_status, reason_codes, idempotency_key, observed_at, verified_at
     ) VALUES (
       $1::uuid, $2, $3, $4::uuid, $5::uuid, 'LEDGER_TRANSACTION', $6::uuid, $7, $8, $9, $10, 'FINALIZED',
       $11::text[], $12, COALESCE($13::timestamptz, clock_timestamp()), clock_timestamp()
     )
     ON CONFLICT (owner_id, idempotency_key) DO UPDATE
     SET outcome_status = EXCLUDED.outcome_status
     RETURNING financial_outcome_id::text, (xmax = 0) AS inserted`,
    [
      ownerId,
      outcome.outcome_family_code,
      outcome.outcome_type,
      outcome.decision_id ?? null,
      outcome.mission_id,
      transactionId,
      outcome.economic_event_key,
      outcome.observed_amount,
      outcome.currency,
      outcome.verification_status,
      outcome.reason_codes,
      outcome.idempotency_key,
      outcome.observed_at ?? null,
    ],
  );
  const outcomeId = inserted.rows[0]?.financial_outcome_id;
  const isNew = inserted.rows[0]?.inserted === true;
  if (!outcomeId) fail("financial_outcome insert returned no id");

  if (isNew) {
    await client.query(
      `INSERT INTO action.outcome_attribution (
         owner_id, financial_outcome_id, attribution_level, attribution_factor,
         decision_id, mission_id, source_reference_type, source_reference_id, reason_codes
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid, 'LEDGER_TRANSACTION', $7::uuid, $8::text[])`,
      [
        ownerId,
        outcomeId,
        attribution.attribution_level,
        attribution.attribution_factor,
        attribution.decision_id ?? null,
        attribution.mission_id,
        transactionId,
        attribution.reason_codes,
      ],
    );
  }

  await client.query(
    `INSERT INTO action.financial_impact_event (
       owner_id, financial_outcome_id, outcome_family_code, impact_type, impact_basis,
       amount, currency, attribution_level, attribution_factor, economic_impact_key, status
     ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, 'FINALIZED')
     ON CONFLICT (owner_id, economic_impact_key) DO NOTHING`,
    [
      ownerId,
      outcomeId,
      impact.outcome_family_code,
      impact.impact_type,
      impact.impact_basis,
      impact.amount,
      impact.currency,
      impact.attribution_level,
      impact.attribution_factor,
      impact.economic_impact_key,
    ],
  );

  await client.query(
    `INSERT INTO action.mile_event (
       owner_id, financial_outcome_id, decision_id, mission_id, event_type, outcome_family_code,
       mile_calibration_policy_version_id, mile_finalization_policy_version_id,
       attribution_level, base_value, magnitude_factor, significance_factor, confidence_factor,
       mile_awarded, status, economic_event_key, dedupe_key, occurred_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'OUTCOME', $5, $6::uuid, $7::uuid,
       $8, $9, $10, $11, $12, $13, 'FINALIZED', $14, $15,
       COALESCE($16::timestamptz, clock_timestamp())
     )
     ON CONFLICT (owner_id, dedupe_key) DO NOTHING`,
    [
      ownerId,
      outcomeId,
      mile.decision_id ?? null,
      mile.mission_id,
      mile.outcome_family_code,
      calibration.rows[0]?.id ?? null,
      finalization.rows[0]?.id ?? null,
      mile.attribution_level,
      mile.base_value,
      mile.magnitude_factor,
      mile.significance_factor,
      mile.confidence_factor,
      mile.mile_awarded,
      mile.economic_event_key,
      mile.dedupe_key,
      mile.occurred_at ?? null,
    ],
  );

  if (isNew && outcome.mission_id) {
    await client.query(
      `UPDATE action.mission
          SET current_progress_inr = current_progress_inr + $1, updated_at = clock_timestamp()
        WHERE mission_id = $2::uuid AND owner_id = $3::uuid`,
      [outcome.observed_amount, outcome.mission_id, ownerId],
    );
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const mailbox = (process.env.MAILBOX ?? "santoshmalla221989@gmail.com").trim().toLowerCase();
  const financeUrl = (process.env.FINANCE_BACKEND_URL || env.FINANCE_BACKEND_URL || "http://127.0.0.1:8090").replace(
    "finance-api",
    "127.0.0.1",
  );
  const intelligenceUrl = (process.env.INTELLIGENCE_URL || env.INTELLIGENCE_URL || "http://127.0.0.1:8091")
    .replace("finance-intelligence", "127.0.0.1")
    .replace(":8000", ":8091");
  // Prefer local 8091 for smoke even if .env points at compose DNS / alternate port.
  const intelBase = process.env.SMOKE_INTELLIGENCE_URL || (
    intelligenceUrl.includes("127.0.0.1") || intelligenceUrl.includes("localhost")
      ? intelligenceUrl.replace(/:\d+$/, ":8091")
      : "http://127.0.0.1:8091"
  );
  const financeBase = process.env.SMOKE_FINANCE_URL || (
    financeUrl.includes("127.0.0.1") || financeUrl.includes("localhost")
      ? financeUrl
      : "http://127.0.0.1:8090"
  );
  const token = process.env.INTERNAL_TOKEN || env.INTERNAL_TOKEN;
  if (!token) fail("INTERNAL_TOKEN missing");

  const client = new pg.Client({
    host: env.POSTGRES_HOST,
    port: Number(env.POSTGRES_PORT || 5432),
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const ownerRow = await client.query<{ owner_id: string }>(
    `SELECT owner_id::text FROM core.gmail_connection WHERE lower(mailbox_address) = $1 LIMIT 1`,
    [mailbox],
  );
  const ownerId = ownerRow.rows[0]?.owner_id;
  if (!ownerId) fail(`mailbox not found: ${mailbox}`);

  // Phase 1 — ACTIVE M30
  const mission = await client.query<{ mission_id: string; current_progress_inr: string }>(
    `INSERT INTO action.mission (
       owner_id, canonical_mission_definition_version_id, origin_type, state, title,
       target_definition, measurement_contract, completion_contract, idempotency_key
     )
     SELECT $1::uuid, mission_definition_version_id, 'USER_CREATED', 'ACTIVE', display_name,
            target_definition, measurement_contract, completion_contract,
            'msn_orbit:' || $1::text || ':M30'
       FROM ref.mission_definition
      WHERE canonical_mission_code = 'M30' AND definition_version = '1.0'
     ON CONFLICT (owner_id, idempotency_key) DO UPDATE
       SET state = 'ACTIVE', updated_at = clock_timestamp()
     RETURNING mission_id::text, current_progress_inr::text`,
    [ownerId],
  );
  const missionId = mission.rows[0]?.mission_id;
  const progressBefore = Number(mission.rows[0]?.current_progress_inr ?? 0);
  if (!missionId) fail("failed to upsert M30 mission");
  log("m30_active", { ownerId, missionId, progressBefore });

  // Phase 2 — qualifying ledger outflow
  let account = await client.query<{ id: string }>(
    `SELECT id::text FROM finance.financial_accounts WHERE owner_id = $1::uuid ORDER BY created_at ASC LIMIT 1`,
    [ownerId],
  );
  if (!account.rows[0]) {
    account = await client.query<{ id: string }>(
      `INSERT INTO finance.financial_accounts (owner_id, institution, masked_account, channel, currency_code)
       VALUES ($1::uuid, 'Smoke Bank', '9999', 'UPI', 'INR')
       RETURNING id::text`,
      [ownerId],
    );
  }
  const accountId = account.rows[0]!.id;
  const sourceMongoId = `smoke:m30:${randomUUID()}`;
  const txn = await client.query<{ id: string; posted_at: string }>(
    `INSERT INTO finance.ledger_transactions (
       owner_id, account_id, posted_at, amount, flow, channel, raw_narration, clean_merchant,
       category_id, subcategory_id, currency_code, source_mongo_id, line_no, fee_role
     ) VALUES (
       $1::uuid, $2::uuid, clock_timestamp(), $3, 'OUT', 'UPI',
       'UPI/DR/10000.00/SWIGGY/swiggy@hdfcbank', 'Swiggy',
       'FOOD_DINING', 'FOOD_DELIVERY', 'INR', $4, 1, 'BASE'
     )
     RETURNING id::text, posted_at::text`,
    [ownerId, accountId, AMOUNT, sourceMongoId],
  );
  const transactionId = txn.rows[0]!.id;
  const postedAt = txn.rows[0]!.posted_at;
  log("ledger_inserted", { transactionId, amount: AMOUNT, category_id: "FOOD_DINING", subcategory_id: "FOOD_DELIVERY" });

  const match = {
    owner_id: ownerId,
    transaction: {
      id: transactionId,
      amount: AMOUNT,
      flow: "OUT",
      clean_merchant: "Swiggy",
      category_id: "FOOD_DINING",
      subcategory_id: "FOOD_DELIVERY",
      posted_at: postedAt,
      currency_code: "INR",
    },
    active_mission: {
      mission_id: missionId,
      title: "Stop Financial Leakage",
      canonical_mission_code: "M30",
      target_definition: {},
    },
    linked_decision: {
      decision_id: null,
      state: null,
    },
  };

  // Phase 3 — reconcile
  const financeUp = await probe(financeBase);
  const intelUp = await probe(intelBase);
  let mode = "http";
  let pkg: Record<string, unknown>;

  if (financeUp && intelUp) {
    log("services_up", { financeBase, intelBase });
    const pending = await internalPost(financeBase, "/v1/internal/outcomes/pending", token, { owner_id: ownerId }) as {
      matches?: Array<Record<string, unknown>>;
    };
    const matches = pending.matches ?? [];
    const hit = matches.find((item) => {
      const txn = item.transaction as { id?: string } | undefined;
      return txn?.id === transactionId;
    }) ?? matches.find((item) => {
      const mission = item.active_mission as { canonical_mission_code?: string } | undefined;
      return mission?.canonical_mission_code === "M30";
    });
    if (!hit) fail("smoke transaction not in pending matches", { matchCount: matches.length });
    pkg = await internalPost(intelBase, "/internal/evaluate-outcome-mile", token, hit) as Record<string, unknown>;
    assertPackage(pkg);
    log("evaluate_ok", {
      mile_awarded: (pkg.mile_event as Record<string, unknown>).mile_awarded,
      base_value: (pkg.mile_event as Record<string, unknown>).base_value,
    });
    await internalPost(financeBase, "/v1/internal/apply-outcomes-mile", token, {
      owner_id: ownerId,
      transaction_id: transactionId,
      package: pkg,
    });
  } else {
    mode = "local_evaluate_sql_apply";
    log("services_down_fallback", { financeUp, intelUp, financeBase, intelBase });
    pkg = evaluateLocally(match);
    assertPackage(pkg);
    log("evaluate_ok", {
      mile_awarded: (pkg.mile_event as Record<string, unknown>).mile_awarded,
      mode,
    });
    await applyViaSql(client, ownerId, transactionId, pkg);
  }

  // Phase 4 — verify
  const outcome = await client.query<{
    verification_status: string;
    observed_amount: string;
    mission_id: string;
  }>(
    `SELECT verification_status, observed_amount::text, mission_id::text
       FROM action.financial_outcome
      WHERE owner_id = $1::uuid AND source_reference_id = $2::uuid
      ORDER BY created_at DESC LIMIT 1`,
    [ownerId, transactionId],
  );
  const mile = await client.query<{ mile_awarded: string; dedupe_key: string }>(
    `SELECT mile_awarded::text, dedupe_key
       FROM action.mile_event
      WHERE owner_id = $1::uuid AND mission_id = $2::uuid
      ORDER BY created_at DESC LIMIT 1`,
    [ownerId, missionId],
  );
  const missionAfter = await client.query<{ current_progress_inr: string; title: string; state: string }>(
    `SELECT current_progress_inr::text, title, state
       FROM action.mission WHERE mission_id = $1::uuid`,
    [missionId],
  );
  const rewards = await client.query<{ total_mile_points: string; total_clarity_moments: string }>(
    `SELECT total_mile_points::text, total_clarity_moments::text
       FROM action.v_lifetime_mile_summary WHERE owner_id = $1::uuid`,
    [ownerId],
  );

  const progressAfter = Number(missionAfter.rows[0]?.current_progress_inr ?? 0);
  const mileAwarded = Number(mile.rows[0]?.mile_awarded ?? 0);
  const verification = outcome.rows[0]?.verification_status;

  if (verification !== "A3_ASSOCIATED") fail("outcome verification mismatch", { outcome: outcome.rows[0] });
  if (mileAwarded !== EXPECTED_MILE) fail("mile_awarded mismatch", { mile: mile.rows[0] });
  if (progressAfter < progressBefore + AMOUNT) {
    fail("mission progress did not advance by observed amount", { progressBefore, progressAfter });
  }

  const ui: Record<string, unknown> = {};
  const bearer = process.env.SMOKE_BEARER?.trim();
  if (bearer) {
    const publicBase = process.env.PUBLIC_API_URL || "http://127.0.0.1:8080";
    for (const path of ["/v1/ui/missions", "/v1/ui/rewards"]) {
      const response = await fetch(`${publicBase}${path}`, {
        headers: { authorization: `Bearer ${bearer}` },
      });
      ui[path] = { status: response.status, body: await response.json().catch(() => null) };
    }
  }

  log("smoke_ok", {
    mode,
    ownerId,
    missionId,
    transactionId,
    verification,
    mile_awarded: mileAwarded,
    progressBefore,
    progressAfter,
    progressDelta: progressAfter - progressBefore,
    rewards: rewards.rows[0] ?? null,
    dedupe_key: mile.rows[0]?.dedupe_key ?? null,
    ui: bearer ? ui : "skipped_no_SMOKE_BEARER",
  });

  // Idempotency check: re-apply should not double mint
  if (mode === "http" && financeUp && intelUp) {
    await internalPost(financeBase, "/v1/internal/apply-outcomes-mile", token, {
      owner_id: ownerId,
      transaction_id: transactionId,
      package: pkg,
    });
  } else {
    await applyViaSql(client, ownerId, transactionId, pkg);
  }
  const mileCount = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM action.mile_event
      WHERE owner_id = $1::uuid AND dedupe_key = $2`,
    [ownerId, mile.rows[0]!.dedupe_key],
  );
  if (mileCount.rows[0]?.n !== 1) fail("idempotency broken: duplicate mile_event", { count: mileCount.rows[0]?.n });
  log("idempotency_ok", { dedupe_key: mile.rows[0]?.dedupe_key, count: 1 });

  await client.end();
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
