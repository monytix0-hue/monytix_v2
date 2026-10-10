-- M2.6 import review.
-- Replaces the mapper so a bank reference is not enough to auto-link.
-- Does not edit migrations 0001-0009 and does not assign event labels.

BEGIN;

ALTER TABLE core.source_record_disposition
    ADD COLUMN IF NOT EXISTS review_version integer NOT NULL DEFAULT 1;
ALTER TABLE core.source_record_disposition
    ADD COLUMN IF NOT EXISTS resolved_by_actor_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_source_record_disposition_actor'
    ) THEN
        ALTER TABLE core.source_record_disposition
            ADD CONSTRAINT fk_source_record_disposition_actor
            FOREIGN KEY (resolved_by_actor_id)
            REFERENCES core.authenticated_actor(actor_id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_source_record_disposition_review_version'
    ) THEN
        ALTER TABLE core.source_record_disposition
            ADD CONSTRAINT ck_source_record_disposition_review_version
            CHECK (review_version >= 1);
    END IF;
END $$;

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

        v_match_logical := NULL;
        v_match_version := NULL;
        IF v_reference IS NOT NULL THEN
            SELECT logical_transaction_id, canonical_transaction_version_id
              INTO v_match_logical, v_match_version
              FROM core.canonical_transaction_version
             WHERE financial_account_id = v_account
               AND amount = v_amount
               AND direction = v_direction
               AND currency_code = v_currency
               AND transaction_date = v_date
               AND source_reference = v_reference
               AND normalization_status = 'READY'
               AND is_current = true
             LIMIT 1;
            IF v_match_logical IS NULL AND EXISTS (
                SELECT 1 FROM core.canonical_transaction_version
                 WHERE financial_account_id = v_account
                   AND source_reference = v_reference
                   AND normalization_status = 'READY'
                   AND is_current = true
            ) THEN
                INSERT INTO core.source_record_disposition (source_record_id, mapping_version, outcome, reason_codes)
                VALUES (v_rec.source_record_id, v_version, 'REVIEW_REQUIRED', ARRAY['CONFLICTING_REFERENCE']);
                v_review := v_review + 1;
                CONTINUE;
            END IF;
        ELSIF EXISTS (
            SELECT 1 FROM core.canonical_transaction_version
             WHERE financial_account_id = v_account
               AND amount = v_amount
               AND direction = v_direction
               AND transaction_date = v_date
               AND normalization_status = 'READY'
               AND is_current = true
        ) THEN
            INSERT INTO core.source_record_disposition (source_record_id, mapping_version, outcome, reason_codes)
            VALUES (v_rec.source_record_id, v_version, 'REVIEW_REQUIRED', ARRAY['WEAK_MATCH']);
            v_review := v_review + 1;
            CONTINUE;
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

