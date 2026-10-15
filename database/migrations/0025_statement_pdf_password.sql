-- Ephemeral PDF password handoff.
-- The password is never stored. A failed password attempt can be discarded
-- so a later correct password can create the extraction run.

BEGIN;

CREATE OR REPLACE FUNCTION ops.statement_open_target(
    p_actor uuid,
    p_owner uuid,
    p_import uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $target$
DECLARE
    v_doc uuid;
    v_status text;
    v_reasons text[];
    v_meta jsonb;
    v_hash text;
    v_key text;
BEGIN
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    SELECT d.source_document_id, d.status, d.reason_codes, d.metadata, d.content_hash, d.object_reference
      INTO v_doc, v_status, v_reasons, v_meta, v_hash, v_key
      FROM core.source_document d
     WHERE d.source_batch_id = p_import AND d.owner_id = p_owner;
    IF v_doc IS NULL THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF v_status IS DISTINCT FROM 'AVAILABLE'
       OR NOT ('SCAN_CLEAN' = ANY (COALESCE(v_reasons, ARRAY[]::text[])))
       OR coalesce(v_meta->>'sealed', 'false') <> 'true'
       OR v_hash IS NULL
       OR v_key IS NULL THEN
        RETURN jsonb_build_object('outcome', 'ineligible');
    END IF;
    RETURN jsonb_build_object(
        'outcome', 'ok',
        'source_document_id', v_doc,
        'object_key', v_key,
        'sha256', v_hash,
        'file_type', v_meta->>'file_type'
    );
END;
$target$;

CREATE OR REPLACE FUNCTION ops.discard_password_rejected_extraction(p_document uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $discard$
DECLARE
    v_run uuid;
BEGIN
    SELECT extraction_run_id INTO v_run
      FROM core.extraction_run
     WHERE source_document_id = p_document
       AND status = 'FAILED'
       AND reason_codes = ARRAY['PASSWORD_REJECTED']::text[]
     ORDER BY run_no DESC
     LIMIT 1;
    IF v_run IS NULL THEN
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM core.source_record WHERE extraction_run_id = v_run) THEN
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM core.canonical_transaction_version WHERE extraction_run_id = v_run) THEN
        RETURN;
    END IF;
    DELETE FROM core.extraction_run WHERE extraction_run_id = v_run;
END;
$discard$;

REVOKE ALL ON FUNCTION ops.statement_open_target(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.discard_password_rejected_extraction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.statement_open_target(uuid, uuid, uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.discard_password_rejected_extraction(uuid) TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M2-9-PDF-PASSWORD',
    'Open a sealed statement with an ephemeral PDF password',
    'D10 v1.2 FINAL FREEZE',
    'M2.9-v1',
    'The password is not written to source_document, extraction_run, or logs. A PASSWORD_REJECTED run with no rows can be discarded.'
)
ON CONFLICT (migration_code) DO UPDATE SET notes = EXCLUDED.notes;

COMMIT;
