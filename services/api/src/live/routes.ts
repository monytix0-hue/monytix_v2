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

async function publishedWidgets(pool: Pool | null, ownerId: string) {
  const active_mission = { available: false as const };
  const mile = { available: false as const, impact: null, line: null, pills: [] as string[] };
  if (!pool || !ownerUuid.test(ownerId)) return { active_mission, mile };
  const [missions, miles] = await Promise.all([
    pool.query<{ doc: { active?: MissionCard[] } | null }>("SELECT ops.phone_mission_board($1::uuid) AS doc", [ownerId]),
    pool.query<{ doc: { empty_state?: boolean; impact?: { available?: boolean; amount?: string | null }; movement?: { available?: boolean; line?: string | null }; outcomes?: MileOutcome[] } | null }>(
      "SELECT ops.phone_mile_summary($1::uuid) AS doc",
      [ownerId],
    ),
  ]);
  const first = missions.rows[0]?.doc?.active?.[0];
  const summary = miles.rows[0]?.doc;
  return {
    active_mission: first?.title
      ? { available: true as const, title: first.title, line: first.line ?? null, progress: first.progress ?? null }
      : active_mission,
    mile: summary && summary.empty_state === false
      ? {
          available: true as const,
          impact: summary.impact?.available ? summary.impact.amount ?? null : null,
          line: summary.movement?.available ? summary.movement.line ?? null : null,
          pills: (summary.outcomes ?? []).map((item) => item.title).filter((title): title is string => Boolean(title)).slice(0, 2),
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
    const widgets = await publishedWidgets(pool, request.ownerId);
    return {
      contract: "ui-live-v0.1",
      recordedFlow: body.recordedFlow,
      transactions: body.transactions,
      summary: body.summary,
      transactions_preview: body.transactions_preview,
      today_decisions: unavailable,
      weight_summary: unavailable,
      reflection_summary: unavailable,
      active_mission: widgets.active_mission,
      mile: widgets.mile,
    };
  });
};
