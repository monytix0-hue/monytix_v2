-- Reclaim a scan that is still PUBLISHING after its lease.
-- Matches the extraction claim: a one-minute lease, then the same job can be claimed again.
-- record_statement_scan ignores a document that is no longer RECEIVED, and extraction enqueue is deduplicated.
-- Does not edit migrations 0001-0019.

BEGIN;

CREATE OR REPLACE FUNCTION ops.claim_import_scan() RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $fn$
DECLARE
    v_id uuid;
    v_payload jsonb;
BEGIN
    SELECT outbox_event_id, event_payload INTO v_id, v_payload
      FROM ops.outbox_event
     WHERE semantic_trigger_code = 'IMPORT_SESSION_CREATED'
       AND status IN ('PENDING', 'FAILED', 'PUBLISHING')
       AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1;
    IF v_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'empty');
    END IF;
    UPDATE ops.outbox_event
       SET status = 'PUBLISHING',
           attempt_count = attempt_count + 1,
           last_attempt_at = clock_timestamp(),
           next_attempt_at = clock_timestamp() + interval '1 minute'
     WHERE outbox_event_id = v_id;
    RETURN jsonb_build_object('outcome', 'claimed', 'outbox_event_id', v_id, 'payload', v_payload);
END;
$fn$;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M3-19-SCAN-LEASE',
    'Scan claim lease',
    'M2.3-upload',
    'claim-import-scan-publishing-lease',
    'A scan left in PUBLISHING can be claimed again after one minute. The scan record and extraction enqueue stay idempotent.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
