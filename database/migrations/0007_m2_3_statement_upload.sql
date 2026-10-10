-- M2.3B statement upload. Forward only. Does not edit 0001-0006.
-- Bytes stay outside PostgreSQL. No logical transaction is created.

BEGIN;

ALTER TABLE core.source_document DROP CONSTRAINT ck_source_document_status;
ALTER TABLE core.source_document ADD CONSTRAINT ck_source_document_status CHECK (status IN (
    'RECEIVED','PASSWORD_REQUIRED','PROCESSING','AVAILABLE','PARTIAL','FAILED',
    'UNSUPPORTED','ERASED_REFERENCE_ONLY','REJECTED'
));

CREATE OR REPLACE FUNCTION ops.authorize_statement_upload(
    p_actor uuid,
    p_owner uuid,
    p_idempotency_key text,
    p_file_type text,
    p_byte_size bigint,
    p_sha256 text,
    p_filename text,
    p_source_metadata jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ref, ops, pg_temp
AS $fn$
DECLARE
    v_key text;
    v_type text;
    v_hash text;
    v_name text;
    v_existing_hash text;
    v_existing_status text;
    v_existing_body jsonb;
    v_idem uuid;
    v_connection uuid;
    v_batch uuid;
    v_document uuid;
    v_staging text;
    v_source text;
    v_mime text;
    v_expires timestamptz;
    v_body jsonb;
BEGIN
    v_key := btrim(coalesce(p_idempotency_key, ''));
    v_type := upper(btrim(coalesce(p_file_type, '')));
    v_name := btrim(coalesce(p_filename, ''));
    IF p_actor IS NULL OR p_owner IS NULL OR v_key = '' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF v_type NOT IN ('PDF', 'XLS', 'XLSX', 'CSV')
       OR p_byte_size IS NULL OR p_byte_size <= 0 OR p_byte_size > 10485760
       OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
       OR v_name = '' OR length(v_name) > 255 OR v_name ~ '[[:cntrl:]]' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF p_source_metadata IS NOT NULL AND jsonb_typeof(p_source_metadata) <> 'object' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('monytix-import:' || p_owner::text, 0::bigint));
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    v_hash := encode(public.digest(convert_to(concat_ws(E'\n',
        v_type, p_byte_size::text, p_sha256, v_name, coalesce(p_source_metadata::text, '')
    ), 'UTF8'), 'sha256'), 'hex');

    SELECT request_hash, status, response_body, idempotency_record_id
      INTO v_existing_hash, v_existing_status, v_existing_body, v_idem
      FROM ops.idempotency_record
     WHERE scope = 'EXTERNAL_WRITE' AND owner_id = p_owner AND idempotency_key = v_key
     FOR UPDATE;

    IF FOUND THEN
        IF v_existing_hash <> v_hash THEN
            RETURN jsonb_build_object('outcome', 'conflict');
        END IF;
        IF v_existing_status = 'COMPLETED' THEN
            RETURN jsonb_build_object('outcome', 'replay', 'body', v_existing_body);
        END IF;
        RETURN jsonb_build_object('outcome', 'pending', 'idempotency_record_id', v_idem, 'body', v_existing_body);
    END IF;

    v_source := CASE v_type
        WHEN 'PDF' THEN 'BANK_STATEMENT_PDF'
        WHEN 'XLS' THEN 'BANK_STATEMENT_XLS'
        WHEN 'XLSX' THEN 'BANK_STATEMENT_XLSX'
        ELSE 'BANK_STATEMENT_CSV'
    END;
    v_mime := CASE v_type
        WHEN 'PDF' THEN 'application/pdf'
        WHEN 'XLS' THEN 'application/vnd.ms-excel'
        WHEN 'XLSX' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ELSE 'text/csv'
    END;

    SELECT source_connection_id INTO v_connection
      FROM core.source_connection
     WHERE owner_id = p_owner AND connection_type = 'UPLOAD' AND status = 'ACTIVE'
     ORDER BY created_at LIMIT 1 FOR UPDATE;
    IF v_connection IS NULL THEN
        INSERT INTO core.source_connection (owner_id, connection_type, provider_code, status, metadata)
        VALUES (p_owner, 'UPLOAD', 'STATEMENT_UPLOAD', 'ACTIVE', jsonb_build_object('api_source', 'STATEMENT_UPLOAD'))
        RETURNING source_connection_id INTO v_connection;
    END IF;

    INSERT INTO core.source_batch (
        owner_id, uploaded_by_actor_id, source_connection_id, source_type, ingestion_mode, status, metadata
    ) VALUES (
        p_owner, p_actor, v_connection, v_source, 'PUSH', 'REGISTERED', '{}'::jsonb
    ) RETURNING source_batch_id INTO v_batch;

    v_staging := 'owners/' || p_owner::text || '/imports/' || v_batch::text || '/staging';
    v_expires := clock_timestamp() + interval '15 minutes';

    INSERT INTO core.source_document (
        source_batch_id, owner_id, uploaded_by_actor_id, original_filename, declared_mime_type,
        object_reference, status, reason_codes, metadata
    ) VALUES (
        v_batch, p_owner, p_actor, v_name, v_mime,
        v_staging, 'RECEIVED', ARRAY['UPLOAD_AUTHORIZED'],
        jsonb_build_object(
            'file_type', v_type,
            'declared_byte_size', p_byte_size,
            'declared_sha256', p_sha256,
            'staging_key', v_staging,
            'grant_expires_at', v_expires,
            'source_metadata', p_source_metadata,
            'sealed', false
        )
    ) RETURNING source_document_id INTO v_document;

    UPDATE core.source_batch
       SET metadata = jsonb_build_object('import_document_id', v_document, 'file_type', v_type)
     WHERE source_batch_id = v_batch;

    v_body := jsonb_build_object(
        'meta', jsonb_build_object(
            'request_id', ops.uuid_v7(),
            'generated_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'api_version', 'v1.1',
            'ui_state', 'UPLOAD_AUTHORIZED'
        ),
        'data', jsonb_build_object(
            'import_id', v_batch,
            'source_document_id', v_document,
            'object_key', v_staging,
            'file_type', v_type,
            'declared_mime_type', v_mime,
            'upload', jsonb_build_object('expires_at', v_expires)
        )
    );

    INSERT INTO ops.idempotency_record (
        owner_id, actor_id, scope, idempotency_key, request_hash, status, response_body
    ) VALUES (
        p_owner, p_actor, 'EXTERNAL_WRITE', v_key, v_hash, 'IN_PROGRESS', v_body
    ) RETURNING idempotency_record_id INTO v_idem;

    RETURN jsonb_build_object('outcome', 'created', 'idempotency_record_id', v_idem, 'body', v_body);
