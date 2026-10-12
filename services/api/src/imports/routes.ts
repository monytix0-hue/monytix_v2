import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { signatureMatches } from "./signatures.js";
import { sha256Hex, type ObjectStorage } from "./storage.js";
import { createImportStore, finalObjectKey, type ImportStore } from "./store.js";

export type ImportRouteOptions = {
  imports: ImportStore | null;
  storage: ObjectStorage | null;
};

const fileTypes = new Set(["PDF", "XLS", "XLSX", "CSV"]);
const sha256Text = /^[0-9a-f]{64}$/;
const maxBytes = 10_485_760;

export const importRoutes: FastifyPluginAsync<ImportRouteOptions> = async (app, options) => {
  const imports = options.imports;
  const storage = options.storage;

  app.post("/v1/imports", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    const key = headerValue(request.headers["idempotency-key"]);
    const body = readInitiation(request.body);
    if (!key || !body) {
      return reply.status(422).send({ error: "invalid_request" });
    }
    if (!imports || !storage) {
      return reply.status(503).send({ error: "unavailable" });
    }
    try {
      const authorized = await imports.authorize({
        actorId: request.actorId,
        ownerId: request.ownerId,
        idempotencyKey: key,
        fileType: body.fileType,
        byteSize: body.byteSize,
        sha256: body.sha256,
        filename: body.filename,
        sourceMetadata: body.sourceMetadata,
        financialAccountId: body.financialAccountId,
      });
      if (authorized.outcome === "forbidden") {
        return reply.status(403).send({ error: "owner_forbidden" });
      }
      if (authorized.outcome === "conflict") {
        return reply.status(409).send({ error: "idempotency_conflict" });
      }
      if (authorized.outcome === "invalid" || !authorized.body) {
        return reply.status(422).send({ error: "invalid_request" });
      }
      if (authorized.outcome === "replay") {
        return reply.status(201).send(authorized.body);
      }
      const data = authorized.body.data as { object_key: string; declared_mime_type: string; import_id: string };
      const signed = await storage.presignUpload({
        key: data.object_key,
        contentType: data.declared_mime_type,
        byteSize: body.byteSize,
      });
      const responseBody = {
        ...authorized.body,
        data: {
          ...data,
          upload: {
            url: signed.url,
            expires_at: ((authorized.body.data as { upload: { expires_at: string } }).upload).expires_at,
            headers: signed.headers,
          },
        },
      };
      if (!authorized.idempotency_record_id) {
        return reply.status(503).send({ error: "unavailable" });
      }
      const stored = await imports.saveGrant({
        actorId: request.actorId,
        ownerId: request.ownerId,
        idempotencyRecordId: authorized.idempotency_record_id,
        body: responseBody,
      });
      return reply.status(201).send(stored.body ?? responseBody);
    } catch {
      return reply.status(503).send({ error: "unavailable" });
    }
  });

  app.post("/v1/imports/:importId/complete", async (request, reply) => {
    return completeImport(request, reply, imports, storage);
  });

  app.get("/v1/imports/:importId/status", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId || !imports) {
      return reply.status(request.ownerId ? 503 : 403).send({ error: request.ownerId ? "unavailable" : "owner_forbidden" });
    }
    const importId = (request.params as { importId: string }).importId;
    try {
      const result = await imports.status({ actorId: request.actorId, ownerId: request.ownerId, importId });
      if (result.outcome === "forbidden") {
        return reply.status(403).send({ error: "owner_forbidden" });
      }
      return reply.status(200).send(result.body);
    } catch {
      return reply.status(503).send({ error: "unavailable" });
    }
  });

  app.get("/v1/imports/:importId/review", async (request, reply) => {
    return sendReview(request, reply, imports, null);
  });

  app.get("/v1/imports/:importId/review/:sourceRecordId", async (request, reply) => {
    const sourceRecordId = (request.params as { sourceRecordId: string }).sourceRecordId;
    return sendReview(request, reply, imports, sourceRecordId);
  });

  app.post("/v1/imports/:importId/review/:sourceRecordId", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId || !imports) {
      return reply.status(request.ownerId ? 503 : 403).send({ error: request.ownerId ? "unavailable" : "owner_forbidden" });
    }
    const params = request.params as { importId: string; sourceRecordId: string };
    const key = headerValue(request.headers["idempotency-key"]);
    const action = readReview(request.body);
    if (!key || !action) {
      return reply.status(422).send({ error: "invalid_request" });
    }
    try {
      const result = await imports.resolveReview({
        actorId: request.actorId,
        ownerId: request.ownerId,
        importId: params.importId,
        sourceRecordId: params.sourceRecordId,
        action: action.action,
        reviewVersion: action.reviewVersion,
        financialAccountId: action.financialAccountId,
        logicalTransactionId: action.logicalTransactionId,
        idempotencyKey: key,
      });
      return sendReviewResult(reply, result);
    } catch {
      return reply.status(503).send({ error: "unavailable" });
    }
  });

  app.post("/v1/imports/:importId/finalize", async (request, reply) => {
    if (!request.actorId) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    if (!request.ownerId || !imports) {
      return reply.status(request.ownerId ? 503 : 403).send({ error: request.ownerId ? "unavailable" : "owner_forbidden" });
    }
    const key = headerValue(request.headers["idempotency-key"]);
    if (!key) {
      return reply.status(422).send({ error: "invalid_request" });
    }
    try {
      const result = await imports.finalize({
        actorId: request.actorId,
        ownerId: request.ownerId,
        importId: (request.params as { importId: string }).importId,
        idempotencyKey: key,
      });
      if (result.outcome === "forbidden") {
        return reply.status(403).send({ error: "owner_forbidden" });
      }
      if (result.outcome === "review_pending") {
        return reply.status(409).send({ error: "review_pending", review_count: result.review_count ?? 0 });
      }
      if (result.outcome === "conflict" || result.outcome === "invalid" || !result.body) {
        return reply.status(result.outcome === "conflict" ? 409 : 422).send({ error: result.outcome === "conflict" ? "idempotency_conflict" : "invalid_request" });
      }
      return reply.status(200).send({ data: result.body });
    } catch {
      return reply.status(503).send({ error: "unavailable" });
    }
  });
};

