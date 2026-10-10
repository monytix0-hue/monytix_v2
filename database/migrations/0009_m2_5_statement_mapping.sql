-- M2.5 statement mapping.
-- Reads eligible source records and either creates one core.logical_transaction
-- or records a non-ledger disposition. Does not create txn_fact, txn_parsed,
-- or txn_enriched. Does not assign rulebook event labels.

BEGIN;

CREATE TABLE IF NOT EXISTS core.source_record_disposition (
    source_record_disposition_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    source_record_id             uuid NOT NULL REFERENCES core.source_record(source_record_id) ON DELETE RESTRICT,
    mapping_version              text NOT NULL,
    outcome                      text NOT NULL,
    reason_codes                 text[] NOT NULL DEFAULT '{}'::text[],
    logical_transaction_id       uuid REFERENCES core.logical_transaction(logical_transaction_id) ON DELETE RESTRICT,
    canonical_transaction_version_id uuid REFERENCES core.canonical_transaction_version(canonical_transaction_version_id) ON DELETE RESTRICT,
    created_at                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_source_record_disposition_version UNIQUE (source_record_id, mapping_version),
    CONSTRAINT ck_source_record_disposition_outcome CHECK (outcome IN (
        'MAPPED','LINKED_EXISTING','REVIEW_REQUIRED','REJECTED'
    )),
    CONSTRAINT ck_source_record_disposition_version_nonblank CHECK (btrim(mapping_version) <> '')
);

CREATE INDEX IF NOT EXISTS ix_source_record_disposition_logical
    ON core.source_record_disposition (logical_transaction_id)
    WHERE logical_transaction_id IS NOT NULL;

ALTER TABLE core.source_record_disposition ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_source_record_disposition_owner_read ON core.source_record_disposition;
CREATE POLICY pol_source_record_disposition_owner_read ON core.source_record_disposition
FOR SELECT USING (
    EXISTS (
        SELECT 1
        FROM core.source_record s
        JOIN core.extraction_run er ON er.extraction_run_id = s.extraction_run_id
        JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
        WHERE s.source_record_id = source_record_disposition.source_record_id
          AND sd.owner_id = ops.current_owner_id()
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_evidence_primary_source_record
    ON core.transaction_evidence_link (source_record_id)
    WHERE relationship_type = 'PRIMARY_VERSION_SOURCE' AND source_record_id IS NOT NULL;

CREATE OR REPLACE FUNCTION ops.map_statement_extraction(p_run uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $map$
DECLARE
    v_version constant text := 'M2.5-v1';
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
         WHERE source_record_id = v_rec.source_record_id AND mapping_version = v_version;
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
               AND source_reference = v_reference
               AND normalization_status = 'READY'
               AND is_current = true
             LIMIT 1;
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
        'mapped', v_mapped,
        'linked', v_linked,
        'review', v_review,
        'rejected', v_rejected,
        'replay', v_replay
    );
END;
$map$;

REVOKE ALL ON FUNCTION ops.map_statement_extraction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.map_statement_extraction(uuid) TO monytix_api;
GRANT SELECT ON core.source_record_disposition TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M2-5-STATEMENT-MAPPING',
    'Statement extraction to canonical mapping',
    'D10 v1.2 FINAL FREEZE',
    'M2.5-v1',
    'Maps eligible source records onto core.logical_transaction. Unresolved accounts stay dispositions.'
)
ON CONFLICT (migration_code) DO UPDATE SET notes = EXCLUDED.notes;

COMMIT;
