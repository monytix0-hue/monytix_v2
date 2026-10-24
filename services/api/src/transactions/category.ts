import { openPool } from "../db/pool.js";

export type CategoryMatchScope = "EXACT_MERCHANT" | "RAW_TOKEN";

export type CategoryChoiceInput = {
  actorId: string;
  ownerId: string;
  logicalTransactionId: string;
  categoryId: string;
  applyToPast: boolean;
  matchScope: CategoryMatchScope;
  subcategoryId: string | null;
};

export type CategoryChoiceBody = {
  updated_transaction: { id: string; category_id: string; counterparty: string };
  rule_created: { match_token: string; category_id: string };
  retroactive_count: number;
};

export type CategoryChoiceResult = {
  outcome: "updated" | "missing" | "invalid_category" | "forbidden" | "invalid";
  body?: CategoryChoiceBody;
};

export type CategoryChoiceStore = {
  set(input: CategoryChoiceInput): Promise<CategoryChoiceResult>;
  close(): Promise<void>;
};

export function createCategoryChoiceStore(databaseUrl: string): CategoryChoiceStore {
  const pool = openPool(databaseUrl);
  return {
    async set(input) {
      const result = await pool.query<{ result: CategoryChoiceResult }>(
        "SELECT ops.set_transaction_category($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7) AS result",
        [
          input.actorId,
          input.ownerId,
          input.logicalTransactionId,
          input.categoryId,
          input.applyToPast,
          input.matchScope,
          input.subcategoryId,
        ],
      );
      return result.rows[0]?.result ?? { outcome: "invalid" };
    },
    async close() {
      await pool.end();
    },
  };
}