END;
$fn$;

CREATE OR REPLACE FUNCTION ops.store_upload_grant(
    p_actor uuid,
    p_owner uuid,
    p_idem uuid,
    p_body jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $fn$
BEGIN
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    UPDATE ops.idempotency_record
       SET status = 'COMPLETED', response_code = 201, response_body = p_body, completed_at = clock_timestamp()
     WHERE idempotency_record_id = p_idem AND owner_id = p_owner AND status = 'IN_PROGRESS';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    RETURN jsonb_build_object('outcome', 'created', 'body', p_body);
END;
$fn$;

CREATE OR REPLACE FUNCTION ops.complete_statement_upload(
    p_actor uuid,
    p_owner uuid,
    p_import uuid,
    p_size bigint,
    p_mime text,
    p_sha256 text,
    p_etag text,
    p_final_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $fn$
DECLARE
    v_document uuid;
    v_meta jsonb;
    v_status text;
    v_body jsonb;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('monytix-import-complete:' || p_import::text, 0::bigint));
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    SELECT d.source_document_id, d.metadata, d.status
      INTO v_document, v_meta, v_status
      FROM core.source_document d
      JOIN core.source_batch b ON b.source_batch_id = d.source_batch_id AND b.owner_id = d.owner_id
     WHERE b.source_batch_id = p_import AND d.owner_id = p_owner
     FOR UPDATE OF d;
    IF v_document IS NULL THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF coalesce(v_meta->>'sealed', 'false') = 'true' THEN
        IF v_meta->>'declared_sha256' = p_sha256 THEN
            RETURN jsonb_build_object('outcome', 'replay', 'body', v_meta->'completion_body');
        END IF;
        RETURN jsonb_build_object('outcome', 'conflict');
    END IF;
    IF v_status <> 'RECEIVED'
       OR p_final_key IS DISTINCT FROM ('owners/' || p_owner::text || '/imports/' || p_import::text || '/object')
       OR p_size IS DISTINCT FROM (v_meta->>'declared_byte_size')::bigint
       OR p_sha256 IS DISTINCT FROM v_meta->>'declared_sha256' THEN
        UPDATE core.source_document
           SET status = 'FAILED', reason_codes = ARRAY['UPLOAD_REJECTED']
         WHERE source_document_id = v_document;
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    v_body := jsonb_build_object(
        'meta', jsonb_build_object(
            'request_id', ops.uuid_v7(),
            'generated_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'api_version', 'v1.1',
            'ui_state', 'WRITE_COMMITTED'
        ),
        'data', jsonb_build_object(
            'import_id', p_import,
            'source_document_id', v_document,
            'file_type', v_meta->>'file_type',
            'byte_size', p_size,
            'sha256', p_sha256,
            'upload_status', 'RECEIVED'
        )
    );
    UPDATE core.source_document
       SET content_hash = p_sha256,
           size_bytes = p_size,
           observed_mime_type = p_mime,
           object_reference = p_final_key,
           status = 'RECEIVED',
           reason_codes = ARRAY['MALWARE_SCAN_PENDING'],
           metadata = v_meta || jsonb_build_object('sealed', true, 'etag', p_etag, 'final_key', p_final_key, 'completion_body', v_body)
     WHERE source_document_id = v_document;
    UPDATE core.source_batch SET status = 'COMPLETED' WHERE source_batch_id = p_import;
    INSERT INTO ops.outbox_event (
        owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
    ) VALUES (
        p_owner, 'IMPORT_SESSION_CREATED', 'source_document', v_document,
        jsonb_build_object(
            'import_id', p_import,
            'source_document_id', v_document,
            'object_key', p_final_key,
            'file_type', v_meta->>'file_type',
            'byte_size', p_size,
            'sha256', p_sha256
        ),
        'import-scan:' || p_import::text
    );
    RETURN jsonb_build_object('outcome', 'created', 'body', v_body);
END;
$fn$;

CREATE OR REPLACE FUNCTION ops.fail_statement_upload(
    p_actor uuid,
    p_owner uuid,
    p_import uuid,
    p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $fn$
DECLARE
    v_document uuid;
    v_sealed text;
BEGIN
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    SELECT d.source_document_id, d.metadata->>'sealed'
      INTO v_document, v_sealed
      FROM core.source_document d
     WHERE d.source_batch_id = p_import AND d.owner_id = p_owner
     FOR UPDATE;
    IF v_document IS NULL THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF v_sealed = 'true' THEN
        RETURN jsonb_build_object('outcome', 'replay');
    END IF;
    UPDATE core.source_document
       SET status = 'FAILED', reason_codes = ARRAY[p_reason]
     WHERE source_document_id = v_document;
    UPDATE core.source_batch SET status = 'FAILED' WHERE source_batch_id = p_import;
    RETURN jsonb_build_object('outcome', 'failed');
END;
$fn$;

CREATE OR REPLACE FUNCTION ops.statement_upload_status(
    p_actor uuid,
    p_owner uuid,
    p_import uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $fn$
DECLARE
    v_status text;
    v_reason text;
    v_meta jsonb;
    v_upload text;
BEGIN
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    SELECT d.status, d.reason_codes[1], d.metadata
      INTO v_status, v_reason, v_meta
      FROM core.source_document d
     WHERE d.source_batch_id = p_import AND d.owner_id = p_owner;
    IF v_status IS NULL THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    v_upload := CASE
        WHEN v_status = 'AVAILABLE' THEN 'AVAILABLE'
        WHEN v_status = 'REJECTED' THEN 'REJECTED'
        WHEN v_status = 'FAILED' AND v_reason = 'UPLOAD_EXPIRED' THEN 'EXPIRED'
        WHEN v_status = 'FAILED' THEN 'FAILED'
        WHEN v_reason = 'MALWARE_SCAN_PENDING' THEN 'RECEIVED'
        ELSE 'UPLOAD_AUTHORIZED'
    END;
    RETURN jsonb_build_object(
        'outcome', 'ok',
        'body', jsonb_build_object(
            'meta', jsonb_build_object(
                'request_id', ops.uuid_v7(),
                'generated_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'api_version', 'v1.1'
            ),
            'data', jsonb_build_object(
                'import_id', p_import,
                'upload_status', v_upload,
                'file_type', v_meta->>'file_type',
                'declared_sha256', v_meta->>'declared_sha256',
                'declared_byte_size', v_meta->>'declared_byte_size',
                'sealed', coalesce(v_meta->>'sealed', 'false') = 'true',
                'grant_expires_at', v_meta->>'grant_expires_at',
                'imported_transaction_count', 0,
                'error_code', CASE WHEN v_upload IN ('FAILED', 'REJECTED', 'EXPIRED') THEN v_reason ELSE NULL END,
                'parser_eligible', v_status = 'AVAILABLE'
            )
        )
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION ops.record_statement_scan(
    p_document uuid,
    p_verdict text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $fn$
DECLARE
    v_status text;
    v_key text;
    v_owner uuid;
BEGIN
    SELECT status, object_reference, owner_id INTO v_status, v_key, v_owner
      FROM core.source_document WHERE source_document_id = p_document FOR UPDATE;
    IF v_status IS NULL OR v_status <> 'RECEIVED' THEN
        RETURN jsonb_build_object('outcome', 'ignored', 'object_key', v_key);
    END IF;
    IF p_verdict = 'CLEAN' THEN
        UPDATE core.source_document
           SET status = 'AVAILABLE', reason_codes = ARRAY['SCAN_CLEAN'],
               metadata = metadata || jsonb_build_object('scan_verdict', 'clean')
         WHERE source_document_id = p_document;
        RETURN jsonb_build_object('outcome', 'clean', 'object_key', v_key, 'owner_id', v_owner);
    ELSIF p_verdict = 'INFECTED' THEN
        UPDATE core.source_document
           SET status = 'REJECTED', reason_codes = ARRAY['MALWARE_DETECTED'],
               metadata = metadata || jsonb_build_object('scan_verdict', 'infected', 'object_deleted', false)
         WHERE source_document_id = p_document;
        RETURN jsonb_build_object('outcome', 'infected', 'object_key', v_key, 'owner_id', v_owner);
    ELSE
        UPDATE core.source_document
           SET metadata = metadata || jsonb_build_object('scan_attempts', coalesce((metadata->>'scan_attempts')::int, 0) + 1)
         WHERE source_document_id = p_document;
        RETURN jsonb_build_object('outcome', 'blocked', 'object_key', v_key, 'owner_id', v_owner);
    END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION ops.mark_statement_object_deleted(p_document uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $fn$
BEGIN
    UPDATE core.source_document
       SET metadata = metadata || jsonb_build_object('object_deleted', true)
     WHERE source_document_id = p_document;
END;
$fn$;

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
       AND status IN ('PENDING', 'FAILED')
       AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1;
    IF v_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'empty');
    END IF;
    UPDATE ops.outbox_event
       SET status = 'PUBLISHING', attempt_count = attempt_count + 1, last_attempt_at = clock_timestamp()
     WHERE outbox_event_id = v_id;
    RETURN jsonb_build_object('outcome', 'claimed', 'outbox_event_id', v_id, 'payload', v_payload);
END;
$fn$;

CREATE OR REPLACE FUNCTION ops.finish_import_scan(p_event uuid, p_ok boolean, p_error text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ops, pg_temp
AS $fn$
BEGIN
    IF p_ok THEN
        UPDATE ops.outbox_event
           SET status = 'PUBLISHED', published_at = clock_timestamp(), last_error_code = NULL
         WHERE outbox_event_id = p_event;
    ELSE
        UPDATE ops.outbox_event
           SET status = 'FAILED', last_error_code = 'SCAN_FAILED', last_error_detail = left(coalesce(p_error, ''), 200),
               next_attempt_at = clock_timestamp() + interval '1 minute'
         WHERE outbox_event_id = p_event;
    END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION ops.expire_abandoned_uploads(p_hours integer) RETURNS TABLE(source_document_id uuid, object_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $fn$
BEGIN
    RETURN QUERY
    UPDATE core.source_document d
       SET status = 'FAILED', reason_codes = ARRAY['UPLOAD_EXPIRED']
      FROM core.source_batch b
     WHERE b.source_batch_id = d.source_batch_id
       AND d.status = 'RECEIVED'
       AND 'UPLOAD_AUTHORIZED' = ANY (d.reason_codes)
       AND coalesce(d.metadata->>'sealed', 'false') <> 'true'
       AND d.created_at < clock_timestamp() - make_interval(hours => p_hours)
    RETURNING d.source_document_id, d.object_reference;
END;
$fn$;

CREATE OR REPLACE FUNCTION ops.retention_due_statements(p_days integer) RETURNS TABLE(source_document_id uuid, object_key text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $fn$
    SELECT d.source_document_id, d.object_reference
      FROM core.source_document d
     WHERE d.status = 'AVAILABLE'
       AND d.object_reference IS NOT NULL
       AND coalesce(d.metadata->>'object_deleted', 'false') <> 'true'
       AND (d.metadata->>'processing_completed_at') IS NOT NULL
       AND (d.metadata->>'processing_completed_at')::timestamptz < clock_timestamp() - make_interval(days => p_days);
$fn$;

REVOKE ALL ON FUNCTION ops.authorize_statement_upload(uuid, uuid, text, text, bigint, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.store_upload_grant(uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.complete_statement_upload(uuid, uuid, uuid, bigint, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.fail_statement_upload(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.statement_upload_status(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.record_statement_scan(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.mark_statement_object_deleted(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.claim_import_scan() FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.finish_import_scan(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.expire_abandoned_uploads(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.retention_due_statements(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION ops.authorize_statement_upload(uuid, uuid, text, text, bigint, text, text, jsonb) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.store_upload_grant(uuid, uuid, uuid, jsonb) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.complete_statement_upload(uuid, uuid, uuid, bigint, text, text, text, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.fail_statement_upload(uuid, uuid, uuid, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.statement_upload_status(uuid, uuid, uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.record_statement_scan(uuid, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.mark_statement_object_deleted(uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.claim_import_scan() TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.finish_import_scan(uuid, boolean, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.expire_abandoned_uploads(integer) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.retention_due_statements(integer) TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M2-3-UPLOAD',
    'Statement upload authorization and verification',
    'D10 v1.2 FINAL FREEZE',
    'f9h-089-v1.1',
    'SECURITY DEFINER upload. R2 is the approved provider. Production credentials are not in this migration.'
)
ON CONFLICT (migration_code) DO UPDATE
SET notes = EXCLUDED.notes;

COMMIT;
