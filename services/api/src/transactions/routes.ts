import { Readable } from "node:stream";
import type { FastifyPluginAsync } from "fastify";
import type { CategoryChoiceStore, CategoryMatchScope } from "./category.js";
import type { ManualTransactionStore } from "./manual.js";

export type TransactionsStub = {
  module: "transactions";
  status: "stub";
};

export type TransactionsRouteOptions = {
  manual?: ManualTransactionStore | null;
  categories?: CategoryChoiceStore | null;
};

const amountLiteral = /"amount"\s*:\s*("(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
const decimalText = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
const uuidText = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const currencyText = /^[A-Z]{3}$/;
const occurredText = /^\d{4}-\d{2}-\d{2}T/;

type ManualBody = {
  financialAccountId: string;
  amountText: string;
  currency: string;
  direction: "IN" | "OUT";
  occurredAt: string;
  merchantDescription: string;
  categoryCode: string;
  subcategoryCode: string;
  userSelectedWeights: string[] | null;
};

/** Ledger transactions. */
export const transactionsRoutes: FastifyPluginAsync<TransactionsRouteOptions> = async (app, options) => {
  const manual = options.manual ?? null;
  const categories = options.categories ?? null;

  app.addHook("preParsing", async (request, _reply, payload) => {
    if (request.method !== "POST" || request.url.split("?")[0] !== "/v1/transactions/manual") {
      return payload;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of payload as AsyncIterable<Buffer | string>) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    request.rawBody = raw;
    return Readable.from(Buffer.from(raw));
  });

  app.get("/transactions", async (): Promise<TransactionsStub> => {
    return { module: "transactions", status: "stub" };
  });

  app.post("/v1/transactions/manual", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }

    const idempotencyKey = headerValue(request.headers["idempotency-key"]);
    const body = readManualBody(request.rawBody);
    if (!idempotencyKey || !body) {
      return reply.status(422).send({ error: "invalid_request" });
    }
    if (!manual) {
      return reply.status(503).send({ error: "auth_unconfigured" });
    }

    let result;
    try {
      result = await manual.create({
        actorId: request.actorId,
        ownerId: request.ownerId,
        idempotencyKey,
        financialAccountId: body.financialAccountId,
        amountText: body.amountText,
        currency: body.currency,
        direction: body.direction,
        occurredAt: body.occurredAt,
        merchantDescription: body.merchantDescription,
        categoryCode: body.categoryCode,
        subcategoryCode: body.subcategoryCode,
        userSelectedWeights: body.userSelectedWeights,
      });
    } catch {
      return reply.status(503).send({ error: "unavailable" });
    }

    if (result.outcome === "forbidden") {
      return reply.status(403).send({ error: "account_forbidden" });
    }
    if (result.outcome === "conflict") {
      return reply.status(409).send({ error: "idempotency_conflict" });
    }
    if (result.outcome === "invalid" || result.body === undefined) {
      return reply.status(422).send({ error: "invalid_request" });
    }
    return reply.status(201).send(result.body);
  });

  app.patch<{ Params: { logicalTransactionId: string } }>("/v1/transactions/:logicalTransactionId/category", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    const choice = readCategoryBody(request.body);
    if (!choice || !uuidText.test(request.params.logicalTransactionId)) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    if (!categories) {
      return reply.status(503).send({ error: "unavailable" });
    }
    const result = await categories.set({
      actorId: request.actorId,
      ownerId: request.ownerId,
      logicalTransactionId: request.params.logicalTransactionId,
      categoryId: choice.categoryId,
      applyToPast: choice.applyToPast,
      matchScope: choice.matchScope,
    });
    if (result.outcome === "missing") {
      return reply.status(404).send({ error: "not_found" });
    }
    if (result.outcome === "invalid_category") {
      return reply.status(400).send({ error: "invalid_category" });
    }
    if (result.outcome === "invalid") {
      return reply.status(400).send({ error: "invalid_request" });
    }
    if (result.outcome === "forbidden" || !result.body) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    return reply.send(result.body);
  });
};

function readCategoryBody(body: unknown): { categoryId: string; applyToPast: boolean; matchScope: CategoryMatchScope } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.category_id !== "string" || record.category_id.trim().length === 0) {
    return null;
  }
  if (record.apply_to_past !== undefined && typeof record.apply_to_past !== "boolean") {
    return null;
  }
  const scope = record.match_scope === undefined ? "EXACT_MERCHANT" : record.match_scope;
  if (scope !== "EXACT_MERCHANT" && scope !== "RAW_TOKEN") {
    return null;
  }
  return {
    categoryId: record.category_id.trim(),
    applyToPast: record.apply_to_past === true,
    matchScope: scope,
  };
}

function headerValue(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readManualBody(raw: string | undefined): ManualBody | null {
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const amountText = readAmount(raw);
  const financialAccountId = readUuid(record.financial_account_id);
  const currency = typeof record.currency === "string" && currencyText.test(record.currency) ? record.currency : null;
  const direction = record.direction === "IN" || record.direction === "OUT" ? record.direction : null;
  const occurredAt = typeof record.occurred_at === "string" && occurredText.test(record.occurred_at) && !Number.isNaN(Date.parse(record.occurred_at))
    ? record.occurred_at
    : null;
  const merchantDescription = typeof record.merchant_description === "string" && record.merchant_description.trim().length > 0
    ? record.merchant_description
    : null;
  const categoryCode = typeof record.category_code === "string" && record.category_code.trim().length > 0
    ? record.category_code
    : null;
  const subcategoryCode = typeof record.subcategory_code === "string" && record.subcategory_code.trim().length > 0
    ? record.subcategory_code
    : null;
  const userSelectedWeights = readWeights(record.user_selected_weights);
  if (!amountText || !financialAccountId || !currency || !direction || !occurredAt || !merchantDescription || !categoryCode || !subcategoryCode || userSelectedWeights === undefined) {
    return null;
  }
  return {
    financialAccountId,
    amountText,
    currency,
    direction,
    occurredAt,
    merchantDescription,
    categoryCode,
    subcategoryCode,
    userSelectedWeights,
  };
}

function readAmount(raw: string): string | null {
  const matches = [...raw.matchAll(amountLiteral)];
  if (matches.length !== 1) {
    return null;
  }
  const literal = matches[0][1];
  if (!literal) {
    return null;
  }
  const text = literal.startsWith("\"") ? readQuoted(literal) : literal;
  if (!text || /[eE]/.test(text) || !decimalText.test(text) || /^0(?:\.0+)?$/.test(text)) {
    return null;
  }
  return text;
}

function readQuoted(literal: string): string | null {
  try {
    const value = JSON.parse(literal);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function readUuid(value: unknown): string | null {
  return typeof value === "string" && uuidText.test(value) ? value : null;
}

function readWeights(value: unknown): string[] | null | undefined {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return value;
}

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}