async function completeImport(
  request: FastifyRequest,
  reply: FastifyReply,
  imports: ImportStore | null,
  storage: ObjectStorage | null,
) {
  if (!request.actorId) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  if (!request.ownerId) {
    return reply.status(403).send({ error: "owner_forbidden" });
  }
  if (!imports || !storage) {
    return reply.status(503).send({ error: "unavailable" });
  }
  const importId = (request.params as { importId: string }).importId;
  const stagingKey = `owners/${request.ownerId}/imports/${importId}/staging`;
  const finalKey = finalObjectKey(request.ownerId, importId);
  try {
    const current = await imports.status({ actorId: request.actorId, ownerId: request.ownerId, importId });
    if (current.outcome === "forbidden" || !current.body) {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    const data = (current.body as { data: Record<string, unknown> }).data;
    if (data.sealed === true) {
      return replayCompletion(reply, imports, request, importId, data, finalKey);
    }
    const object = await storage.readObject(stagingKey);
    if (!object) {
      const latest = await imports.status({ actorId: request.actorId, ownerId: request.ownerId, importId });
      const latestData = (latest.body as { data?: Record<string, unknown> } | undefined)?.data;
      if (latest.outcome !== "forbidden" && latestData?.sealed === true) {
        return replayCompletion(reply, imports, request, importId, latestData, finalKey);
      }
      const reason = grantExpired(data.grant_expires_at) ? "UPLOAD_EXPIRED" : "OBJECT_MISSING";
      await imports.fail({ actorId: request.actorId, ownerId: request.ownerId, importId, reason });
      return reply.status(422).send({ error: "invalid_request" });
    }
    const fileType = String(data.file_type);
    if (object.size !== Number(data.declared_byte_size) || object.size > maxBytes || !signatureMatches(fileType, object.body)) {
      await imports.fail({ actorId: request.actorId, ownerId: request.ownerId, importId, reason: "FILE_SIGNATURE" });
      await storage.deleteObject(stagingKey);
      return reply.status(422).send({ error: "invalid_request" });
    }
    const hash = sha256Hex(object.body);
    if (hash !== data.declared_sha256) {
      await imports.fail({ actorId: request.actorId, ownerId: request.ownerId, importId, reason: "CHECKSUM_MISMATCH" });
      await storage.deleteObject(stagingKey);
      return reply.status(422).send({ error: "invalid_request" });
    }
    const etag = await storage.copyObject(stagingKey, finalKey);
    const sealed = await storage.readObject(finalKey);
    if (!sealed || sha256Hex(sealed.body) !== hash) {
      await imports.fail({ actorId: request.actorId, ownerId: request.ownerId, importId, reason: "OBJECT_COPY" });
      return reply.status(422).send({ error: "invalid_request" });
    }
    const completed = await imports.complete({
      actorId: request.actorId,
      ownerId: request.ownerId,
      importId,
      size: sealed.size,
      mime: mimeFor(fileType),
      sha256: hash,
      etag: etag || sealed.etag,
      finalKey,
    });
    if (completed.outcome === "forbidden") {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    if (completed.outcome === "conflict" || completed.outcome === "invalid" || !completed.body) {
      return reply.status(422).send({ error: "invalid_request" });
    }
    await storage.deleteObject(stagingKey);
    return reply.status(201).send(completed.body);
  } catch {
    try {
      const latest = await imports.status({ actorId: request.actorId, ownerId: request.ownerId, importId });
      const latestData = (latest.body as { data?: Record<string, unknown> } | undefined)?.data;
      if (latest.outcome !== "forbidden" && latestData?.sealed === true) {
        return replayCompletion(reply, imports, request, importId, latestData, finalKey);
      }
    } catch {
      return reply.status(503).send({ error: "unavailable" });
    }
    return reply.status(503).send({ error: "unavailable" });
  }
}

async function sendReview(
  request: FastifyRequest,
  reply: FastifyReply,
  imports: ImportStore | null,
  sourceRecordId: string | null,
) {
  if (!request.actorId) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  if (!request.ownerId || !imports) {
    return reply.status(request.ownerId ? 503 : 403).send({ error: request.ownerId ? "unavailable" : "owner_forbidden" });
  }
  try {
    const result = await imports.reviewQueue({
      actorId: request.actorId,
      ownerId: request.ownerId,
      importId: (request.params as { importId: string }).importId,
      sourceRecordId,
    });
    if (result.outcome === "forbidden") {
      return reply.status(403).send({ error: "owner_forbidden" });
    }
    if (result.outcome === "not_found") {
      return reply.status(404).send({ error: "not_found" });
    }
    return reply.status(200).send({ data: { items: result.items ?? [] } });
  } catch {
    return reply.status(503).send({ error: "unavailable" });
  }
}

async function replayCompletion(
  reply: FastifyReply,
  imports: ImportStore,
  request: FastifyRequest,
  importId: string,
  data: Record<string, unknown>,
  finalKey: string,
) {
  const replay = await imports.complete({
    actorId: request.actorId!,
    ownerId: request.ownerId!,
    importId,
    size: Number(data.declared_byte_size),
    mime: mimeFor(String(data.file_type)),
    sha256: String(data.declared_sha256),
    etag: "",
    finalKey,
  });
  return reply.status(201).send(replay.body);
}

function sendReviewResult(reply: FastifyReply, result: { outcome: string; body?: Record<string, unknown> }) {
  if (result.outcome === "forbidden") {
    return reply.status(403).send({ error: "owner_forbidden" });
  }
  if (result.outcome === "account_bound") {
    return reply.status(409).send({ error: "account_bound" });
  }
  if (result.outcome === "stale") {
    return reply.status(409).send({ error: "stale_review" });
  }
  if (result.outcome === "conflict") {
    return reply.status(409).send({ error: "idempotency_conflict" });
  }
  if (result.outcome === "unresolved") {
    return reply.status(422).send({ error: "unresolved" });
  }
  if (result.outcome === "invalid" || !result.body) {
    return reply.status(422).send({ error: "invalid_request" });
  }
  return reply.status(200).send({ data: result.body });
}

function readReview(body: unknown): {
  action: string;
  reviewVersion: number;
  financialAccountId: string | null;
  logicalTransactionId: string | null;
} | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action : "";
  if (!["select_account", "confirm_new", "link_existing", "reject"].includes(action)) {
    return null;
  }
  if (typeof record.review_version !== "number" || !Number.isInteger(record.review_version)) {
    return null;
  }
  const financialAccountId = typeof record.financial_account_id === "string" ? record.financial_account_id : null;
  const logicalTransactionId = typeof record.logical_transaction_id === "string" ? record.logical_transaction_id : null;
  if (action === "select_account" && !financialAccountId) {
    return null;
  }
  if (action === "link_existing" && !logicalTransactionId) {
    return null;
  }
  return { action, reviewVersion: record.review_version, financialAccountId, logicalTransactionId };
}

function mimeFor(fileType: string): string {
  if (fileType === "PDF") return "application/pdf";
  if (fileType === "XLS") return "application/vnd.ms-excel";
  if (fileType === "XLSX") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "text/csv";
}

function readInitiation(body: unknown): {
  fileType: string;
  byteSize: number;
  sha256: string;
  filename: string;
  sourceMetadata: Record<string, unknown> | null;
  financialAccountId: string | null;
} | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if ("file" in record) {
    return null;
  }
  const fileType = typeof record.file_type === "string" ? record.file_type.toUpperCase() : "";
  const byteSize = typeof record.byte_size === "number" && Number.isInteger(record.byte_size) ? record.byte_size : -1;
  const sha256 = typeof record.sha256 === "string" ? record.sha256 : "";
  const filename = typeof record.original_filename === "string" ? record.original_filename.trim() : "";
  if (!fileTypes.has(fileType) || byteSize <= 0 || byteSize > maxBytes || !sha256Text.test(sha256) || filename.length === 0 || filename.length > 255) {
    return null;
  }
  if (record.source_metadata !== undefined && (typeof record.source_metadata !== "object" || record.source_metadata === null || Array.isArray(record.source_metadata))) {
    return null;
  }
  const financialAccountId = readOptionalUuid(record.financial_account_id);
  if (financialAccountId === undefined) {
    return null;
  }
  return {
    fileType,
    byteSize,
    sha256,
    filename,
    sourceMetadata: (record.source_metadata as Record<string, unknown> | undefined) ?? null,
    financialAccountId,
  };
}

function readOptionalUuid(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return undefined;
  }
  return value;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function grantExpired(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const expires = Date.parse(value);
  return Number.isFinite(expires) && expires <= Date.now();
}

export { createImportStore };
