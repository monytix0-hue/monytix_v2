import type { FastifyPluginAsync } from "fastify";
import type { LedgerRead } from "./read.js";
import { decodeCursor } from "./read.js";

export type LedgerRouteOptions = {
  ledger?: LedgerRead | null;
};

const dateText = /^\d{4}-\d{2}-\d{2}$/;
const uuidText = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const currencyText = /^[A-Z]{3}$/;

const questions = [
  "How much money came in this month?",
  "How much money went out this month?",
  "Show my latest transactions.",
  "What were my loan repayments?",
  "What were my credit-card payments?",
] as const;

type Question = (typeof questions)[number];

function queryText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function monthRange(now = new Date()): { from: string; to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export const ledgerRoutes: FastifyPluginAsync<LedgerRouteOptions> = async (app, options) => {
  const ledger = options.ledger ?? null;

  app.get("/v1/transactions", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId || !ledger) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    const query = request.query as Record<string, unknown>;
    const from = queryText(query.from);
    const to = queryText(query.to);
    const accountId = queryText(query.accountId);
    const direction = queryText(query.direction);
    const cursor = queryText(query.cursor);
    const limitText = queryText(query.limit);
    const limit = limitText ? Number(limitText) : 20;
    if ((from && !dateText.test(from)) || (to && !dateText.test(to)) || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      return reply.status(422).send({ error: "invalid_request" });
    }
    if (accountId && !uuidText.test(accountId)) {
      return reply.status(422).send({ error: "invalid_request" });
    }
    if (direction && direction !== "IN" && direction !== "OUT") {
      return reply.status(422).send({ error: "invalid_request" });
    }
    if (cursor && !decodeCursor(cursor)) {
      return reply.status(422).send({ error: "invalid_request" });
    }
    const page = await ledger.listTransactions({
      ownerId: request.ownerId,
      limit,
      cursor,
      from,
      to,
      accountId,
      direction: direction as "IN" | "OUT" | null,
      eventFamily: null,
    });
    return { contract: "ledger-read-v0.1", ...page };
  });

  app.get("/v1/accounts/summaries", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId || !ledger) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    const accounts = await ledger.accountSummaries(request.ownerId);
    return { contract: "account-summary-v0.1", accounts };
  });

  app.get("/v1/finance/overview", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId || !ledger) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    const query = request.query as Record<string, unknown>;
    const from = queryText(query.from);
    const to = queryText(query.to);
    const currency = queryText(query.currency);
    if ((from && !dateText.test(from)) || (to && !dateText.test(to)) || (currency && !currencyText.test(currency))) {
      return reply.status(422).send({ error: "invalid_request" });
    }
    const overview = await ledger.overview({ ownerId: request.ownerId, from, to, currency });
    return { contract: "finance-overview-v0.1", ...overview };
  });

  app.post("/v1/molybot/ask", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId || !ledger) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    const body = request.body as { question?: unknown } | undefined;
    const question = typeof body?.question === "string" ? body.question : "";
    if (!questions.includes(question as Question)) {
      return {
        contract: "molybot-read-v0.1",
        question,
        available: false,
        answer: "That question is not available from the recorded ledger.",
      };
    }
    const period = monthRange();
    if (question === "Show my latest transactions.") {
      const page = await ledger.listTransactions({
        ownerId: request.ownerId,
        limit: 5,
        cursor: null,
        from: null,
        to: null,
        accountId: null,
        direction: null,
        eventFamily: null,
      });
      return {
        contract: "molybot-read-v0.1",
        question,
        available: page.items.length > 0,
        complete: page.nextCursor === null,
        answer: page.items.length === 0
          ? "No recorded transactions are available."
          : page.nextCursor
            ? "Latest recorded transactions. More recorded transactions exist beyond this page."
            : "Latest recorded transactions.",
        items: page.items,
      };
    }
    if (question === "What were my loan repayments?" || question === "What were my credit-card payments?") {
      const family = question.startsWith("What were my loan") ? "LOAN_REPAYMENT" : "CREDIT_CARD_PAYMENT";
      const page = await ledger.listTransactions({
        ownerId: request.ownerId,
        limit: 50,
        cursor: null,
        from: null,
        to: null,
        accountId: null,
        direction: null,
        eventFamily: family,
      });
      if (page.nextCursor) {
        return {
          contract: "molybot-read-v0.1",
          question,
          available: false,
          complete: false,
          answer: `More than 50 recorded ${family} transactions exist, so a complete answer is not available.`,
          items: [],
        };
      }
      return {
        contract: "molybot-read-v0.1",
        question,
        available: page.items.length > 0,
        complete: true,
        answer: page.items.length > 0 ? `Recorded ${family} transactions.` : `No recorded ${family} transactions are available.`,
        items: page.items,
      };
    }
    const direction = question === "How much money came in this month?" ? "IN" : "OUT";
    const overview = await ledger.overview({ ownerId: request.ownerId, from: period.from, to: period.to, currency: null });
    if (overview.currencies.length === 0) {
      return {
        contract: "molybot-read-v0.1",
        question,
        available: false,
        complete: true,
        period,
        answer: "No recorded transactions are available for this month.",
        currencies: [],
      };
    }
    return {
      contract: "molybot-read-v0.1",
      question,
      available: true,
      complete: true,
      period,
      answer: direction === "IN" ? "Recorded inflow by currency for this month." : "Recorded outflow by currency for this month.",
      currencies: overview.currencies.map((row) => ({
        currency: row.currency,
        amount: direction === "IN" ? row.inflow : row.outflow,
      })),
    };
  });
};
