import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

/**
 * The worker promotes an alert into the ledger only when the save RPC hands back
 * its id:
 *
 *     const spotId = saved.rows[0]?.result?.gmail_spot_transaction_id;
 *     if (spotId) { ... ops.promote_gmail_spot(spotId) ... }
 *
 * 0056 rewrote save_gmail_spot_transaction and dropped that key while still
 * reporting `outcome: "created"`, so every alert after 2026-10-28 was saved and
 * silently left out of the ledger. No test noticed, because the existing
 * integration tests only assert on `outcome`. These assertions close that gap:
 * they pin the contract the worker actually depends on, not the one the RPC
 * happens to report.
 */

const databaseUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;

type SaveResult = {
  outcome: string;
  gmail_spot_transaction_id?: string;
};

const SAVE = `SELECT ops.save_gmail_spot_transaction(
  $1::uuid, $2::uuid, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11::timestamptz, $12,
  $13, $14, $15::numeric, $16::numeric, $17
) AS result`;

test("a saved alert returns its spot id and promotes into the ledger", async (t) => {
  if (!databaseUrl || !adminUrl) {
    t.skip("local Postgres 17 is not configured");
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const key = `hash:${stamp.padStart(64, "0").slice(-64)}`;

  try {
    const ownerId = (
      await admin.query<{ owner_id: string }>(
        `INSERT INTO core.owner (owner_type, display_name)
         VALUES ('PERSON', $1) RETURNING owner_id`,
        [`spot-${stamp}`],
      )
    ).rows[0]!.owner_id;

    const sourceId = (
      await admin.query<{ source_connection_id: string }>(
        `INSERT INTO core.source_connection (owner_id, connection_type, status)
         VALUES ($1, 'EMAIL', 'ACTIVE') RETURNING source_connection_id`,
        [ownerId],
      )
    ).rows[0]!.source_connection_id;

    const connectionId = (
      await admin.query<{ gmail_connection_id: string }>(
        `INSERT INTO core.gmail_connection (
           owner_id, source_connection_id, mailbox_address, oauth_state, credential_ref
         ) VALUES ($1, $2, $3, 'AUTHORIZED', 'env:GMAIL_CREDENTIAL')
         RETURNING gmail_connection_id`,
        [ownerId, sourceId, `spot-${stamp}@example.test`],
      )
    ).rows[0]!.gmail_connection_id;

    const save = async (): Promise<SaveResult> =>
      (
        await admin.query<{ result: SaveResult }>(SAVE, [
          ownerId,
          connectionId,
          `msg-${stamp}`,
          key,
          "DEBIT",
          "1499.00",
          "4321",
          "REF123456",
          "UPI",
          "Test Merchant",
          null,
          "probe excerpt",
          "INR",
          "EXPLICIT_ISO",
          0.95,
          null,
          null,
        ])
      ).rows[0]!.result;

    const created = await save();
    assert.equal(created.outcome, "created", "first save creates the spot");
    assert.equal(
      typeof created.gmail_spot_transaction_id,
      "string",
      "created must carry the spot id, or the worker cannot promote it",
    );
    const spotId = created.gmail_spot_transaction_id!;

    // The worker treats a replay as promotable too, so a second delivery of the
    // same message must report the same id rather than omitting it. Resolving the
    // existing row is what lets an already-stranded spot self-heal on re-poll.
    const replayed = await save();
    assert.equal(replayed.outcome, "replay", "second save replays");
    assert.equal(
      replayed.gmail_spot_transaction_id,
      spotId,
      "replay must report the row that already exists",
    );

    // An invalid call is the one outcome that legitimately carries no id.
    const invalid = (
      await admin.query<{ result: SaveResult }>(SAVE, [
        ownerId,
        connectionId,
        `msg-bad-${stamp}`,
        key,
        "SIDEWAYS",
        "1.00",
        null,
        null,
        "UPI",
        "Test Merchant",
        null,
        "",
        "INR",
        null,
        null,
        null,
        null,
      ])
    ).rows[0]!.result;
    assert.equal(invalid.outcome, "invalid");
    assert.equal(invalid.gmail_spot_transaction_id, undefined);

    // Promotion must consume exactly that id and link the spot to a logical row.
    const promoted = (
      await admin.query<{ promote_gmail_spot: string | null }>(
        "SELECT ops.promote_gmail_spot($1::uuid)",
        [spotId],
      )
    ).rows[0]!.promote_gmail_spot;
    assert.equal(typeof promoted, "string", "promotion returns the logical id");

    const linked = await admin.query<{ logical_transaction_id: string | null }>(
      "SELECT logical_transaction_id FROM core.gmail_spot_transaction WHERE gmail_spot_transaction_id = $1",
      [spotId],
    );
    assert.equal(linked.rows[0]?.logical_transaction_id, promoted, "the spot is now linked");

    // Promotion is idempotent: the worker may re-poll and promote again.
    const again = (
      await admin.query<{ promote_gmail_spot: string | null }>(
        "SELECT ops.promote_gmail_spot($1::uuid)",
        [spotId],
      )
    ).rows[0]!.promote_gmail_spot;
    assert.equal(again, promoted, "a second promotion returns the same logical id");
  } finally {
    // Leave no rows behind. core.owner cascades through the connection and spot.
    await admin.query("DELETE FROM core.gmail_connection WHERE owner_id = $1", [
      (
        await admin.query<{ owner_id: string }>(
          "SELECT owner_id FROM core.owner WHERE display_name = $1",
          [`spot-${stamp}`],
        )
      ).rows[0]?.owner_id ?? "00000000-0000-0000-0000-000000000000",
    ]);
    await admin.query("DELETE FROM core.owner WHERE display_name = $1", [`spot-${stamp}`]);
    await admin.end();
  }
});
