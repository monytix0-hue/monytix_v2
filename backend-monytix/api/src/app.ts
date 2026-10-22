import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { SnapshotCache } from "./cache.js";
import { ExtractError, type PdfExtractor } from "./extract.js";
import type { ApplyDecisionInput, DecisionActionName } from "./decisions.js";
import { DECISION_ACTIONS } from "./decisions.js";
import type { ApplyOutcomesMileInput } from "./outcomes.js";
import type { FinanceWriter, ReflectionInput, WeightFeedbackInput } from "./finance.js";
import { ACTIONS, MODES, WEIGHTS, type DecisionMode, type FeedbackAction, type HumanContextResult, type WeightCode } from "./human-context.js";
import { buildHome } from "./home.js";
import type { MongoStore } from "./mongo.js";
import { publishRecord, type QueueClient } from "./queue.js";
import type { MalwareScanner } from "./scan.js";
import { sealCredential, unsealCredential } from "./secret.js";
import {
  MemoryImportSessions,
  mimeForFileType,
  newImportId,
  statusEnvelope,
  type ImportSessionStore,
} from "./imports-mobile.js";
import type { ObjectStore } from "./storage.js";
import type { Normalized } from "./types.js";
import {
  decisionsReadModel,
  journeyReadModel,
  metaEnvelope,
  missionsReadModel,
  rewardsReadModel,
} from "./ui-read-models.js";
import type { IntelligenceClient } from "./worker.js";
import { routeRecord } from "./worker.js";

export type Verified = { subject: string; email: string | null };

export type TokenVerifier = { verify(token: string): Promise<Verified> };

export type IdentityStore = {
  provisionActor(subject: string, email: string | null): Promise<string>;
  resolveOwner(actorId: string, requested: string | null, email: string | null): Promise<string>;
};

export class AuthError extends Error {
  constructor(readonly statusCode: number, readonly code: string) {
    super(code);
  }
}

export class MemoryIdentity implements IdentityStore {
  private actors = new Map<string, string>();
  private owners = new Map<string, string>();
  membership = new Set<string>();

  async provisionActor(subject: string): Promise<string> {
    const existing = this.actors.get(subject);
    if (existing) return existing;
    const id = randomBytes(8).toString("hex");
    this.actors.set(subject, id);
    return id;
  }

  async resolveOwner(actorId: string, requested: string | null): Promise<string> {
    if (requested) {
      if (!this.membership.has(`${actorId}:${requested}`) && this.owners.get(actorId) !== requested) {
        throw new AuthError(403, "owner_forbidden");
      }
      return requested;
    }
    const existing = this.owners.get(actorId);
    if (existing) return existing;
    const ownerId = randomBytes(8).toString("hex");
    this.owners.set(actorId, ownerId);
    this.membership.add(`${actorId}:${ownerId}`);
    return ownerId;
  }
}

const internalPaths = new Set([
  "/v1/internal/apply",
  "/v1/internal/ingest",
  "/v1/internal/fx",
  "/v1/internal/gmail/renew",
  "/v1/internal/gmail/checkpoint",
  "/v1/internal/forex/reconcile",
  "/v1/internal/human/pending",
  "/v1/internal/apply-human-context",
  "/v1/internal/decision-eval-context",
  "/v1/internal/apply-decision-evaluation",
  "/v1/internal/outcomes/pending",
  "/v1/internal/apply-outcomes-mile",
  "/v1/internal/decisions/sweep-expired",
]);

const publicPaths = new Set([
  "/health",
  "/v1/aa/webhook/consent",
  "/v1/aa/webhook/fi",
  "/gmail/webhook",
  "/gmail/oauth/callback",
]);

export function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function signaturesMatch(body: string, header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const expected = signBody(body, secret);
  const left = Buffer.from(expected);
  const right = Buffer.from(header.trim());
  return left.length === right.length && timingSafeEqual(left, right);
}

export type AaClient = {
  createConsent(ownerId: string): Promise<{ consent_id: string; redirect_url: string }>;
  createFiRequest(consentId: string, material: unknown): Promise<string>;
  fetchFi(sessionId: string): Promise<{ consentId?: string; FI: { fipId: string; fiType: string; data: unknown }[] }>;
};

export type GmailClient = {
  exchangeCode(code: string): Promise<{ refresh_token: string; access_token: string; email: string }>;
  listMessages(accessToken: string): Promise<{ id: string; text: string; subject: string }[]>;
  watch?(accessToken: string): Promise<{ history_id: string; expiration: string }>;
  refresh?(refreshToken: string): Promise<{ access_token: string }>;
};

export type KeyMaterialClient = {
  issue(): Promise<{ our_nonce: string; key_material: unknown }>;
};

