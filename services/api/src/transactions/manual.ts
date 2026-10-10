import pg from "pg";

export type ManualCreateInput = {
  actorId: string;
  ownerId: string;
  financialAccountId: string;
  idempotencyKey: string;
  amountText: string;
  currency: string;
  direction: "IN" | "OUT";
  occurredAt: string;
  merchantDescription: string;
  categoryCode: string;
  subcategoryCode: string;
  userSelectedWeights: string[] | null;
};

export type ManualCreateResult = {
  outcome: "created" | "replay" | "conflict" | "forbidden" | "invalid";
  body?: unknown;
};

export type ManualTransactionStore = {
  create(input: ManualCreateInput): Promise<ManualCreateResult>;
  close(): Promise<void>;
};

export function createManualTransactionStore(databaseUrl: string): ManualTransactionStore {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });

  return {
    async create(input) {
      const result = await pool.query<{ result: ManualCreateResult }>(
        `SELECT ops.create_manual_transaction(
           $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
         ) AS result`,
        [
          input.actorId,
          input.ownerId,
          input.financialAccountId,
          input.idempotencyKey,
          input.amountText,
          input.currency,
          input.direction,
          input.occurredAt,
          input.merchantDescription,
          input.categoryCode,
          input.subcategoryCode,
          input.userSelectedWeights === null ? null : JSON.stringify(input.userSelectedWeights),
        ],
      );
      const row = result.rows[0]?.result;
      if (!row || typeof row.outcome !== "string") {
        throw new Error("manual transaction function returned no outcome");
      }
      return row;
    },

    async close() {
      await pool.end();
    },
  };
}
