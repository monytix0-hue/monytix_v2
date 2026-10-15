-- M2.8 statement account binding.
-- Forward only. Does not edit migrations 0001-0011.
-- One import binds at most one owned account. Matching stays M2.6-v1.
-- Historical canonical rows are not rewritten.

BEGIN;

ALTER TABLE core.canonical_transaction_version
    ADD COLUMN IF NOT EXISTS strong_identity_guard boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN core.canonical_transaction_version.strong_identity_guard IS
    'False on rows that existed before M2.8 so historical duplicates stay. New inserts are guarded.';

CREATE OR REPLACE FUNCTION core.mark_strong_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = core, pg_temp
AS $guard_insert$
BEGIN
    NEW.strong_identity_guard := true;
    RETURN NEW;
END;
$guard_insert$;

DROP TRIGGER IF EXISTS trg_mark_strong_identity_guard ON core.canonical_transaction_version;
CREATE TRIGGER trg_mark_strong_identity_guard
BEFORE INSERT ON core.canonical_transaction_version
FOR EACH ROW EXECUTE FUNCTION core.mark_strong_identity_guard();

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_guarded_strong_identity
    ON core.canonical_transaction_version (
        financial_account_id, amount, direction, currency_code, transaction_date, source_reference
    )
    WHERE is_current = true
      AND normalization_status = 'READY'
      AND source_reference IS NOT NULL
      AND strong_identity_guard = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_statement_instance_resolved_document
    ON core.statement_instance (source_document_id)
    WHERE account_resolution_status = 'RESOLVED'
      AND financial_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION core.guard_statement_account_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = core, pg_temp
AS $guard_bind$
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.financial_account_id IS NOT NULL
       AND NEW.financial_account_id IS DISTINCT FROM OLD.financial_account_id
       AND EXISTS (
            SELECT 1
              FROM core.source_record_disposition d
              JOIN core.source_record s ON s.source_record_id = d.source_record_id
              JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
             WHERE er.source_document_id = OLD.source_document_id
               AND d.outcome IN ('MAPPED', 'LINKED_EXISTING')
       ) THEN
        RAISE EXCEPTION 'statement account is already committed'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$guard_bind$;

DROP TRIGGER IF EXISTS trg_statement_account_rebind ON core.statement_instance;
CREATE TRIGGER trg_statement_account_rebind
BEFORE UPDATE OF financial_account_id ON core.statement_instance
FOR EACH ROW EXECUTE FUNCTION core.guard_statement_account_binding();

CREATE OR REPLACE FUNCTION ops.decide_statement_identity(
    p_account uuid,
    p_amount numeric,
    p_direction text,
    p_currency char(3),
    p_date date,
    p_reference text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $decide$
DECLARE
    v_reference text := NULLIF(btrim(coalesce(p_reference, '')), '');
    v_logical uuid;
    v_version uuid;
BEGIN
    IF p_account IS NULL OR p_amount IS NULL OR p_direction IS NULL OR p_currency IS NULL OR p_date IS NULL THEN
        RETURN jsonb_build_object('decision', 'review', 'reason', 'IDENTITY_INCOMPLETE');
    END IF;
    IF v_reference IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('monytix-ref:' || p_account::text || ':' || v_reference, 0));
        PERFORM pg_advisory_xact_lock(hashtextextended(
            'monytix-strong:' || p_account::text || ':' || p_amount::text || ':' || p_direction || ':' || p_currency || ':' || p_date::text || ':' || v_reference,
            0
        ));
        SELECT logical_transaction_id, canonical_transaction_version_id
          INTO v_logical, v_version
          FROM core.canonical_transaction_version
         WHERE financial_account_id = p_account
           AND amount = p_amount
           AND direction = p_direction
           AND currency_code = p_currency
           AND transaction_date = p_date
           AND source_reference = v_reference
           AND normalization_status = 'READY'
           AND is_current = true
         ORDER BY created_at
         LIMIT 1;
        IF v_logical IS NOT NULL THEN
            RETURN jsonb_build_object(
                'decision', 'link',
                'logical_transaction_id', v_logical,
                'canonical_transaction_version_id', v_version
            );
        END IF;
        IF EXISTS (
            SELECT 1 FROM core.canonical_transaction_version
             WHERE financial_account_id = p_account
               AND source_reference = v_reference
               AND normalization_status = 'READY'
               AND is_current = true
        ) THEN
            RETURN jsonb_build_object('decision', 'review', 'reason', 'CONFLICTING_REFERENCE');
        END IF;
        RETURN jsonb_build_object('decision', 'create');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'monytix-weak:' || p_account::text || ':' || p_amount::text || ':' || p_direction || ':' || p_date::text,
        0
    ));
    IF EXISTS (
        SELECT 1 FROM core.canonical_transaction_version
         WHERE financial_account_id = p_account
           AND amount = p_amount
           AND direction = p_direction
           AND transaction_date = p_date
           AND normalization_status = 'READY'
           AND is_current = true
    ) THEN
        RETURN jsonb_build_object('decision', 'review', 'reason', 'WEAK_MATCH');
    END IF;
    RETURN jsonb_build_object('decision', 'create');
END;
$decide$;