export type BuildDeps = {
  verifier: TokenVerifier | null;
  identity: IdentityStore | null;
  mongo: MongoStore;
  finance: FinanceWriter;
  intelligence: IntelligenceClient;
  aa: AaClient | null;
  keys: KeyMaterialClient | null;
  gmail: GmailClient | null;
  gmailClientId: string;
  gmailRedirectUri?: string;
  gmailTokenKey?: string;
  webhookSecret: string;
  objects: Map<string, Buffer>;
  storage?: ObjectStore | null;
  imports?: ImportSessionStore;
  extractor?: PdfExtractor | null;
  queue?: QueueClient | null;
  internalToken?: string;
  scanner?: MalwareScanner | null;
  snapshots?: SnapshotCache | null;
  gmailPush?: { verify(token: string): Promise<{ subject: string; email: string }> } | null;
  displayCurrency?: string;
};

export function createApp(deps: BuildDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 15 * 1024 * 1024 });
  const importSessions = deps.imports ?? new MemoryImportSessions();
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    request.rawBody = text;
    try {
      done(null, text.length ? JSON.parse(text) : {});
    } catch (error) {
      done(error as Error, undefined);
    }
  });
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthError) {
      return reply.status(error.statusCode).send({ error: error.code });
    }
    return reply.status(500).send({ error: "internal" });
  });

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    if (internalPaths.has(path)) {
      if (!deps.internalToken || !bearerMatches(request.headers.authorization, deps.internalToken)) {
        throw new AuthError(401, "unauthorized");
      }
      return;
    }
    if (publicPaths.has(path)) return;
    if (!deps.verifier || !deps.identity) {
      throw new AuthError(503, "auth_unconfigured");
    }
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new AuthError(401, "unauthorized");
    try {
      const verified = await deps.verifier.verify(token);
      const actorId = await deps.identity.provisionActor(verified.subject, verified.email);
      const requested = headerValue(request.headers["x-monytix-owner-id"]);
      const ownerId = await deps.identity.resolveOwner(actorId, requested, verified.email);
      request.actorId = actorId;
      request.ownerId = ownerId;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(401, "unauthorized");
    }
  });

  app.get("/health", async () => ({ service: "finance-api", status: "ok" }));

  // Mobile contract: initiate → PUT object → /:id/complete → status / open
  app.post("/v1/imports", async (request, reply) => {
    const ownerId = requireOwner(request, reply);
    const body = request.body as {
      idempotency_key?: string;
      filename?: string;
      sha256?: string;
      file_type?: string;
      byte_size?: number;
      original_filename?: string;
    } | null;
    const idemHeader = headerValue(request.headers["idempotency-key"]);
    const mobileShape = Boolean(idemHeader && (body?.file_type || body?.original_filename));
    if (mobileShape) {
      const fileType = String(body?.file_type || "PDF").toUpperCase();
      const filename = String(body?.original_filename || body?.filename || "statement.pdf").slice(0, 255);
      const importId = newImportId();
      const objectKey = `pdf/${ownerId}/${importId}`;
      const mime = mimeForFileType(fileType);
      const upload = deps.storage
        ? await deps.storage.presignPut(objectKey)
        : { url: `memory://${objectKey}`, method: "PUT" as const };
      const expiresAt = new Date(Date.now() + 900_000).toISOString();
      importSessions.create({
        import_id: importId,
        owner_id: ownerId,
        object_key: objectKey,
        filename,
        file_type: fileType,
        mime,
        sha256: typeof body?.sha256 === "string" ? body.sha256 : null,
        byte_size: typeof body?.byte_size === "number" ? body.byte_size : null,
      });
      return reply.status(201).send({
        data: {
          import_id: importId,
          object_key: objectKey,
          declared_mime_type: mime,
          upload: {
            url: upload.url,
            expires_at: expiresAt,
            headers: { "content-type": mime },
          },
        },
      });
    }
    // Legacy initiate (body idempotency_key + filename)
    if (!body?.idempotency_key || !body.filename) return reply.status(400).send({ error: "invalid_request" });
    const key = `pdf/${ownerId}/${body.idempotency_key}`;
    const upload = deps.storage ? await deps.storage.presignPut(key) : { url: `memory://${key}`, method: "PUT" as const };
    return { import_id: key, upload };
  });

  app.put("/v1/imports/bytes", async (request, reply) => {
    const ownerId = requireOwner(request, reply);
    const key = headerValue(request.headers["x-object-key"]);
    if (!key || !key.startsWith(`pdf/${ownerId}/`)) return reply.status(400).send({ error: "invalid_request" });
    const raw = request.body;
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(typeof raw === "string" ? raw : JSON.stringify(raw ?? ""));
    if (bytes.length > 15_728_640) return reply.status(413).send({ error: "too_large" });
    deps.objects.set(key, bytes);
    return { stored: true };
  });

  // Legacy complete must register before /:importId/* so "complete" is not captured as an id.
  app.post("/v1/imports/complete", async (request, reply) => {
    const ownerId = requireOwner(request, reply);
    const body = request.body as { object_key?: string; raw_text?: string; idempotency_key?: string; password?: string };
    if (!body?.idempotency_key) return reply.status(400).send({ error: "invalid_request" });
    let rawText = body.raw_text?.trim() ?? "";
    if (!rawText) {
      if (!body.object_key) return reply.status(400).send({ error: "invalid_request" });
      const bytes = await pdfBytes(deps, body.object_key);
      if (!bytes) return reply.status(422).send({ error: "unscanned" });
      const blocked = await scanPdf(deps, bytes);
      if (blocked) return reply.status(422).send({ error: blocked });
      if (!deps.extractor) return reply.status(503).send({ error: "unavailable" });
      try {
        rawText = await deps.extractor.extractPdf(bytes, body.password);
      } catch (error) {
        if (error instanceof ExtractError) {
          if (error.code === "PASSWORD_REQUIRED") return reply.status(422).send({ error: "WAITING_FOR_PASSWORD" });
          if (error.code === "PASSWORD_REJECTED" || error.code === "SCANNED_DOCUMENT_OCR_NOT_PERMITTED") {
            return reply.status(422).send({ error: error.code });
          }
        }
        throw error;
      }
    } else if (deps.scanner) {
      const bytes = body.object_key ? deps.objects.get(body.object_key) : undefined;
      if (!bytes) return reply.status(422).send({ error: "unscanned" });
      const blocked = await scanPdf(deps, bytes);
      if (blocked) return reply.status(422).send({ error: blocked });
    }
    const inserted = await deps.mongo.insertInbound({
      owner_id: ownerId,
      source: "PDF_UPLOAD",
      channel_type: "STATEMENT_PDF",
      payload: { raw_text: rawText, storage_ref: body.object_key ? `memory://${body.object_key}` : null, mime_headers: {} },
      idempotency_key: `pdf:${body.idempotency_key}`,
    });
    await publishRecord(deps.queue, inserted);
    return { import_id: inserted._id, ingest_status: inserted.ingest_status };
  });

  app.get("/v1/imports/pending-unlock", async (request, reply) => {
    const ownerId = requireOwner(request, reply);
    return { imports: importSessions.listPendingUnlock(ownerId) };
  });

  app.get("/v1/imports/:importId/status", async (request, reply) => {
    const ownerId = requireOwner(request, reply);
    const importId = (request.params as { importId: string }).importId;
    const session = importSessions.get(importId);
    if (!session || session.owner_id !== ownerId) return reply.status(404).send({ error: "not_found" });
    if (session.mongo_id) {
      const record = await deps.mongo.get(session.mongo_id);
      if (record?.ingest_status === "ROUTED") {
        importSessions.update(importId, { state: "ROUTED", stage: "Imported", imported_transaction_count: session.imported_transaction_count ?? 0 });
      } else if (record?.ingest_status === "FAILED") {
        importSessions.update(importId, {
          state: "FAILED",
          stage: `FAILED ${record.error || "ingest"}`,
          extraction_failure: record.error ?? "FAILED",
        });
      }
    }
    const latest = importSessions.get(importId)!;
    return statusEnvelope(latest);
  });

  app.post("/v1/imports/:importId/complete", async (request, reply) => {
    const ownerId = requireOwner(request, reply);
    const importId = (request.params as { importId: string }).importId;
    const session = importSessions.get(importId);
    if (!session || session.owner_id !== ownerId) return reply.status(404).send({ error: "not_found" });
    const body = (request.body as { password?: string; statement_password?: string } | null) ?? {};
    const password = body.password || body.statement_password || undefined;
    const result = await finalizeMobileImport(deps, importSessions, session.import_id, password ?? null);
    if (result.error) return reply.status(result.status).send({ error: result.error });
    return reply.status(200).send({ data: { import_id: importId, ingest_status: result.ingest_status } });
  });

  app.post("/v1/imports/:importId/open", async (request, reply) => {
    const ownerId = requireOwner(request, reply);
    const importId = (request.params as { importId: string }).importId;
    const session = importSessions.get(importId);
    if (!session || session.owner_id !== ownerId) return reply.status(404).send({ error: "not_found" });
    if (session.state !== "WAITING_PASSWORD" && session.state !== "CREATED") {
      return reply.status(409).send({ error: "conflict" });
    }
    const body = request.body as { statement_password?: string; password?: string } | null;
    const password = body?.statement_password || body?.password;
    if (!password) return reply.status(422).send({ error: "invalid_request" });
    const result = await finalizeMobileImport(deps, importSessions, importId, password);
    if (result.error === "PASSWORD_REJECTED" || result.error === "WAITING_FOR_PASSWORD") {
      return reply.status(422).send({ error: result.error === "WAITING_FOR_PASSWORD" ? "PASSWORD_REJECTED" : result.error });
    }
    if (result.error) return reply.status(result.status).send({ error: result.error });
    return reply.status(200).send({ data: { import_id: importId, opened: true } });
  });

  app.get("/gmail/oauth/start", async (request) => {
    const ownerId = request.ownerId;
    if (!ownerId) throw new AuthError(403, "owner_forbidden");
    if (!deps.gmailClientId) throw new AuthError(503, "unavailable");
    const query = new URLSearchParams({
      client_id: deps.gmailClientId,
      response_type: "code",
      scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
      access_type: "offline",
      prompt: "consent",
      state: ownerId,
    });
    if (deps.gmailRedirectUri) query.set("redirect_uri", deps.gmailRedirectUri);
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
    return { url, server_client_id: deps.gmailClientId };
  });

  app.post("/v1/gmail/connect/code", async (request, reply) => {
    const ownerId = requireOwner(request, reply);
    if (!deps.gmail) return reply.status(503).send({ error: "unavailable" });
    const code = (request.body as { code?: string })?.code;
    if (!code) return reply.status(400).send({ error: "invalid_request" });
    const exchanged = await deps.gmail.exchangeCode(code);
    const sealed = deps.gmailTokenKey ? sealCredential(exchanged.refresh_token, deps.gmailTokenKey) : `sealed:${exchanged.refresh_token}`;
    await deps.mongo.saveGmail(ownerId, sealed, exchanged.email);
    let historyId: string | null = null;
    if (deps.gmail.watch) {
      const watched = await deps.gmail.watch(exchanged.access_token);
      historyId = watched.history_id;
      await deps.mongo.saveWatch(ownerId, watched.history_id, watched.expiration);
    }
    if (deps.queue) {
      await deps.queue.enqueue({
        task: "gmail.backfill",
        queue: "intake",
        payload: { owner_id: ownerId, access_token: exchanged.access_token },
      });
      return { connected: true, backfill_ids: [], history_id: historyId };
    }
    const messages = await deps.gmail.listMessages(exchanged.access_token);
    const ids: string[] = [];
    for (const message of messages) {
      const row = await deps.mongo.insertInbound({
        owner_id: ownerId,
        source: "GMAIL",
        channel_type: "SPOT_ALERT",
        payload: { raw_text: message.text, mime_headers: { subject: message.subject }, storage_ref: null },
        idempotency_key: `gmail_msg_${message.id}`,
      });
      ids.push(row._id);
      await publishRecord(deps.queue, row);
    }
    return { connected: true, backfill_ids: ids };
  });

  app.post("/gmail/webhook", async (request, reply) => {
    if (!deps.gmailPush) return reply.status(503).send({ error: "unavailable" });
    const token = bearer(request.headers.authorization);
    if (!token) return reply.status(401).send({ error: "unauthorized" });
    try {
      await deps.gmailPush.verify(token);
    } catch {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const envelope = decodePubSub(request.body);
    if (!envelope) return reply.status(400).send({ error: "invalid_request" });
    if (!await deps.mongo.claimPubSub(envelope.messageId)) return { status: "ACK" };
    try {
      const mailbox = await deps.mongo.findGmailByEmail(envelope.emailAddress);
      if (!mailbox || !deps.queue || !deps.gmail?.refresh || !deps.gmailTokenKey) return { status: "ACK" };
      if (BigInt(envelope.historyId) <= BigInt(mailbox.history_id || "0")) return { status: "ACK" };
      const access = await deps.gmail.refresh(unsealCredential(mailbox.sealed, deps.gmailTokenKey));
      await deps.queue.enqueue({
        task: "gmail.history",
        queue: "intake",
        payload: { owner_id: mailbox.owner_id, history_id: mailbox.history_id, access_token: access.access_token },
      });
      return { status: "ACK" };
    } catch (error) {
      await deps.mongo.releasePubSub(envelope.messageId);
      throw error;
    }
  });

  const createConsent = async (request: FastifyRequest, reply: FastifyReply) => {
    const ownerId = requireOwner(request, reply);
    if (!deps.aa) return reply.status(503).send({ error: "AA_UNAVAILABLE" });
    const consent = await deps.aa.createConsent(ownerId);
    await deps.mongo.saveConsent(consent.consent_id, ownerId, consent.redirect_url);
    return { redirect_url: consent.redirect_url, consent_id: consent.consent_id };
  };
  app.post("/v1/aa/consents", createConsent);
  app.post("/v1/aa/consent", createConsent);

  app.post("/v1/aa/webhook/consent", async (request, reply) => {
    if (!signaturesMatch(request.rawBody ?? "", request.headers["x-aa-signature"] as string | undefined, deps.webhookSecret)) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const body = request.body as { consentId?: string; consentStatus?: string };
    if (body.consentStatus === "ACTIVE" && body.consentId) {
      const consent = await deps.mongo.getConsent(body.consentId);
      if (!consent || !deps.aa || !deps.keys) return reply.status(502).send({ error: "aa_unavailable" });
      const material = await deps.keys.issue();
      const sessionId = await deps.aa.createFiRequest(body.consentId, material.key_material);
      await deps.mongo.saveSession({
        session_id: sessionId,
        consent_id: body.consentId,
        owner_id: consent.owner_id,
        our_nonce: material.our_nonce,
        status: "REQUESTED",
      });
    }
    return { status: "ACK" };
  });

  app.post("/v1/aa/webhook/fi", async (request, reply) => {
    if (!signaturesMatch(request.rawBody ?? "", request.headers["x-aa-signature"] as string | undefined, deps.webhookSecret)) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const body = request.body as { sessionId?: string; sessionStatus?: string };
    if (body.sessionStatus === "COMPLETED" && body.sessionId) {
      const session = await deps.mongo.getSession(body.sessionId);
      if (!session || !deps.aa) return reply.status(502).send({ error: "aa_unavailable" });
      const fetched = await deps.aa.fetchFi(body.sessionId);
      for (const block of fetched.FI ?? []) {
        const inserted = await deps.mongo.insertInbound({
          owner_id: session.owner_id,
          source: "ACCOUNT_AGGREGATOR",
          channel_type: "AA_FI_PAYLOAD",
          payload: {
            consent_id: fetched.consentId ?? session.consent_id,
            session_id: body.sessionId,
            fip_id: block.fipId,
            fi_type: block.fiType,
            encrypted_fi: block.data,
            our_nonce: session.our_nonce,
          },
          idempotency_key: `aa_session:${body.sessionId}:${block.fipId}`,
        });
        await publishRecord(deps.queue, inserted);
      }
    }
    return { status: "ACK" };
  });

  app.post("/v1/internal/apply", async (request, reply) => {
    const body = request.body as { record?: { _id?: string; owner_id?: string }; normalized?: Normalized };
    if (!body?.record?._id || !body.record.owner_id || !body.normalized?.domain) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    const table = await deps.finance.apply(body.record.owner_id, body.record._id, body.normalized);
    if (body.normalized.decrypted_fi) await deps.mongo.setDecrypted(body.record._id, body.normalized.decrypted_fi);
    await deps.mongo.markRouted(body.record._id);
    await refreshSnapshot(deps, body.record.owner_id);
    if (body.normalized.domain === "LEDGER" && deps.queue) {
      // Best-effort follow-on workers: ledger apply already committed; a single enqueue
      // failure must not 500 the apply (Celery would otherwise retry and thrash).
      for (const job of [
        { task: "finance.reconcile", queue: "reconciliation" as const, payload: { owner_id: body.record.owner_id } },
        { task: "human.evaluate", queue: "context" as const, payload: { owner_id: body.record.owner_id } },
        { task: "outcomes.reconcile", queue: "reconciliation" as const, payload: { owner_id: body.record.owner_id } },
      ]) {
        try {
          await deps.queue.enqueue(job);
        } catch (error) {
          request.log?.error?.({ err: error, task: job.task }, "post-apply enqueue failed");
        }
      }
    }
    return { table };
  });

  app.post("/v1/internal/human/pending", async (request, reply) => {
    const ownerId = (request.body as { owner_id?: string } | null)?.owner_id;
    if (!ownerId) return reply.status(400).send({ error: "invalid_request" });
    return deps.finance.pendingHuman(ownerId);
  });

  app.post("/v1/internal/apply-human-context", async (request, reply) => {
    const body = request.body as HumanContextResult | null;
    if (!body?.transaction_id || !body.owner_id || !body.eligibility?.state || !body.eligibility.reason_code) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    try {
      const applied = await deps.finance.applyHumanContext({
        transaction_id: body.transaction_id,
        owner_id: body.owner_id,
        eligibility: body.eligibility,
        inference_run: body.inference_run ?? null,
        weight_associations: body.weight_associations ?? [],
      });
      if (body.eligibility.state === "PROMOTE" && deps.queue) {
        await deps.queue.enqueue({
          task: "decision.evaluate",
          queue: "decisions",
          payload: { owner_id: body.owner_id, transaction_id: body.transaction_id },
        });
      }
      return applied;
    } catch (error) {
      if (error instanceof Error && error.message === "transaction_missing") throw new AuthError(404, "transaction_missing");
      throw error;
    }
  });

  app.post("/v1/internal/decision-eval-context", async (request, reply) => {
    const transactionId = (request.body as { transaction_id?: string } | null)?.transaction_id;
    if (!transactionId) return reply.status(400).send({ error: "invalid_request" });
    const context = await deps.finance.decisionEvalContext(transactionId);
    if (!context) return reply.status(404).send({ error: "transaction_missing" });
    return context;
  });

  app.post("/v1/internal/apply-decision-evaluation", async (request, reply) => {
    const body = request.body as ApplyDecisionInput | null;
    if (!body?.owner_id || !body.transaction_id || !body.top_candidate?.decision_family_code || !body.evaluation_meta?.idempotency_key) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    try {
      const committed = await deps.finance.applyDecisionEvaluation(body);
      await refreshSnapshot(deps, body.owner_id);
      return committed;
    } catch (error) {
      if (error instanceof Error && error.message === "transaction_missing") throw new AuthError(404, "transaction_missing");
      throw error;
    }
  });

  app.post("/v1/internal/forex/reconcile", async (request) => {
    const ownerId = (request.body as { owner_id?: string | null } | null)?.owner_id ?? null;
    return deps.finance.linkForexFees(ownerId);
  });

  app.post("/v1/internal/ingest", async (request, reply) => {
    const body = request.body as { owner_id?: string; source?: "GMAIL" | "PDF_UPLOAD" | "ACCOUNT_AGGREGATOR"; channel_type?: string; payload?: Record<string, unknown>; idempotency_key?: string };
    if (!body?.owner_id || !body.source || !body.channel_type || !body.idempotency_key || !body.payload) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    const record = await deps.mongo.insertInbound({
      owner_id: body.owner_id,
      source: body.source,
      channel_type: body.channel_type,
      payload: body.payload,
      idempotency_key: body.idempotency_key,
    });
    return { record, inserted: record.inserted };
  });

  app.post("/v1/internal/fx", async (request, reply) => {
    const body = request.body as { rate_date?: string; rates?: { quote_code?: string; rate?: string }[] };
    if (!body?.rate_date || !body.rates?.length) return reply.status(400).send({ error: "invalid_request" });
    const rates = body.rates.filter((rate) => rate.quote_code && rate.rate).map((rate) => ({
      base_code: "EUR",
      quote_code: rate.quote_code ?? "",
      rate: rate.rate ?? "",
      source: "ECB",
    }));
    await deps.finance.upsertFx(body.rate_date, rates);
    return { stored: rates.length };
  });

  app.post("/v1/internal/gmail/checkpoint", async (request, reply) => {
    const body = request.body as { owner_id?: string; history_id?: string };
    if (!body?.owner_id || !body.history_id || !/^[0-9]+$/.test(body.history_id)) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    await deps.mongo.setHistoryId(body.owner_id, body.history_id);
    return { ok: true, history_id: body.history_id };
  });

  app.post("/v1/internal/gmail/renew", async () => {
    const renewed: string[] = [];
    if (!deps.gmail?.refresh || !deps.gmail.watch || !deps.gmailTokenKey) return { renewed };
    for (const mailbox of await deps.mongo.listGmail()) {
      const access = await deps.gmail.refresh(unsealCredential(mailbox.sealed, deps.gmailTokenKey));
      const watched = await deps.gmail.watch(access.access_token);
      await deps.mongo.saveWatch(mailbox.owner_id, watched.history_id, watched.expiration);
      renewed.push(mailbox.owner_id);
    }
    return { renewed };
  });

  app.get("/v1/home", async (request, reply) => {
    const ownerId = requireOwner(request, reply);
    const display = headerValue(request.headers["x-display-currency"]) ?? deps.displayCurrency ?? "USD";
    if (deps.snapshots) {
      const cached = await deps.snapshots.get(ownerId);
      if (cached) return cached;
    }
    const snapshot = await buildHome(deps.finance, ownerId, display);
    if (deps.snapshots) await deps.snapshots.put(ownerId, snapshot);
    return snapshot;
  });

  app.post("/v1/internal/route/:id", async (request, reply) => {
    requireOwner(request, reply);
    const id = (request.params as { id: string }).id;
    try {
      const table = await routeRecord(deps.mongo, deps.finance, deps.intelligence, id);
      return { table };
    } catch {
      return reply.status(422).send({ error: "route_failed" });
    }
  });

  app.get("/v1/ui/decisions", async (request) => {
    const ownerId = requireOwner(request, request.server);
    const items = await deps.finance.listDecisions(ownerId);
    return { meta: metaEnvelope(request.id), data: decisionsReadModel(items) };
  });

  app.get("/v1/ui/missions", async (request) => {
    const ownerId = requireOwner(request, request.server);
    const items = await deps.finance.listMissions(ownerId);
    return { meta: metaEnvelope(request.id), data: missionsReadModel(items) };
  });

  app.get("/v1/ui/rewards", async (request) => {
    const ownerId = requireOwner(request, request.server);
    const summary = await deps.finance.rewardsSummary(ownerId);
    return { meta: metaEnvelope(request.id), data: rewardsReadModel(summary) };
  });

  app.get("/v1/ui/journey", async (request) => {
    const ownerId = requireOwner(request, request.server);
    const items = await deps.finance.journeyItems(ownerId);
    return { meta: metaEnvelope(request.id), data: journeyReadModel(items) };
  });

  app.post("/v1/internal/outcomes/pending", async (request) => {
    const ownerId = (request.body as { owner_id?: string | null } | null)?.owner_id ?? null;
    return deps.finance.pendingOutcomeMatches(ownerId);
  });

  app.post("/v1/internal/decisions/sweep-expired", async (request) => {
    const ownerId = (request.body as { owner_id?: string | null } | null)?.owner_id ?? null;
    return deps.finance.sweepExpiredSnoozes(ownerId);
  });

  app.post("/v1/internal/apply-outcomes-mile", async (request, reply) => {
    const body = request.body as ApplyOutcomesMileInput | null;
    if (!body?.owner_id || !body.transaction_id || !body.package?.outcome?.idempotency_key || !body.package?.mile_event?.dedupe_key) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    const applied = await deps.finance.applyOutcomesMile(body);
    await refreshSnapshot(deps, body.owner_id);
    return applied;
  });

  app.post("/v1/decisions/:decisionId/actions", async (request, reply) => {
    const ownerId = requireOwner(request, reply);
    const decisionId = (request.params as { decisionId: string }).decisionId;
    const body = request.body as {
      action?: string;
      remind_at?: string;
      selected_option_id?: string;
    } | null;
    if (!isDecisionAction(body?.action)) return reply.status(400).send({ error: "invalid_request" });
    if (body.action === "SET_REMINDER" && !body.remind_at) {
      return reply.status(400).send({ error: "remind_at_required" });
    }
    const idempotencyKey =
      headerValue(request.headers["idempotency-key"]) ||
      `dec_act:${decisionId}:${body.action}:${new Date().toISOString().slice(0, 10)}`;
    try {
      const data = await deps.finance.applyDecisionAction({
        decision_id: decisionId,
        owner_id: ownerId,
        action: body.action,
        remind_at: body.remind_at ?? null,
        selected_option_id: body.selected_option_id ?? null,
        idempotency_key: idempotencyKey,
      });
      await refreshSnapshot(deps, ownerId);
      return {
        meta: {
          request_id: request.id,
          generated_at: new Date().toISOString(),
          api_version: "v1",
          recompute_status: "COMPLETE",
        },
        data,
      };
    } catch (error) {
      if (error instanceof Error && error.message === "decision_missing") throw new AuthError(404, "decision_missing");
      if (error instanceof Error && error.message === "remind_at_required") {
        return reply.status(400).send({ error: "remind_at_required" });
      }
      throw error;
    }
  });

  app.get("/v1/transactions/:id/context", async (request) => {
    const ownerId = requireOwner(request, request.server);
    const id = (request.params as { id: string }).id;
    const context = await deps.finance.transactionContext(ownerId, id);
    if (!context) throw new AuthError(404, "transaction_missing");
    return context;
  });

  app.post("/v1/transactions/:id/weights", async (request, reply) => {
    const ownerId = requireOwner(request, reply);
    const body = request.body as Partial<WeightFeedbackInput>;
    if (!isWeight(body.weight_code) || !isAction(body.action) || !body.client_idempotency_key) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    if (body.action === "REPLACED" && !isWeight(body.replaced_weight_code)) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    try {
      return await deps.finance.addWeightFeedback(ownerId, (request.params as { id: string }).id, {
        weight_code: body.weight_code,
        action: body.action,
        replaced_weight_code: isWeight(body.replaced_weight_code) ? body.replaced_weight_code : null,
        client_idempotency_key: body.client_idempotency_key,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "transaction_missing") throw new AuthError(404, "transaction_missing");
      throw error;
    }
  });

  app.post("/v1/transactions/:id/mode", async (request, reply) => {
    const ownerId = requireOwner(request, reply);
    const body = request.body as { mode?: string; annotated_via?: string };
    if (!isMode(body.mode)) return reply.status(400).send({ error: "invalid_request" });
    try {
      return await deps.finance.setDecisionMode(ownerId, (request.params as { id: string }).id, body.mode, body.annotated_via || "SCREEN_QUICK_TAG");
    } catch (error) {
      if (error instanceof Error && error.message === "transaction_missing") throw new AuthError(404, "transaction_missing");
      throw error;
    }
  });

  app.post("/v1/transactions/:id/reflections", async (request, reply) => {
    const ownerId = requireOwner(request, reply);
    const body = request.body as Partial<ReflectionInput>;
    if (body.dominant_felt_weight && !isWeight(body.dominant_felt_weight)) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    try {
      return await deps.finance.addReflection(ownerId, (request.params as { id: string }).id, {
        reflection_text: body.reflection_text ?? null,
        weight_feeling: body.weight_feeling ?? null,
        dominant_felt_weight: isWeight(body.dominant_felt_weight) ? body.dominant_felt_weight : null,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "transaction_missing") throw new AuthError(404, "transaction_missing");
      throw error;
    }
  });

  for (const bucket of ["transactions", "due-alerts", "mutual-funds", "investments", "assets", "debts", "insurance"] as const) {
    app.get(`/v1/${bucket}`, async (request, reply) => {
      const ownerId = requireOwner(request, reply);
      return { items: await deps.finance.read(ownerId, bucket) };
    });
  }

  return app;
}

async function finalizeMobileImport(
  deps: BuildDeps,
  sessions: ImportSessionStore,
  importId: string,
  password: string | null,
): Promise<{ status: number; error?: string; ingest_status?: string }> {
  const session = sessions.get(importId);
  if (!session) return { status: 404, error: "not_found" };

  // Allow CSV/text completion without a PDF extractor when raw text was stored as bytes.
  const bytes = await pdfBytes(deps, session.object_key);
  if (!bytes) {
    sessions.update(importId, { stage: "Upload missing", state: "CREATED", parser_eligible: false });
    return { status: 422, error: "unscanned" };
  }
  const blocked = await scanPdf(deps, bytes);
  if (blocked) {
    sessions.update(importId, { state: "FAILED", stage: "FAILED infected", extraction_failure: "infected" });
    return { status: 422, error: blocked };
  }

  let rawText = "";
  if (session.file_type === "CSV" || session.mime.startsWith("text/")) {
    rawText = bytes.toString("utf8");
  } else {
    if (!deps.extractor) return { status: 503, error: "unavailable" };
    try {
      rawText = await deps.extractor.extractPdf(bytes, password ?? undefined);
    } catch (error) {
      if (error instanceof ExtractError) {
        if (error.code === "PASSWORD_REQUIRED") {
          sessions.update(importId, {
            state: "WAITING_PASSWORD",
            stage: "PDF password required",
            parser_eligible: true,
            extraction_failure: "WAITING_FOR_PASSWORD",
          });
          // Mobile polls status then calls /open — complete itself succeeds.
          return { status: 200, ingest_status: "WAITING_FOR_PASSWORD" };
        }
        if (error.code === "PASSWORD_REJECTED") {
          sessions.update(importId, {
            state: "WAITING_PASSWORD",
            stage: "Wrong PDF password",
            parser_eligible: true,
            extraction_failure: "PASSWORD_REJECTED",
          });
          return { status: 422, error: "PASSWORD_REJECTED" };
        }
        if (error.code === "SCANNED_DOCUMENT_OCR_NOT_PERMITTED") {
          sessions.update(importId, {
            state: "FAILED",
            stage: "FAILED SCANNED_DOCUMENT_OCR_NOT_PERMITTED",
            extraction_failure: error.code,
            parser_eligible: false,
          });
          return { status: 422, error: error.code };
        }
      }
      throw error;
    }
  }

  const inserted = await deps.mongo.insertInbound({
    owner_id: session.owner_id,
    source: "PDF_UPLOAD",
    channel_type: "STATEMENT_PDF",
    payload: {
      raw_text: rawText,
      storage_ref: `memory://${session.object_key}`,
      mime_headers: { filename: session.filename },
    },
    idempotency_key: `pdf:${session.import_id}`,
  });
  await publishRecord(deps.queue, inserted);
  sessions.update(importId, {
    state: "QUEUED",
    stage: "Processing",
    parser_eligible: false,
    extraction_failure: null,
    mongo_id: inserted._id,
  });
  return { status: 200, ingest_status: inserted.ingest_status };
}

async function pdfBytes(deps: BuildDeps, key: string): Promise<Buffer | null> {
  const local = deps.objects.get(key);
  if (local) return local;
  if (!deps.storage) return null;
  return deps.storage.getObject(key);
}

async function scanPdf(deps: BuildDeps, bytes: Buffer): Promise<string | null> {
  if (!deps.scanner) return null;
  const verdict = await deps.scanner.scan(bytes);
  return verdict === "CLEAN" ? null : "infected";
}

function isWeight(value: unknown): value is WeightCode {
  return typeof value === "string" && (WEIGHTS as readonly string[]).includes(value);
}

function isAction(value: unknown): value is FeedbackAction {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

function isMode(value: unknown): value is DecisionMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

function isDecisionAction(value: unknown): value is DecisionActionName {
  return typeof value === "string" && (DECISION_ACTIONS as readonly string[]).includes(value);
}

function requireOwner(request: FastifyRequest, _reply: FastifyReply | FastifyInstance): string {
  if (!request.ownerId) throw new AuthError(403, "owner_forbidden");
  return request.ownerId;
}

async function refreshSnapshot(deps: BuildDeps, ownerId: string): Promise<void> {
  if (!deps.snapshots) return;
  await deps.snapshots.put(ownerId, await buildHome(deps.finance, ownerId, deps.displayCurrency ?? "USD"));
}

function bearer(value: string | string[] | undefined): string {
  return typeof value === "string" && value.startsWith("Bearer ") ? value.slice(7) : "";
}

function bearerMatches(value: string | string[] | undefined, expected: string): boolean {
  const token = bearer(value);
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function decodePubSub(body: unknown): { messageId: string; emailAddress: string; historyId: string } | null {
  if (!body || typeof body !== "object") return null;
  const message = (body as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const messageId = (message as { messageId?: unknown }).messageId;
  const data = (message as { data?: unknown }).data;
  if (typeof messageId !== "string" || !messageId || typeof data !== "string" || !data) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== "object") return null;
  const emailAddress = (decoded as { emailAddress?: unknown }).emailAddress;
  const historyValue = (decoded as { historyId?: unknown }).historyId;
  const historyId = typeof historyValue === "number" ? String(historyValue) : historyValue;
  if (typeof emailAddress !== "string" || !emailAddress.includes("@") || typeof historyId !== "string" || !/^[0-9]+$/.test(historyId)) {
    return null;
  }
  return { messageId, emailAddress, historyId };
}

function headerValue(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

declare module "fastify" {
  interface FastifyRequest {
    actorId?: string;
    ownerId?: string;
    rawBody?: string;
  }
}
