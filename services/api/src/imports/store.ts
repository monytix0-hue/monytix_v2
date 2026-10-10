import pg from "pg";
import type { ObjectStorage } from "./storage.js";

export type ImportStore = {
  authorize(input: AuthorizeInput): Promise<ImportResult>;
  saveGrant(input: { actorId: string; ownerId: string; idempotencyRecordId: string; body: unknown }): Promise<ImportResult>;
  complete(input: CompleteInput): Promise<ImportResult>;
  fail(input: { actorId: string; ownerId: string; importId: string; reason: string }): Promise<void>;
  status(input: { actorId: string; ownerId: string; importId: string }): Promise<ImportResult>;
  reviewQueue(input: { actorId: string; ownerId: string; importId: string; sourceRecordId: string | null }): Promise<ImportResult>;
  resolveReview(input: ReviewInput): Promise<ImportResult>;
  finalize(input: { actorId: string; ownerId: string; importId: string; idempotencyKey: string }): Promise<ImportResult>;
  close(): Promise<void>;
};

export type AuthorizeInput = {
  actorId: string;
  ownerId: string;
  idempotencyKey: string;
  fileType: string;
  byteSize: number;
  sha256: string;
  filename: string;
  sourceMetadata: Record<string, unknown> | null;
};

export type CompleteInput = {
  actorId: string;
  ownerId: string;
  importId: string;
  size: number;
  mime: string;
  sha256: string;
  etag: string;
  finalKey: string;
};

export type ReviewInput = {
  actorId: string;
  ownerId: string;
  importId: string;
  sourceRecordId: string;
  action: string;
  reviewVersion: number;
  financialAccountId: string | null;
  logicalTransactionId: string | null;
  idempotencyKey: string;
};

export type ImportResult = {
  outcome: string;
  body?: Record<string, unknown>;
  idempotency_record_id?: string;
  items?: unknown;
  review_count?: number;
  pending_count?: number;
};

export function createImportStore(databaseUrl: string): ImportStore {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  return {
    async authorize(input) {
      const result = await pool.query<{ result: ImportResult }>(
        `SELECT ops.authorize_statement_upload($1::uuid,$2::uuid,$3,$4,$5::bigint,$6,$7,$8::jsonb) AS result`,
        [
          input.actorId,
          input.ownerId,
          input.idempotencyKey,
          input.fileType,
          input.byteSize,
          input.sha256,
          input.filename,
          input.sourceMetadata === null ? null : JSON.stringify(input.sourceMetadata),
        ],
      );
      return required(result.rows[0]?.result);
    },
    async saveGrant(input) {
      const result = await pool.query<{ result: ImportResult }>(
        `SELECT ops.store_upload_grant($1::uuid,$2::uuid,$3::uuid,$4::jsonb) AS result`,
        [input.actorId, input.ownerId, input.idempotencyRecordId, JSON.stringify(input.body)],
      );
      return required(result.rows[0]?.result);
    },
    async complete(input) {
      const result = await pool.query<{ result: ImportResult }>(
        `SELECT ops.complete_statement_upload($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5,$6,$7,$8) AS result`,
        [input.actorId, input.ownerId, input.importId, input.size, input.mime, input.sha256, input.etag, input.finalKey],
      );
      return required(result.rows[0]?.result);
    },
    async fail(input) {
      await pool.query(
        `SELECT ops.fail_statement_upload($1::uuid,$2::uuid,$3::uuid,$4)`,
        [input.actorId, input.ownerId, input.importId, input.reason],
      );
    },
    async status(input) {
      const result = await pool.query<{ result: ImportResult }>(
        `SELECT ops.statement_upload_status($1::uuid,$2::uuid,$3::uuid) AS result`,
        [input.actorId, input.ownerId, input.importId],
      );
      const status = required(result.rows[0]?.result);
      const summary = await pool.query<{ result: Record<string, unknown> }>(
        `SELECT ops.statement_import_summary($1::uuid,$2::uuid,$3::uuid) AS result`,
        [input.ownerId, input.actorId, input.importId],
      );
      const reconciliation = summary.rows[0]?.result;
      if (status.outcome === "ok" && status.body && reconciliation?.outcome === "ok") {
        const data = status.body.data as Record<string, unknown>;
        status.body = {
          ...status.body,
          data: {
            ...data,
            imported_transaction_count: reconciliation.mapped_count,
            reconciliation,
          },
        };
      }
      return status;
    },
    async reviewQueue(input) {
      const result = await pool.query<{ result: ImportResult & { items?: unknown } }>(
        `SELECT ops.statement_review_queue($1::uuid,$2::uuid,$3::uuid,$4::uuid) AS result`,
        [input.actorId, input.ownerId, input.importId, input.sourceRecordId],
      );
      return required(result.rows[0]?.result);
    },
    async resolveReview(input) {
      const result = await pool.query<{ result: ImportResult }>(
        `SELECT ops.resolve_statement_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::int,$7::uuid,$8::uuid,$9) AS result`,
        [
          input.actorId,
          input.ownerId,
          input.importId,
          input.sourceRecordId,
          input.action,
          input.reviewVersion,
          input.financialAccountId,
          input.logicalTransactionId,
          input.idempotencyKey,
        ],
      );
      return required(result.rows[0]?.result);
    },
    async finalize(input) {
      const result = await pool.query<{ result: ImportResult }>(
        `SELECT ops.finalize_statement_import($1::uuid,$2::uuid,$3::uuid,$4) AS result`,
        [input.actorId, input.ownerId, input.importId, input.idempotencyKey],
      );
      return required(result.rows[0]?.result);
    },
    async close() {
      await pool.end();
    },
  };
}

export function finalObjectKey(ownerId: string, importId: string): string {
  return `owners/${ownerId}/imports/${importId}/object`;
}

export type UploadVerifier = {
  storage: ObjectStorage;
  store: ImportStore;
};

function required(value: ImportResult | undefined): ImportResult {
  if (!value || typeof value.outcome !== "string") {
    throw new Error("statement upload function returned no outcome");
  }
  return value;
}
