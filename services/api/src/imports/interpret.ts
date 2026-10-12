import type pg from "pg";

type Queryable = Pick<pg.Pool, "query">;

export async function publishTransactionStructure(
  db: Queryable,
  actorId: string,
  ownerId: string,
  logicalTransactionId: string,
): Promise<void> {
  await db.query("SELECT ops.publish_transaction_structure($1::uuid, $2::uuid, $3::uuid, NULL)", [
    actorId,
    ownerId,
    logicalTransactionId,
  ]);
}

export async function interpretFinancialEvent(
  db: Queryable,
  actorId: string,
  ownerId: string,
  logicalTransactionId: string,
): Promise<void> {
  await db.query("SELECT ops.interpret_financial_event($1::uuid, $2::uuid, $3::uuid, NULL)", [
    actorId,
    ownerId,
    logicalTransactionId,
  ]);
}

export async function resolveTransactionParty(
  db: Queryable,
  actorId: string,
  ownerId: string,
  logicalTransactionId: string,
): Promise<void> {
  await db.query("SELECT ops.resolve_transaction_party($1::uuid, $2::uuid, $3::uuid, NULL)", [
    actorId,
    ownerId,
    logicalTransactionId,
  ]);
}

export async function resolveFinancialUse(
  db: Queryable,
  actorId: string,
  ownerId: string,
  logicalTransactionId: string,
): Promise<void> {
  await db.query("SELECT ops.resolve_financial_use($1::uuid, $2::uuid, $3::uuid, NULL)", [
    actorId,
    ownerId,
    logicalTransactionId,
  ]);
}