CREATE OR REPLACE FUNCTION ops.statement_import_summary(p_owner uuid, p_actor uuid, p_import uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $sum$
DECLARE
    v_doc_status text;
    v_run_status text;
    v_parser text;
    v_finalized text;
    v_failures integer;
    v_total integer;
    v_mapped integer;
    v_linked integer;
    v_review integer;
    v_invalid integer;
    v_ineligible integer;
    v_pending integer;
BEGIN
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    SELECT d.status, b.metadata->>'import_finalized_at'
      INTO v_doc_status, v_finalized
      FROM core.source_document d
      JOIN core.source_batch b ON b.source_batch_id = d.source_batch_id
     WHERE d.source_batch_id = p_import AND d.owner_id = p_owner;
    IF v_doc_status IS NULL THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    SELECT er.status, er.worker_metadata->>'parser_version'
      INTO v_run_status, v_parser
      FROM core.extraction_run er
      JOIN core.source_document d ON d.source_document_id = er.source_document_id
     WHERE d.source_batch_id = p_import AND d.owner_id = p_owner
     ORDER BY er.run_no DESC
     LIMIT 1;
    SELECT count(*)::int INTO v_failures
      FROM core.extraction_run er
      JOIN core.source_document d ON d.source_document_id = er.source_document_id
     WHERE d.source_batch_id = p_import AND d.owner_id = p_owner AND er.status = 'FAILED';

    WITH records AS (
        SELECT s.source_record_id, s.record_status, er.status AS run_status, er.reason_codes AS run_reasons,
               sd.status AS doc_status, sd.reason_codes AS doc_reasons, sd.metadata AS doc_meta, sd.content_hash
          FROM core.source_record s
          JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
          JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
         WHERE sd.source_batch_id = p_import AND sd.owner_id = p_owner
    ), latest AS (
        SELECT DISTINCT ON (d.source_record_id) d.source_record_id, d.outcome
          FROM core.source_record_disposition d
          JOIN records r ON r.source_record_id = d.source_record_id
         ORDER BY d.source_record_id, d.created_at DESC
    ), marked AS (
        SELECT r.source_record_id, l.outcome,
               (
                   r.run_status IN ('COMPLETED', 'PARTIAL')
                   AND NOT ('UNSUPPORTED_FILE_LAYOUT' = ANY (COALESCE(r.run_reasons, ARRAY[]::text[])))
                   AND r.doc_status = 'AVAILABLE'
                   AND 'SCAN_CLEAN' = ANY (COALESCE(r.doc_reasons, ARRAY[]::text[]))
                   AND coalesce(r.doc_meta->>'sealed', 'false') = 'true'
                   AND r.content_hash IS NOT NULL
               ) AS eligible
          FROM records r
          LEFT JOIN latest l ON l.source_record_id = r.source_record_id
    )
    SELECT count(*)::int,
           count(*) FILTER (WHERE outcome = 'MAPPED')::int,
           count(*) FILTER (WHERE outcome = 'LINKED_EXISTING')::int,
           count(*) FILTER (WHERE outcome = 'REVIEW_REQUIRED')::int,
           count(*) FILTER (WHERE outcome = 'REJECTED' OR (outcome IS NULL AND record_status = 'EXTRACTION_REJECTED'))::int,
           count(*) FILTER (WHERE outcome IS NULL AND record_status IS DISTINCT FROM 'EXTRACTION_REJECTED' AND NOT eligible)::int,
           count(*) FILTER (WHERE outcome IS NULL AND record_status IS DISTINCT FROM 'EXTRACTION_REJECTED' AND eligible)::int
      INTO v_total, v_mapped, v_linked, v_review, v_invalid, v_ineligible, v_pending
      FROM (
          SELECT m.outcome, r.record_status, m.eligible
            FROM marked m
            JOIN records r ON r.source_record_id = m.source_record_id
      ) counted;

    RETURN jsonb_build_object(
        'outcome', 'ok',
        'import_id', p_import,
        'document_status', v_doc_status,
        'extraction_status', v_run_status,
        'parser_version', v_parser,
        'total_source_records', coalesce(v_total, 0),
        'mapped_count', coalesce(v_mapped, 0),
        'linked_count', coalesce(v_linked, 0),
        'review_count', coalesce(v_review, 0),
        'invalid_count', coalesce(v_invalid, 0),
        'ineligible_count', coalesce(v_ineligible, 0),
        'pending_count', coalesce(v_pending, 0),
        'processing_failures', coalesce(v_failures, 0),
        'completion_eligible', coalesce(v_review, 0) = 0 AND coalesce(v_pending, 0) = 0 AND v_run_status IN ('COMPLETED', 'PARTIAL'),
        'import_finalized_at', v_finalized
    );
END;
$sum$;

CREATE OR REPLACE FUNCTION ops.statement_review_queue(
    p_actor uuid, p_owner uuid, p_import uuid, p_source_record uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $queue$
DECLARE
    v_items jsonb;
BEGIN
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM core.source_document
         WHERE source_batch_id = p_import AND owner_id = p_owner
    ) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF p_source_record IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM core.source_record s
          JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
          JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
         WHERE s.source_record_id = p_source_record
           AND sd.source_batch_id = p_import
           AND sd.owner_id = p_owner
    ) THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'source_record_id', d.source_record_id,
        'review_version', d.review_version,
        'outcome', d.outcome,
        'reason_codes', to_jsonb(d.reason_codes),
        'mapping_version', d.mapping_version,
        'amount', s.raw_amount,
        'transaction_date', s.raw_transaction_date,
        'direction', s.raw_record_payload->>'direction',
        'reference', s.raw_reference
    ) ORDER BY s.extraction_sequence), '[]'::jsonb)
      INTO v_items
      FROM core.source_record_disposition d
      JOIN core.source_record s ON s.source_record_id = d.source_record_id
      JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
      JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
     WHERE sd.source_batch_id = p_import
       AND sd.owner_id = p_owner
       AND d.outcome = 'REVIEW_REQUIRED'
       AND (p_source_record IS NULL OR d.source_record_id = p_source_record)
       AND d.created_at = (
           SELECT max(d2.created_at) FROM core.source_record_disposition d2
            WHERE d2.source_record_id = d.source_record_id
       );
    RETURN jsonb_build_object('outcome', 'ok', 'items', v_items);
