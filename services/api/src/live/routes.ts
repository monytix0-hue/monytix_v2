import type { FastifyPluginAsync } from "fastify";
import type { LedgerRead } from "../ledger/read.js";
import { displayTransactionTitle, formatDisplayAmount } from "./displayTitle.js";

export type LiveRouteOptions = {
  ledger?: LedgerRead | null;
};

const unavailable = { available: false as const };

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
    })),
  };
}

export const liveRoutes: FastifyPluginAsync<LiveRouteOptions> = async (app, options) => {
  const ledger = options.ledger ?? null;

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
    return {
      contract: "ui-live-v0.1",
      recordedFlow: body.recordedFlow,
      transactions: body.transactions,
      summary: body.summary,
      transactions_preview: body.transactions_preview,
      today_decisions: unavailable,
      weight_summary: unavailable,
      reflection_summary: unavailable,
      active_mission: unavailable,
    };
  });
};