CREATE OR REPLACE FUNCTION ops.bind_statement_account(
    p_document uuid,
    p_owner uuid,
    p_account uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $bind$
DECLARE
    v_currency char(3);
    v_existing uuid;
    v_existing_account uuid;
    v_count integer;
BEGIN
    IF p_document IS NULL OR p_account IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('monytix-bind:' || p_document::text, 0));
    SELECT base_currency_code INTO v_currency
      FROM core.financial_account
     WHERE financial_account_id = p_account AND lifecycle_status = 'ACTIVE';
    IF v_currency IS NULL OR NOT EXISTS (
        SELECT 1 FROM core.account_ownership
         WHERE owner_id = p_owner AND financial_account_id = p_account
           AND relationship_status = 'ACTIVE' AND verification_state <> 'REVOKED'
    ) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    SELECT count(*)::int INTO v_count
      FROM core.statement_instance
     WHERE source_document_id = p_document
       AND account_resolution_status = 'RESOLVED'
       AND financial_account_id IS NOT NULL;
    IF v_count > 1 THEN
        RETURN jsonb_build_object('outcome', 'account_bound');
    END IF;
    IF v_count = 1 THEN
        SELECT financial_account_id INTO v_existing_account
          FROM core.statement_instance
         WHERE source_document_id = p_document
           AND account_resolution_status = 'RESOLVED'
           AND financial_account_id IS NOT NULL;
        IF v_existing_account = p_account THEN
            RETURN jsonb_build_object('outcome', 'already_bound', 'currency', v_currency);
        END IF;
        RETURN jsonb_build_object('outcome', 'account_bound');
    END IF;
    SELECT count(*)::int INTO v_count
      FROM core.statement_instance
     WHERE source_document_id = p_document;
    IF v_count > 1 THEN
        RETURN jsonb_build_object('outcome', 'account_bound');
    END IF;
    SELECT statement_instance_id INTO v_existing
      FROM core.statement_instance
     WHERE source_document_id = p_document
     FOR UPDATE;
    IF v_existing IS NULL THEN
        INSERT INTO core.statement_instance (
            source_document_id, financial_account_id, currency_code,
            account_resolution_status, statement_status, metadata
        ) VALUES (
            p_document, p_account, v_currency, 'RESOLVED', 'PARTIAL',
            jsonb_build_object('binding_version', 'M2.8-v1', 'bound_by', 'review_select_account')
        );
    ELSE
        UPDATE core.statement_instance
           SET financial_account_id = p_account,
               currency_code = v_currency,
               account_resolution_status = 'RESOLVED',
               metadata = metadata || jsonb_build_object('binding_version', 'M2.8-v1', 'bound_by', 'review_select_account')
         WHERE statement_instance_id = v_existing;
    END IF;
    RETURN jsonb_build_object('outcome', 'bound', 'currency', v_currency);
END;
$bind$;

CREATE OR REPLACE FUNCTION ops.statement_strong_duplicate_report()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, pg_temp
AS $report$
    SELECT coalesce(jsonb_agg(row_to_json(d)::jsonb), '[]'::jsonb)
      FROM (
        SELECT financial_account_id,
               amount,
               direction,
               currency_code,
               transaction_date,
               source_reference,
               count(*)::int AS duplicate_count,
               jsonb_agg(logical_transaction_id ORDER BY created_at) AS logical_transaction_ids
          FROM core.canonical_transaction_version
         WHERE is_current = true
           AND normalization_status = 'READY'
           AND source_reference IS NOT NULL
         GROUP BY financial_account_id, amount, direction, currency_code, transaction_date, source_reference
        HAVING count(*) > 1
      ) d;
$report$;


CREATE OR REPLACE FUNCTION ops.authorize_statement_upload(
    p_actor uuid,
    p_owner uuid,
    p_idempotency_key text,
    p_file_type text,
    p_byte_size bigint,
    p_sha256 text,
    p_filename text,
    p_source_metadata jsonb,
    p_financial_account uuid
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
    v_currency char(3);
    v_material text;
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
    IF p_financial_account IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM core.financial_account fa
          JOIN core.account_ownership ao ON ao.financial_account_id = fa.financial_account_id
         WHERE fa.financial_account_id = p_financial_account
           AND fa.lifecycle_status = 'ACTIVE'
           AND ao.owner_id = p_owner
           AND ao.relationship_status = 'ACTIVE'
           AND ao.verification_state <> 'REVOKED'
    ) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    v_material := concat_ws(E'\n',
        v_type, p_byte_size::text, p_sha256, v_name, coalesce(p_source_metadata::text, '')
    );
    IF p_financial_account IS NOT NULL THEN
        v_material := v_material || E'\n' || p_financial_account::text;
    END IF;
    v_hash := encode(public.digest(convert_to(v_material, 'UTF8'), 'sha256'), 'hex');

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

    IF p_financial_account IS NOT NULL THEN
        SELECT base_currency_code INTO v_currency
          FROM core.financial_account
         WHERE financial_account_id = p_financial_account;
        INSERT INTO core.statement_instance (
            source_document_id, financial_account_id, currency_code,
            account_resolution_status, statement_status, metadata
        ) VALUES (
            v_document, p_financial_account, v_currency,
            'RESOLVED', 'PARTIAL',
            jsonb_build_object('binding_version', 'M2.8-v1', 'bound_by', 'import_initiation')
        );
    END IF;

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
            'financial_account_id', p_financial_account,
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

