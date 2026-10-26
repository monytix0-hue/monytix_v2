import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "pg";
import { openPool } from "../db/pool.js";
import type { LedgerRead } from "../ledger/read.js";
import { displayTransactionTitle, formatDisplayAmount } from "./displayTitle.js";

export type LiveRouteOptions = {
  ledger?: LedgerRead | null;
  databaseUrl?: string;
};

const unavailable = { available: false as const };
const ownerUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MissionCard = { title?: string | null; line?: string | null; progress?: string | null };
type MileOutcome = { title?: string | null };
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? value as Record<string, unknown> : null;
}

function missionCards(value: unknown): MissionCard[] {
  const doc = asRecord(value);
  const active = doc?.active;
  return Array.isArray(active) ? active as MissionCard[] : [];
}

function decisionCards(value: unknown): Array<{ title: string; question: string | null }> {
  const doc = asRecord(value);
  if (!doc) return [];
  const heaviest = asRecord(doc.heaviest);
  const rest = Array.isArray(doc.decisions) ? doc.decisions : [];
  const cards = [heaviest, ...rest.map((item) => asRecord(item))].filter((item): item is Record<string, unknown> => Boolean(item));
  return cards.flatMap((card) => {
    if (card.available === false || typeof card.title !== "string" || card.title.length === 0) return [];
    return [{ title: card.title, question: typeof card.question === "string" ? card.question : null }];
  }).slice(0, 2);
}

