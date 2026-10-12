import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { openPool } from "../src/db/pool.js";

const apiUrl = process.env.M2_TEST_DATABASE_URL;
const adminUrl = process.env.M2_TEST_ADMIN_URL;

test("a replaced database connection can be used again", async (t) => {
  if (!apiUrl || !adminUrl) {
    t.skip("local Postgres 17 is not configured");
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  const pool = openPool(apiUrl, 1);
  await admin.connect();
  try {
    const client = await pool.connect();
    const pid = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    client.release();
    await admin.query("SELECT pg_terminate_backend($1)", [pid.rows[0]!.pid]);
    let recovered = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const row = await pool.query<{ ok: number }>("SELECT 1 AS ok");
        recovered = row.rows[0]?.ok === 1;
        if (recovered) {
          break;
        }
      } catch {
        recovered = false;
      }
    }
    assert.equal(recovered, true);
  } finally {
    await pool.end();
    await admin.end();
  }
});

test("a scan left in progress can be claimed again only after its lease", async (t) => {
  if (!apiUrl || !adminUrl) {
    t.skip("local Postgres 17 is not configured");
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  const api = new pg.Client({ connectionString: apiUrl });
  await admin.connect();
  await api.connect();
  const stamp = Date.now().toString();
  try {
    const owner = await admin.query<{ owner_id: string }>(
      "INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1) RETURNING owner_id",
      [`scan-lease-${stamp}`],
    );
    const ownerId = owner.rows[0]!.owner_id;
    const held = await admin.query<{ outbox_event_id: string }>(
      `INSERT INTO ops.outbox_event (
         owner_id, semantic_trigger_code, aggregate_type, event_payload, dedupe_key, status, next_attempt_at
       ) VALUES (
         $1, 'IMPORT_SESSION_CREATED', 'source_document', '{"source_document_id":"held"}'::jsonb, $2, 'PUBLISHING',
         clock_timestamp() + interval '10 minutes'
       ) RETURNING outbox_event_id`,
      [ownerId, `held-${stamp}`],
    );
    const due = await admin.query<{ outbox_event_id: string }>(
      `INSERT INTO ops.outbox_event (
         owner_id, semantic_trigger_code, aggregate_type, event_payload, dedupe_key, status, next_attempt_at, created_at
       ) VALUES (
         $1, 'IMPORT_SESSION_CREATED', 'source_document', '{"source_document_id":"due"}'::jsonb, $2, 'PUBLISHING',
         clock_timestamp() - interval '1 minute', clock_timestamp() - interval '1 day'
       ) RETURNING outbox_event_id`,
      [ownerId, `due-${stamp}`],
    );
    const heldId = held.rows[0]!.outbox_event_id;
    const dueId = due.rows[0]!.outbox_event_id;
    const claimed: string[] = [];
    for (let attempt = 0; attempt < 30 && !claimed.includes(dueId); attempt += 1) {
      const result = await api.query<{ result: { outcome: string; outbox_event_id?: string } }>("SELECT ops.claim_import_scan() AS result");
      const id = result.rows[0]?.result.outbox_event_id;
      if (!id) {
        break;
      }
      claimed.push(id);
      if (id !== dueId) {
        await admin.query(
          `UPDATE ops.outbox_event
              SET status = 'PENDING', next_attempt_at = NULL
            WHERE outbox_event_id = $1`,
          [id],
        );
      }
    }
    assert.equal(claimed.includes(heldId), false);
    assert.equal(claimed.includes(dueId), true);
    const lease = await admin.query<{ status: string; waiting: boolean }>(
      `SELECT status, next_attempt_at > clock_timestamp() AS waiting
         FROM ops.outbox_event WHERE outbox_event_id = $1`,
      [dueId],
    );
    assert.equal(lease.rows[0]?.status, "PUBLISHING");
    assert.equal(lease.rows[0]?.waiting, true);
    const again = await api.query<{ result: { outbox_event_id?: string } }>("SELECT ops.claim_import_scan() AS result");
    assert.notEqual(again.rows[0]?.result.outbox_event_id, dueId);
    if (again.rows[0]?.result.outbox_event_id) {
      await admin.query(
        "UPDATE ops.outbox_event SET status = 'PENDING', next_attempt_at = NULL WHERE outbox_event_id = $1",
        [again.rows[0].result.outbox_event_id],
      );
    }
  } finally {
    await api.end();
    await admin.end();
  }
});