END;
$queue$;

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
BEGIN
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR p_action NOT IN ('select_account', 'confirm_new', 'link_existing', 'reject') THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    SELECT sd.owner_id, sd.source_batch_id, er.extraction_run_id, s.extraction_sequence,
           s.raw_description, s.raw_record_payload->>'normalized_description', s.raw_amount,
           s.raw_transaction_date, upper(coalesce(s.raw_record_payload->>'direction', '')),
           NULLIF(btrim(coalesce(s.raw_reference, '')), '')
      INTO v_owner, v_batch, v_run, v_sequence, v_description, v_normalized, v_amount_text,
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
        v_account := p_account;
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

    INSERT INTO ops.outbox_event (
        owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
    ) VALUES (
        p_owner, 'STATEMENT_REVIEW_RESOLVED', 'source_record', p_source_record,
        jsonb_build_object('source_record_id', p_source_record, 'action', p_action, 'outcome', v_body->>'outcome'),
        'statement-review:' || p_source_record::text || ':' || v_new_version::text
    );
    UPDATE ops.idempotency_record
       SET status = 'COMPLETED', response_code = 200, response_body = v_body, completed_at = clock_timestamp()
     WHERE idempotency_record_id = v_idem;
    RETURN jsonb_build_object('outcome', 'ok', 'body', v_body);
END;
$resolve$;

CREATE OR REPLACE FUNCTION ops.finalize_statement_import(
    p_actor uuid, p_owner uuid, p_import uuid, p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $final$
DECLARE
    v_summary jsonb;
    v_hash text;
    v_existing_hash text;
    v_existing_status text;
    v_existing_body jsonb;
    v_body jsonb;
    v_idem uuid;
    v_finalized text;
BEGIN
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    v_summary := ops.statement_import_summary(p_owner, p_actor, p_import);
    IF v_summary->>'outcome' = 'forbidden' THEN
        RETURN v_summary;
    END IF;
    v_hash := encode(public.digest(convert_to('finalize:' || p_import::text, 'UTF8'), 'sha256'), 'hex');
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
    IF coalesce((v_summary->>'completion_eligible')::boolean, false) IS NOT TRUE THEN
        RETURN jsonb_build_object('outcome', 'review_pending', 'review_count', v_summary->'review_count', 'pending_count', v_summary->'pending_count');
    END IF;
    UPDATE core.source_batch
       SET metadata = metadata || jsonb_build_object(
           'import_finalized_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )
     WHERE source_batch_id = p_import AND owner_id = p_owner
       AND metadata->>'import_finalized_at' IS NULL;
    SELECT metadata->>'import_finalized_at' INTO v_finalized
      FROM core.source_batch WHERE source_batch_id = p_import;
    v_body := jsonb_build_object('import_id', p_import, 'import_finalized_at', v_finalized, 'completion_eligible', true);
    INSERT INTO ops.idempotency_record (owner_id, actor_id, scope, idempotency_key, request_hash, status, response_code, response_body, completed_at)
    VALUES (p_owner, p_actor, 'EXTERNAL_WRITE', p_idempotency_key, v_hash, 'COMPLETED', 200, v_body, clock_timestamp())
    RETURNING idempotency_record_id INTO v_idem;
    RETURN jsonb_build_object('outcome', 'ok', 'body', v_body);
END;
$final$;

REVOKE ALL ON FUNCTION ops.map_statement_extraction(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.statement_import_summary(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.statement_review_queue(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.resolve_statement_review(uuid, uuid, uuid, uuid, text, integer, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.finalize_statement_import(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.map_statement_extraction(uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.statement_import_summary(uuid, uuid, uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.statement_review_queue(uuid, uuid, uuid, uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.resolve_statement_review(uuid, uuid, uuid, uuid, text, integer, uuid, uuid, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.finalize_statement_import(uuid, uuid, uuid, text) TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M2-6-IMPORT-REVIEW',
    'Statement reconciliation and import review',
    'D10 v1.2 FINAL FREEZE',
    'M2.6-v1',
    'Tightens reference matching and adds owner-scoped review writes. Does not classify events.'
)
ON CONFLICT (migration_code) DO UPDATE SET notes = EXCLUDED.notes;

COMMIT;