async function recordedWeights(pool: Pool, ownerId: string, from: string, to: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.owner_id', $1, true)", [ownerId]);
    const result = await client.query<{ name: string; amount: string }>(
      `SELECT CASE mw.primary_weight_code::text
                WHEN 'W01_TIME' THEN 'Time'
                WHEN 'W02_COMFORT' THEN 'Comfort'
                WHEN 'W03_RISK' THEN 'Risk'
                WHEN 'W04_OBLIGATIONS' THEN 'Obligations'
                WHEN 'W05_IDENTITY' THEN 'Identity'
                WHEN 'W06_RELATIONSHIPS' THEN 'Relationships'
                WHEN 'W07_OPPORTUNITY' THEN 'Opportunity'
                WHEN 'W08_ATTENTION' THEN 'Attention'
                WHEN 'W09_RESILIENCE' THEN 'Resilience'
                WHEN 'W10_LEGACY' THEN 'Legacy'
                ELSE mw.primary_weight_code::text
              END AS name,
              trim(cv.currency_code) || ' ' || to_char(sum(cv.amount), 'FM999999990.00') AS amount
         FROM core.movement_weight mw
         JOIN core.canonical_transaction_version cv
           ON cv.logical_transaction_id = mw.logical_transaction_id AND cv.is_current
         JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
        WHERE mw.owner_id = $1::uuid
          AND mw.primary_weight_code IS NOT NULL
          AND lt.identity_status = 'ACTIVE'
          AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
          AND cv.amount IS NOT NULL
          AND cv.transaction_date >= $2::date
          AND cv.transaction_date <= $3::date
        GROUP BY mw.primary_weight_code, cv.currency_code
        ORDER BY sum(cv.amount) DESC, name`,
      [ownerId, from, to],
    );
    await client.query("COMMIT");
    return result.rows.filter((row) => row.name);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function publishedWidgets(pool: Pool | null, ownerId: string, from: string, to: string) {
  const active_mission = { available: false as const };
  const active_missions: Array<{ title: string; line: string | null; progress: string | null }> = [];
  const decision_cards = { available: false as const, cards: [] as Array<{ title: string; question: string | null }> };
  const weight_summary = { available: false as const, weights: [] as Array<{ name: string; amount: string }> };
  const mile = { available: false as const, impact: null, line: null, pills: [] as string[] };
  if (!pool || !ownerUuid.test(ownerId)) return { active_mission, active_missions, decision_cards, weight_summary, mile };
  const [missions, miles, decisions, weights] = await Promise.all([
    pool.query<{ doc: unknown }>("SELECT ops.phone_mission_board($1::uuid) AS doc", [ownerId]),
    pool.query<{ doc: unknown }>("SELECT ops.phone_mile_summary($1::uuid) AS doc", [ownerId]),
    pool.query<{ doc: unknown }>("SELECT ops.phone_decision_board($1::uuid) AS doc", [ownerId]),
    recordedWeights(pool, ownerId, from, to).catch(() => []),
  ]);
  const cards = missionCards(missions.rows[0]?.doc).filter((card) => card.title).slice(0, 2).map((card) => ({
    title: card.title as string,
    line: card.line ?? null,
    progress: card.progress ?? null,
  }));
  const chosen = decisionCards(decisions.rows[0]?.doc);
  const summary = asRecord(miles.rows[0]?.doc);
  const impact = asRecord(summary?.impact);
  const movement = asRecord(summary?.movement);
  const outcomes = Array.isArray(summary?.outcomes) ? summary.outcomes : [];
  return {
    active_mission: cards[0]
      ? { available: true as const, title: cards[0].title, line: cards[0].line, progress: cards[0].progress }
      : active_mission,
    active_missions: cards,
    decision_cards: chosen.length > 0 ? { available: true as const, cards: chosen } : decision_cards,
    weight_summary: weights.length > 0 ? { available: true as const, weights } : weight_summary,
    mile: summary && summary.empty_state === false
      ? {
          available: true as const,
          impact: impact?.available ? (typeof impact.amount === "string" ? impact.amount : null) : null,
          line: movement?.available ? (typeof movement.line === "string" ? movement.line : null) : null,
          pills: outcomes.map((item) => asRecord(item)?.title).filter((title): title is string => typeof title === "string" && title.length > 0).slice(0, 2),
        }
      : mile,
  };
}

function monthRange(now = new Date()): { from: string; to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

async function recorded(ledger: LedgerRead, ownerId: string, limit: number) {
  const period = monthRange();
  const overview = await ledger.overview({
    ownerId,
    from: period.from,
    to: period.to,
    currency: null,
  });
  const page = await ledger.listTransactions({
    ownerId,
    limit,
    cursor: null,
    from: null,
    to: null,
    accountId: null,
    direction: null,
    category: null,
    subcategory: null,
    eventFamily: null,
  });
  const currencies = overview.currencies.map((row) => ({
    currency: row.currency,
    inflow: row.inflow,
    outflow: row.outflow,
  }));
  const accounts = await ledger.accountSummaries(ownerId);
  const balances = accounts.flatMap((account) => (account.availableBalance ? [account.availableBalance] : []));
  return {
    recordedFlow: {
      available: currencies.length > 0,
      from: period.from,
      to: period.to,
      currencies,
    },
    transactions: {
      available: true as const,
      hasRecorded: page.items.length > 0,
    },
    summary: {
      available_balance: balances.length === 1
        ? { available: true as const, amount: balances[0].amount, currency: balances[0].currency }
        : { available: false as const },
    },
    transactions_preview: page.items.map((item) => ({
      id: item.logicalTransactionId,
      amount: formatDisplayAmount(item.amount),
      currency: item.currency,
      direction: item.direction,
      transactionDate: item.transactionDate,
      description: displayTransactionTitle(item.description),
      accountName: item.accountName,
      weightName: item.weightName,
    })),
  };
}

export const liveRoutes: FastifyPluginAsync<LiveRouteOptions> = async (app, options) => {
  const ledger = options.ledger ?? null;
  const pool = options.databaseUrl ? openPool(options.databaseUrl) : null;
  if (pool) {
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }

  app.get("/v1/live", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId || !ledger) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    const body = await recorded(ledger, request.ownerId, 1);
    return {
      contract: "live-read-v0.1",
      recordedFlow: body.recordedFlow,
      transactions: {
        available: body.transactions.available,
        hasRecorded: body.transactions.hasRecorded,
      },
      greetingName: unavailable,
      needsContext: unavailable,
      missions: unavailable,
      decisions: unavailable,
      attention: unavailable,
      cashFlow: unavailable,
      weights: unavailable,
      mile: unavailable,
    };
  });

  app.get("/v1/ui/live", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId || !ledger) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    const body = await recorded(ledger, request.ownerId, 20);
    const widgets = await publishedWidgets(pool, request.ownerId, body.recordedFlow.from, body.recordedFlow.to);
    return {
      contract: "ui-live-v0.1",
      recordedFlow: body.recordedFlow,
      transactions: body.transactions,
      summary: body.summary,
      transactions_preview: body.transactions_preview,
      today_decisions: unavailable,
      weight_summary: widgets.weight_summary,
      reflection_summary: unavailable,
      active_mission: widgets.active_mission,
      active_missions: widgets.active_missions,
      decision_cards: widgets.decision_cards,
      mile: widgets.mile,
    };
  });
};
