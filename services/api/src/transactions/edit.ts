import { openPool } from "../db/pool.js";
import {
  interpretFinancialEvent,
  publishTransactionStructure,
  resolveFinancialUse,
  resolveTransactionParty,
} from "../imports/interpret.js";

export type CorrectionInput = {
  actorId: string;
  ownerId: string;
  logicalTransactionId: string;
  idempotencyKey: string;
  expectedVersionId: string | null;
  amount: string | null;
  direction: "IN" | "OUT" | null;
  occurredAt: string | null;
  description: string | null;
  categoryCode: string | null;
  subcategoryCode: string | null;
  weightCode: string | null;
};

export type CorrectionBody = {
  logical_transaction_id: string;
  canonical_transaction_version_id: string;
  superseded_version_id: string;
  version_no: number;
  amount: string;
  direction: string;
  occurred_at: string | null;
  description: string | null;
  category_code: string | null;
  subcategory_code: string | null;
  weight_code: string | null;
};

export type CorrectionResult = {
  outcome: "updated" | "replay" | "conflict" | "stale" | "missing" | "forbidden" | "invalid" | "incomplete";
  body?: CorrectionBody;
};

export type DeleteInput = {
  actorId: string;
  ownerId: string;
  logicalTransactionId: string;
  idempotencyKey: string;
};

export type DeleteResult = {
  outcome: "deleted" | "replay" | "conflict" | "missing" | "forbidden" | "invalid";
  body?: { logical_transaction_id: string };
};

export type TransactionEditStore = {
  correct(input: CorrectionInput): Promise<CorrectionResult>;
  remove(input: DeleteInput): Promise<DeleteResult>;
  close(): Promise<void>;
};

export function createTransactionEditStore(databaseUrl: string): TransactionEditStore {
  const pool = openPool(databaseUrl);

  return {
    async correct(input) {
      const result = await pool.query<{ result: CorrectionResult }>(
        `SELECT ops.correct_transaction(
           $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7, $8, $9, $10, $11, $12
         ) AS result`,
        [
          input.actorId,
          input.ownerId,
          input.logicalTransactionId,
          input.idempotencyKey,
          input.expectedVersionId,
          input.amount,
          input.direction,
          input.occurredAt,
          input.description,
          input.categoryCode,
          input.subcategoryCode,
          input.weightCode,
        ],
      );
      const row = result.rows[0]?.result;
      if (!row || typeof row.outcome !== "string") {
        throw new Error("correct_transaction returned no outcome");
      }
      // A new canonical version changes the structure, the event family, the
      // category resolution and the weight, so every read layer is rebuilt.
      if (row.outcome === "updated" || row.outcome === "replay") {
        await publishTransactionStructure(pool, input.actorId, input.ownerId, input.logicalTransactionId);
        await interpretFinancialEvent(pool, input.actorId, input.ownerId, input.logicalTransactionId);
        await resolveFinancialUse(pool, input.actorId, input.ownerId, input.logicalTransactionId);
        await resolveTransactionParty(pool, input.actorId, input.ownerId, input.logicalTransactionId);
        await pool.query("SELECT ops.record_movement_weight($1::uuid)", [input.logicalTransactionId]);
      }
      return row;
    },

    async remove(input) {
      const result = await pool.query<{ result: DeleteResult }>(
        "SELECT ops.delete_transaction($1::uuid, $2::uuid, $3::uuid, $4) AS result",
        [input.actorId, input.ownerId, input.logicalTransactionId, input.idempotencyKey],
      );
      const row = result.rows[0]?.result;
      if (!row || typeof row.outcome !== "string") {
        throw new Error("delete_transaction returned no outcome");
      }
      return row;
    },

    async close() {
      await pool.end();
    },
  };
}