CREATE OR REPLACE FUNCTION ops.map_statement_extraction(p_run uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $map$
DECLARE
    v_version constant text := 'M2.6-v1';
    v_document uuid;
    v_owner uuid;
    v_batch uuid;
    v_doc_status text;
    v_reasons text[];
    v_meta jsonb;
    v_hash text;
    v_run_status text;
    v_run_reasons text[];
    v_account uuid;
    v_account_count integer;
    v_statement_currency char(3);
    v_currency char(3);
    v_lifecycle text;
    v_owned boolean;
    v_rec core.source_record%ROWTYPE;
    v_existing uuid;
    v_amount numeric(20,4);
    v_date date;
    v_direction text;
    v_reference text;
    v_row_reasons text[];
    v_logical uuid;
    v_version_id uuid;
    v_match_logical uuid;
    v_match_version uuid;
    v_mapped integer := 0;
    v_linked integer := 0;
    v_review integer := 0;
    v_rejected integer := 0;
    v_replay integer := 0;
    v_decision jsonb;
BEGIN
    SELECT er.source_document_id, er.status, er.reason_codes, sd.owner_id, sd.source_batch_id,
           sd.status, sd.reason_codes, sd.metadata, sd.content_hash
      INTO v_document, v_run_status, v_run_reasons, v_owner, v_batch,
           v_doc_status, v_reasons, v_meta, v_hash
      FROM core.extraction_run er
      JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
     WHERE er.extraction_run_id = p_run;
    IF v_document IS NULL
       OR v_run_status NOT IN ('COMPLETED', 'PARTIAL')
       OR 'UNSUPPORTED_FILE_LAYOUT' = ANY (COALESCE(v_run_reasons, ARRAY[]::text[]))
       OR v_doc_status IS DISTINCT FROM 'AVAILABLE'
       OR NOT ('SCAN_CLEAN' = ANY (COALESCE(v_reasons, ARRAY[]::text[])))
       OR coalesce(v_meta->>'sealed', 'false') <> 'true'
       OR v_hash IS NULL THEN
        RETURN jsonb_build_object('outcome', 'ineligible');
    END IF;

    SELECT count(*)::int INTO v_account_count
      FROM core.statement_instance
     WHERE source_document_id = v_document
       AND account_resolution_status = 'RESOLVED'
       AND financial_account_id IS NOT NULL;
    IF v_account_count = 1 THEN
        SELECT financial_account_id, currency_code
          INTO v_account, v_statement_currency
          FROM core.statement_instance
         WHERE source_document_id = v_document
           AND account_resolution_status = 'RESOLVED'
           AND financial_account_id IS NOT NULL;
        SELECT lifecycle_status, base_currency_code INTO v_lifecycle, v_currency
          FROM core.financial_account WHERE financial_account_id = v_account;
        SELECT EXISTS (
            SELECT 1 FROM core.account_ownership
             WHERE owner_id = v_owner
               AND financial_account_id = v_account
               AND relationship_status = 'ACTIVE'
               AND verification_state <> 'REVOKED'
        ) INTO v_owned;
    END IF;

    FOR v_rec IN
        SELECT * FROM core.source_record
         WHERE extraction_run_id = p_run
           AND record_status IN ('TRANSACTION_CANDIDATE', 'EXTRACTION_PARTIAL')
         ORDER BY extraction_sequence
    LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended('monytix-map:' || v_rec.source_record_id::text, 0::bigint));
        SELECT source_record_disposition_id INTO v_existing
          FROM core.source_record_disposition
         WHERE source_record_id = v_rec.source_record_id
         ORDER BY created_at
         LIMIT 1;
        IF v_existing IS NOT NULL THEN
            v_replay := v_replay + 1;
            CONTINUE;
        END IF;

        v_row_reasons := ARRAY[]::text[];
        v_amount := NULL;
        v_date := NULL;
        v_direction := upper(coalesce(v_rec.raw_record_payload->>'direction', ''));
        v_reference := NULLIF(btrim(coalesce(v_rec.raw_reference, '')), '');

        IF v_rec.raw_amount IS NULL OR btrim(v_rec.raw_amount) !~ '^[0-9]+(\.[0-9]{1,4})?$' THEN
            INSERT INTO core.source_record_disposition (source_record_id, mapping_version, outcome, reason_codes)
            VALUES (v_rec.source_record_id, v_version, 'REJECTED', ARRAY['INVALID_AMOUNT']);
            v_rejected := v_rejected + 1;
            CONTINUE;
        END IF;
        v_amount := btrim(v_rec.raw_amount)::numeric(20,4);
        IF v_amount <= 0 THEN
            INSERT INTO core.source_record_disposition (source_record_id, mapping_version, outcome, reason_codes)
            VALUES (v_rec.source_record_id, v_version, 'REJECTED', ARRAY['INVALID_AMOUNT']);
            v_rejected := v_rejected + 1;
            CONTINUE;
        END IF;

        IF v_rec.raw_transaction_date IS NULL OR btrim(v_rec.raw_transaction_date) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            INSERT INTO core.source_record_disposition (source_record_id, mapping_version, outcome, reason_codes)
            VALUES (v_rec.source_record_id, v_version, 'REVIEW_REQUIRED', ARRAY['DATE_MISSING']);
            v_review := v_review + 1;
            CONTINUE;
        END IF;
        BEGIN
            v_date := btrim(v_rec.raw_transaction_date)::date;
            IF to_char(v_date, 'YYYY-MM-DD') IS DISTINCT FROM btrim(v_rec.raw_transaction_date) THEN
                v_date := NULL;
            END IF;
        EXCEPTION WHEN others THEN
            v_date := NULL;
        END;
        IF v_date IS NULL THEN
            INSERT INTO core.source_record_disposition (source_record_id, mapping_version, outcome, reason_codes)
            VALUES (v_rec.source_record_id, v_version, 'REVIEW_REQUIRED', ARRAY['DATE_INVALID']);
            v_review := v_review + 1;
            CONTINUE;
        END IF;

        IF v_direction = 'REV' THEN
            INSERT INTO core.source_record_disposition (source_record_id, mapping_version, outcome, reason_codes)
            VALUES (v_rec.source_record_id, v_version, 'REVIEW_REQUIRED', ARRAY['REVERSAL_UNRESOLVED']);
            v_review := v_review + 1;
            CONTINUE;
        END IF;
        IF v_direction NOT IN ('IN', 'OUT') THEN
            INSERT INTO core.source_record_disposition (source_record_id, mapping_version, outcome, reason_codes)
            VALUES (v_rec.source_record_id, v_version, 'REVIEW_REQUIRED', ARRAY['DIRECTION_UNKNOWN']);
            v_review := v_review + 1;
            CONTINUE;
        END IF;

        IF v_account_count IS DISTINCT FROM 1 OR v_owned IS NOT TRUE OR v_lifecycle IS DISTINCT FROM 'ACTIVE' THEN
            INSERT INTO core.source_record_disposition (source_record_id, mapping_version, outcome, reason_codes)
            VALUES (v_rec.source_record_id, v_version, 'REVIEW_REQUIRED', ARRAY[
                CASE
                    WHEN v_account_count > 1 THEN 'ACCOUNT_AMBIGUOUS'
                    WHEN v_owned IS NOT TRUE AND v_account_count = 1 THEN 'ACCOUNT_OWNER_MISMATCH'
                    WHEN v_lifecycle IS DISTINCT FROM 'ACTIVE' AND v_account_count = 1 THEN 'ACCOUNT_INELIGIBLE'
                    ELSE 'ACCOUNT_UNRESOLVED'
                END
            ]);
            v_review := v_review + 1;
            CONTINUE;
        END IF;

        v_currency := v_statement_currency;
        IF v_currency IS NULL THEN
            SELECT base_currency_code INTO v_currency
              FROM core.financial_account WHERE financial_account_id = v_account;
            v_row_reasons := array_append(v_row_reasons, 'ACCOUNT_BASE_CURRENCY');
        END IF;
        IF v_currency IS NULL THEN
            INSERT INTO core.source_record_disposition (source_record_id, mapping_version, outcome, reason_codes)
            VALUES (v_rec.source_record_id, v_version, 'REVIEW_REQUIRED', ARRAY['CURRENCY_MISSING']);
            v_review := v_review + 1;
            CONTINUE;
        END IF;

        v_decision := ops.decide_statement_identity(v_account, v_amount, v_direction, v_currency, v_date, v_reference);
        v_match_logical := NULL;
        v_match_version := NULL;
        IF v_decision->>'decision' = 'review' THEN
            INSERT INTO core.source_record_disposition (source_record_id, mapping_version, outcome, reason_codes)
            VALUES (v_rec.source_record_id, v_version, 'REVIEW_REQUIRED', ARRAY[v_decision->>'reason']);
            v_review := v_review + 1;
            CONTINUE;
        ELSIF v_decision->>'decision' = 'link' THEN
            v_match_logical := (v_decision->>'logical_transaction_id')::uuid;
            v_match_version := (v_decision->>'canonical_transaction_version_id')::uuid;
        END IF;

        IF v_match_logical IS NOT NULL THEN
            INSERT INTO core.transaction_evidence_link (
                logical_transaction_id, source_record_id, canonical_transaction_version_id,
                relationship_type, identity_confidence, identity_reason_codes, is_primary_observation
            ) VALUES (
                v_match_logical, v_rec.source_record_id, v_match_version,
                'EQUIVALENT_OBSERVATION', 1, ARRAY['SOURCE_REFERENCE_MATCH'], false
            );
            INSERT INTO core.source_record_disposition (
                source_record_id, mapping_version, outcome, reason_codes, logical_transaction_id, canonical_transaction_version_id
            ) VALUES (
                v_rec.source_record_id, v_version, 'LINKED_EXISTING', ARRAY['SOURCE_REFERENCE_MATCH'], v_match_logical, v_match_version
            );
            INSERT INTO ops.outbox_event (
                owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
            ) VALUES (
                v_owner, 'STATEMENT_OBSERVATION_LINKED', 'logical_transaction', v_match_logical,
                jsonb_build_object('logical_transaction_id', v_match_logical, 'source_record_id', v_rec.source_record_id),
                'statement-link:' || v_rec.source_record_id::text
            );
            v_linked := v_linked + 1;
            CONTINUE;
        END IF;

        INSERT INTO core.logical_transaction (financial_account_id)
        VALUES (v_account)
        RETURNING logical_transaction_id INTO v_logical;
        INSERT INTO core.canonical_transaction_version (
            logical_transaction_id, version_no, is_current,
            source_record_id, extraction_run_id, source_batch_id, financial_account_id,
            transaction_date, amount, direction, currency_code,
            raw_description, normalized_description, source_reference,
            extraction_sequence, normalization_status, normalization_confidence,
            normalization_reason_codes, normalization_version, change_provenance, duplicate_outcome,
            reversal_indicator
        ) VALUES (
            v_logical, 1, false,
            v_rec.source_record_id, p_run, v_batch, v_account,
            v_date, v_amount, v_direction, v_currency,
            v_rec.raw_description, v_rec.raw_record_payload->>'normalized_description', v_reference,
            v_rec.extraction_sequence, 'READY', 0,
            v_row_reasons || ARRAY['STATEMENT_EXTRACTION'],
            v_version, 'INITIAL', 'DISTINCT',
            false
        ) RETURNING canonical_transaction_version_id INTO v_version_id;
        PERFORM core.activate_canonical_transaction_version(v_version_id, NULL);
        INSERT INTO core.transaction_evidence_link (
            logical_transaction_id, source_record_id, canonical_transaction_version_id,
            relationship_type, identity_confidence, identity_reason_codes, is_primary_observation
        ) VALUES (
            v_logical, v_rec.source_record_id, v_version_id,
            'PRIMARY_VERSION_SOURCE', 1, ARRAY['STATEMENT_EXTRACTION'], true
        );
        INSERT INTO core.source_record_disposition (
            source_record_id, mapping_version, outcome, reason_codes, logical_transaction_id, canonical_transaction_version_id
        ) VALUES (
            v_rec.source_record_id, v_version, 'MAPPED', v_row_reasons || ARRAY['STATEMENT_EXTRACTION'], v_logical, v_version_id
        );
        INSERT INTO ops.outbox_event (
            owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
        ) VALUES (
            v_owner, 'TRANSACTION_CREATED', 'logical_transaction', v_logical,
            jsonb_build_object(
                'logical_transaction_id', v_logical,
                'canonical_transaction_version_id', v_version_id,
                'source_record_id', v_rec.source_record_id,
                'direction', v_direction,
                'mapping_version', v_version
            ),
            'statement-map:' || v_rec.source_record_id::text
        );
        v_mapped := v_mapped + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'outcome', CASE WHEN v_replay > 0 AND v_mapped = 0 AND v_linked = 0 AND v_review = 0 AND v_rejected = 0 THEN 'replay' ELSE 'mapped' END,
        'mapped', v_mapped, 'linked', v_linked, 'review', v_review, 'rejected', v_rejected, 'replay', v_replay
    );
END;
$map$;

CREATE OR REPLACE FUNCTION ops.resolve_statement_review(
    p_actor uuid,
    p_owner uuid,
    p_import uuid,
    p_source_record uuid,
    p_action text,
    p_review_version integer,
    p_account uuid,
    p_logical uuid,
    p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $resolve$
DECLARE
    v_owner uuid;
    v_batch uuid;
    v_run uuid;
    v_sequence integer;
    v_description text;
    v_normalized text;
    v_amount_text text;
    v_date_text text;
    v_direction text;
    v_reference text;
    v_disp_id uuid;
    v_outcome text;
    v_reasons text[];
    v_version integer;
    v_amount numeric(20,4);
    v_date date;
    v_currency char(3);
    v_account uuid;
    v_fields_ok boolean := false;
    v_hash text;
    v_existing_hash text;
    v_existing_status text;
    v_existing_body jsonb;
    v_idem uuid;
    v_logical uuid;
    v_version_id uuid;
    v_target_account uuid;
    v_target_amount numeric(20,4);
    v_target_direction text;
    v_target_currency char(3);
    v_target_date date;
    v_body jsonb;
    v_new_version integer;
    v_document uuid;
    v_decision jsonb;
    v_bind jsonb;
BEGIN
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_action NOT IN ('select_account', 'confirm_new', 'link_existing', 'reject') THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    SELECT sd.owner_id, sd.source_batch_id, sd.source_document_id, er.extraction_run_id, s.extraction_sequence,
           s.raw_description, s.raw_record_payload->>'normalized_description', s.raw_amount,
           s.raw_transaction_date, upper(coalesce(s.raw_record_payload->>'direction', '')),
           NULLIF(btrim(coalesce(s.raw_reference, '')), '')
      INTO v_owner, v_batch, v_document, v_run, v_sequence, v_description, v_normalized, v_amount_text,
           v_date_text, v_direction, v_reference
      FROM core.source_record s
      JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
      JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
     WHERE s.source_record_id = p_source_record;
    IF v_owner IS NULL OR v_owner <> p_owner OR v_batch <> p_import THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT source_record_disposition_id, outcome, reason_codes, review_version
      INTO v_disp_id, v_outcome, v_reasons, v_version
      FROM core.source_record_disposition
     WHERE source_record_id = p_source_record
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;
    IF v_disp_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    v_hash := encode(public.digest(convert_to(concat_ws(E'\n',
        p_source_record::text, p_action, p_review_version::text,
        coalesce(p_account::text, ''), coalesce(p_logical::text, '')
    ), 'UTF8'), 'sha256'), 'hex');
    SELECT request_hash, status, response_body
      INTO v_existing_hash, v_existing_status, v_existing_body
      FROM ops.idempotency_record
     WHERE scope = 'EXTERNAL_WRITE' AND owner_id = p_owner AND idempotency_key = p_idempotency_key
     FOR UPDATE;
    IF FOUND THEN
        IF v_existing_status = 'COMPLETED' AND v_existing_hash = v_hash THEN
            RETURN jsonb_build_object('outcome', 'replay', 'body', v_existing_body);
        END IF;
        RETURN jsonb_build_object('outcome', 'conflict');
    END IF;
    IF v_version IS DISTINCT FROM p_review_version THEN
        RETURN jsonb_build_object('outcome', 'stale');
    END IF;
    IF v_outcome IS DISTINCT FROM 'REVIEW_REQUIRED' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    IF v_amount_text IS NOT NULL AND btrim(v_amount_text) ~ '^[0-9]+(\.[0-9]{1,4})?$' THEN
        v_amount := btrim(v_amount_text)::numeric(20,4);
    END IF;
    IF v_date_text IS NOT NULL AND btrim(v_date_text) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        BEGIN
            v_date := btrim(v_date_text)::date;
            IF to_char(v_date, 'YYYY-MM-DD') IS DISTINCT FROM btrim(v_date_text) THEN
                v_date := NULL;
            END IF;
        EXCEPTION WHEN others THEN
            v_date := NULL;
        END;
    END IF;
    v_fields_ok := v_amount IS NOT NULL AND v_amount > 0 AND v_date IS NOT NULL AND v_direction IN ('IN', 'OUT');

    IF p_action = 'reject' THEN
        NULL;
    ELSIF NOT v_fields_ok THEN
        RETURN jsonb_build_object('outcome', 'unresolved');
    ELSIF p_action = 'select_account' THEN
        IF NOT ('ACCOUNT_UNRESOLVED' = ANY (v_reasons) OR 'ACCOUNT_AMBIGUOUS' = ANY (v_reasons)) OR p_account IS NULL THEN
            RETURN jsonb_build_object('outcome', 'invalid');
        END IF;
        SELECT base_currency_code INTO v_currency
          FROM core.financial_account
         WHERE financial_account_id = p_account AND lifecycle_status = 'ACTIVE';
        IF v_currency IS NULL OR NOT EXISTS (
            SELECT 1 FROM core.account_ownership
             WHERE owner_id = p_owner AND financial_account_id = p_account
               AND relationship_status = 'ACTIVE' AND verification_state <> 'REVOKED'
        ) THEN
            RETURN jsonb_build_object('outcome', 'forbidden');
        END IF;
        v_bind := ops.bind_statement_account(v_document, p_owner, p_account);
        IF v_bind->>'outcome' = 'forbidden' THEN
            RETURN jsonb_build_object('outcome', 'forbidden');
        END IF;
        IF v_bind->>'outcome' IS DISTINCT FROM 'bound' AND v_bind->>'outcome' IS DISTINCT FROM 'already_bound' THEN
            RETURN jsonb_build_object('outcome', 'account_bound');
        END IF;
        v_account := p_account;
        v_currency := v_bind->>'currency';
    ELSIF p_action = 'confirm_new' THEN
        IF 'CONFLICTING_REFERENCE' = ANY (v_reasons) THEN
            RETURN jsonb_build_object('outcome', 'invalid');
        END IF;
        SELECT financial_account_id, currency_code INTO v_account, v_currency
          FROM core.statement_instance
         WHERE source_document_id = (
             SELECT source_document_id FROM core.extraction_run WHERE extraction_run_id = v_run
         )
           AND account_resolution_status = 'RESOLVED'
           AND financial_account_id IS NOT NULL;
        IF v_account IS NULL OR NOT EXISTS (
            SELECT 1 FROM core.account_ownership
             WHERE owner_id = p_owner AND financial_account_id = v_account
               AND relationship_status = 'ACTIVE' AND verification_state <> 'REVOKED'
        ) THEN
            RETURN jsonb_build_object('outcome', 'unresolved');
        END IF;
        IF v_currency IS NULL THEN
            SELECT base_currency_code INTO v_currency FROM core.financial_account WHERE financial_account_id = v_account;
        END IF;
    ELSIF p_action = 'link_existing' THEN
        SELECT financial_account_id, amount, direction, currency_code, transaction_date, canonical_transaction_version_id
          INTO v_target_account, v_target_amount, v_target_direction, v_target_currency, v_target_date, v_version_id
          FROM core.canonical_transaction_version
         WHERE logical_transaction_id = p_logical AND is_current = true AND normalization_status = 'READY';
        IF v_target_account IS NULL OR NOT EXISTS (
            SELECT 1 FROM core.account_ownership
             WHERE owner_id = p_owner AND financial_account_id = v_target_account
               AND relationship_status = 'ACTIVE' AND verification_state <> 'REVOKED'
        ) THEN
            RETURN jsonb_build_object('outcome', 'forbidden');
        END IF;
        SELECT coalesce(si.currency_code, fa.base_currency_code) INTO v_currency
          FROM core.extraction_run er
          LEFT JOIN core.statement_instance si
            ON si.source_document_id = er.source_document_id
           AND si.account_resolution_status = 'RESOLVED'
          LEFT JOIN core.financial_account fa ON fa.financial_account_id = si.financial_account_id
         WHERE er.extraction_run_id = v_run
         LIMIT 1;
        IF v_target_amount IS DISTINCT FROM v_amount
           OR v_target_direction IS DISTINCT FROM v_direction
           OR v_target_currency IS DISTINCT FROM v_currency
           OR v_target_date IS DISTINCT FROM v_date THEN
            RETURN jsonb_build_object('outcome', 'unresolved');
        END IF;
        v_logical := p_logical;
    END IF;

    INSERT INTO ops.idempotency_record (owner_id, actor_id, scope, idempotency_key, request_hash, status)
    VALUES (p_owner, p_actor, 'EXTERNAL_WRITE', p_idempotency_key, v_hash, 'IN_PROGRESS')
    RETURNING idempotency_record_id INTO v_idem;

    IF p_action = 'reject' THEN
        UPDATE core.source_record_disposition
           SET outcome = 'REJECTED', reason_codes = ARRAY['REVIEW_REJECTED'],
               review_version = review_version + 1, resolved_by_actor_id = p_actor
         WHERE source_record_disposition_id = v_disp_id
         RETURNING review_version INTO v_new_version;
        v_body := jsonb_build_object('source_record_id', p_source_record, 'outcome', 'REJECTED', 'review_version', v_new_version);
    ELSIF p_action = 'link_existing' THEN
        INSERT INTO core.transaction_evidence_link (
            logical_transaction_id, source_record_id, canonical_transaction_version_id,
            relationship_type, identity_confidence, identity_reason_codes, is_primary_observation
        ) VALUES (
            v_logical, p_source_record, v_version_id,
            'EQUIVALENT_OBSERVATION', 1, ARRAY['REVIEWER_LINK'], false
        );
        UPDATE core.source_record_disposition
           SET outcome = 'LINKED_EXISTING', reason_codes = ARRAY['REVIEWER_LINK'],
               logical_transaction_id = v_logical, canonical_transaction_version_id = v_version_id,
               review_version = review_version + 1, resolved_by_actor_id = p_actor
         WHERE source_record_disposition_id = v_disp_id
         RETURNING review_version INTO v_new_version;
        v_body := jsonb_build_object(
            'source_record_id', p_source_record, 'outcome', 'LINKED_EXISTING',
            'logical_transaction_id', v_logical, 'review_version', v_new_version
        );
    ELSE
        v_decision := ops.decide_statement_identity(v_account, v_amount, v_direction, v_currency, v_date, v_reference);
        IF v_decision->>'decision' = 'review' THEN
            UPDATE core.source_record_disposition
               SET reason_codes = ARRAY[v_decision->>'reason'],
                   review_version = review_version + 1,
                   resolved_by_actor_id = p_actor
             WHERE source_record_disposition_id = v_disp_id
             RETURNING review_version INTO v_new_version;
            v_body := jsonb_build_object(
                'source_record_id', p_source_record,
                'outcome', 'REVIEW_REQUIRED',
                'reason_codes', jsonb_build_array(v_decision->>'reason'),
                'review_version', v_new_version
            );
        ELSIF v_decision->>'decision' = 'link' THEN
            v_logical := (v_decision->>'logical_transaction_id')::uuid;
            v_version_id := (v_decision->>'canonical_transaction_version_id')::uuid;
            INSERT INTO core.transaction_evidence_link (
                logical_transaction_id, source_record_id, canonical_transaction_version_id,
                relationship_type, identity_confidence, identity_reason_codes, is_primary_observation
            ) VALUES (
                v_logical, p_source_record, v_version_id,
                'EQUIVALENT_OBSERVATION', 1, ARRAY['SOURCE_REFERENCE_MATCH'], false
            );
            UPDATE core.source_record_disposition
               SET outcome = 'LINKED_EXISTING', reason_codes = ARRAY['SOURCE_REFERENCE_MATCH'],
                   logical_transaction_id = v_logical, canonical_transaction_version_id = v_version_id,
                   review_version = review_version + 1, resolved_by_actor_id = p_actor
             WHERE source_record_disposition_id = v_disp_id
             RETURNING review_version INTO v_new_version;
            INSERT INTO ops.outbox_event (
                owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
            ) VALUES (
                p_owner, 'STATEMENT_OBSERVATION_LINKED', 'logical_transaction', v_logical,
                jsonb_build_object('logical_transaction_id', v_logical, 'source_record_id', p_source_record, 'action', p_action),
                'statement-review-link:' || p_source_record::text
            );
            v_body := jsonb_build_object(
                'source_record_id', p_source_record, 'outcome', 'LINKED_EXISTING',
                'logical_transaction_id', v_logical, 'review_version', v_new_version
            );
        ELSE
        INSERT INTO core.logical_transaction (financial_account_id) VALUES (v_account) RETURNING logical_transaction_id INTO v_logical;
        INSERT INTO core.canonical_transaction_version (
            logical_transaction_id, version_no, is_current,
            source_record_id, extraction_run_id, source_batch_id, financial_account_id,
            transaction_date, amount, direction, currency_code,
            raw_description, normalized_description, source_reference,
            extraction_sequence, normalization_status, normalization_confidence,
            normalization_reason_codes, normalization_version, change_provenance, duplicate_outcome,
            reversal_indicator
        ) VALUES (
            v_logical, 1, false,
            p_source_record, v_run, v_batch, v_account,
            v_date, v_amount, v_direction, v_currency,
            v_description, v_normalized, v_reference,
            v_sequence, 'READY', 0,
            ARRAY['STATEMENT_REVIEW'], 'M2.6-v1', 'REVIEWER_CORRECTION', 'DISTINCT', false
        ) RETURNING canonical_transaction_version_id INTO v_version_id;
        PERFORM core.activate_canonical_transaction_version(v_version_id, NULL);
        INSERT INTO core.transaction_evidence_link (
            logical_transaction_id, source_record_id, canonical_transaction_version_id,
            relationship_type, identity_confidence, identity_reason_codes, is_primary_observation
        ) VALUES (
            v_logical, p_source_record, v_version_id, 'PRIMARY_VERSION_SOURCE', 1, ARRAY['STATEMENT_REVIEW'], true
        );
        UPDATE core.source_record_disposition
           SET outcome = 'MAPPED', reason_codes = ARRAY['STATEMENT_REVIEW'],
               logical_transaction_id = v_logical, canonical_transaction_version_id = v_version_id,
               review_version = review_version + 1, resolved_by_actor_id = p_actor
         WHERE source_record_disposition_id = v_disp_id
         RETURNING review_version INTO v_new_version;
        INSERT INTO ops.outbox_event (
            owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
        ) VALUES (
            p_owner, 'TRANSACTION_CREATED', 'logical_transaction', v_logical,
            jsonb_build_object('logical_transaction_id', v_logical, 'source_record_id', p_source_record, 'action', p_action),
            'statement-review-create:' || p_source_record::text
        );
        v_body := jsonb_build_object(
            'source_record_id', p_source_record, 'outcome', 'MAPPED',
            'logical_transaction_id', v_logical, 'review_version', v_new_version
        );
        END IF;
    END IF;

    IF COALESCE(v_body->>'outcome', '') <> 'REVIEW_REQUIRED' THEN
    INSERT INTO ops.outbox_event (
        owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
    ) VALUES (
        p_owner, 'STATEMENT_REVIEW_RESOLVED', 'source_record', p_source_record,
        jsonb_build_object('source_record_id', p_source_record, 'action', p_action, 'outcome', v_body->>'outcome'),
        'statement-review:' || p_source_record::text || ':' || v_new_version::text
    );
    END IF;
    UPDATE ops.idempotency_record
       SET status = 'COMPLETED', response_code = 200, response_body = v_body, completed_at = clock_timestamp()
     WHERE idempotency_record_id = v_idem;
    RETURN jsonb_build_object('outcome', 'ok', 'body', v_body);
END;
$resolve$;

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
AS $wrap$
BEGIN
    RETURN ops.authorize_statement_upload(
        p_actor, p_owner, p_idempotency_key, p_file_type,
        p_byte_size, p_sha256, p_filename, p_source_metadata, NULL
    );
END;
$wrap$;

REVOKE ALL ON FUNCTION ops.decide_statement_identity(uuid, numeric, text, char, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.bind_statement_account(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.statement_strong_duplicate_report() FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.authorize_statement_upload(uuid, uuid, text, text, bigint, text, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.authorize_statement_upload(uuid, uuid, text, text, bigint, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.map_statement_extraction(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.resolve_statement_review(uuid, uuid, uuid, uuid, text, integer, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.decide_statement_identity(uuid, numeric, text, char, date, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.bind_statement_account(uuid, uuid, uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.statement_strong_duplicate_report() TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.authorize_statement_upload(uuid, uuid, text, text, bigint, text, text, jsonb, uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.authorize_statement_upload(uuid, uuid, text, text, bigint, text, text, jsonb) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.map_statement_extraction(uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.resolve_statement_review(uuid, uuid, uuid, uuid, text, integer, uuid, uuid, text) TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M2-8-ACCOUNT-BINDING',
    'Statement account binding and reconciliation integrity',
    'D10 v1.2 FINAL FREEZE',
    'M2.8-v1',
    'Binds one owned account to a statement import and reuses M2.6-v1 matching. Does not rewrite historical canonical rows.'
)
ON CONFLICT (migration_code) DO UPDATE SET notes = EXCLUDED.notes;

COMMIT;
