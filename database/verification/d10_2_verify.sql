-- ============================================================================
-- MONYTIX D10-2 verification / smoke test
-- Safe behavior: all test rows are rolled back.
-- Prerequisite: D10-1 and D10-2 migrations applied.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    required_tables text[] := ARRAY[
        'ref.adapter_registry',
        'core.source_connection',
        'core.source_batch',
        'core.source_document',
        'core.document_set',
        'core.document_set_member',
        'core.statement_instance',
        'core.statement_link',
        'core.extraction_run',
        'core.source_record',
        'core.balance_snapshot',
        'core.account_data_coverage',
        'core.logical_transaction',
        'core.canonical_transaction_version',
        'core.transaction_evidence_link'
    ];
    t text;
BEGIN
    FOREACH t IN ARRAY required_tables LOOP
        IF to_regclass(t) IS NULL THEN
            RAISE EXCEPTION 'D10-2 verification failed: missing relation %', t;
        END IF;
    END LOOP;

    IF to_regprocedure('core.activate_canonical_transaction_version(uuid,uuid)') IS NULL THEN
        RAISE EXCEPTION 'D10-2 verification failed: activation function missing';
    END IF;
END $$;

DO $$
DECLARE
    inst_id uuid;
    actor_id_ uuid;
    owner_id_ uuid;
    account_id_ uuid;
    adapter_version_id_ uuid;
    connection_id_ uuid;
    batch_id_ uuid;
    document_id_ uuid;
    set_id_ uuid;
    statement_id_ uuid;
    extraction_run_id_ uuid;
    source_record_id_ uuid;
    logical_id_ uuid;
    canonical_v1 uuid;
    canonical_v2 uuid;
    partial_v3 uuid;
    current_id uuid;
    current_count integer;
BEGIN
    INSERT INTO ref.institution (institution_code, display_name, institution_type, country_code)
    VALUES ('__D10_2_TEST__', 'D10-2 Test Bank', 'BANK', 'IN')
    RETURNING institution_id INTO inst_id;

    INSERT INTO core.authenticated_actor (actor_type, auth_provider, auth_subject, email)
    VALUES ('HUMAN', 'TEST', 'd10-2-smoke-subject', 'd10-2@example.invalid')
    RETURNING actor_id INTO actor_id_;

    INSERT INTO core.owner (owner_type, display_name, default_currency_code, timezone_name)
    VALUES ('PERSON', 'D10-2 Smoke Owner', 'INR', 'Asia/Kolkata')
    RETURNING owner_id INTO owner_id_;

    INSERT INTO core.actor_owner_membership (
        actor_id, owner_id, membership_role, membership_status, is_default_owner
    ) VALUES (actor_id_, owner_id_, 'OWNER', 'ACTIVE', true);

    INSERT INTO core.financial_account (
        institution_id, account_type, account_display_name, masked_identifier,
        provider_account_reference, base_currency_code, lifecycle_status
    ) VALUES (
        inst_id, 'SAVINGS', 'D10-2 Savings', 'XXXX2233', 'D10_2_ACCOUNT_001', 'INR', 'ACTIVE'
    ) RETURNING financial_account_id INTO account_id_;

    INSERT INTO core.account_ownership (
        owner_id, financial_account_id, relationship_role,
        verification_state, relationship_status, verification_source
    ) VALUES (
        owner_id_, account_id_, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE', 'D10-2_SMOKE'
    );

    INSERT INTO ref.adapter_registry (
        adapter_id, adapter_version, institution_id, source_type, layout_code, status
    ) VALUES (
        'D10_2_TEST_ADAPTER', '1.0.0', inst_id, 'BANK_STATEMENT_PDF', 'TEST_LAYOUT', 'ACTIVE'
    ) RETURNING adapter_version_id INTO adapter_version_id_;

    INSERT INTO core.source_connection (
        owner_id, institution_id, connection_type, provider_code,
        provider_connection_reference, status
    ) VALUES (
        owner_id_, inst_id, 'UPLOAD', 'TEST', 'D10_2_CONN_001', 'ACTIVE'
    ) RETURNING source_connection_id INTO connection_id_;

    INSERT INTO core.source_batch (
        owner_id, uploaded_by_actor_id, source_connection_id, source_type,
        content_hash, ingestion_mode, status
    ) VALUES (
        owner_id_, actor_id_, connection_id_, 'BANK_STATEMENT_PDF',
        'd10-2-smoke-batch-hash', 'PUSH', 'PROCESSING'
    ) RETURNING source_batch_id INTO batch_id_;

    INSERT INTO core.source_document (
        source_batch_id, owner_id, uploaded_by_actor_id, content_hash,
        original_filename, declared_mime_type, observed_mime_type,
        object_reference, size_bytes, status
    ) VALUES (
        batch_id_, owner_id_, actor_id_, 'd10-2-smoke-document-hash',
        'statement.pdf', 'application/pdf', 'application/pdf',
        'test://d10-2/statement.pdf', 1024, 'AVAILABLE'
    ) RETURNING source_document_id INTO document_id_;

    INSERT INTO core.document_set (owner_id, expected_part_count, known_part_count, set_status)
    VALUES (owner_id_, 1, 1, 'COMPLETE')
    RETURNING document_set_id INTO set_id_;

    INSERT INTO core.document_set_member (
        document_set_id, source_document_id, owner_id, part_hint, observed_order
    ) VALUES (set_id_, document_id_, owner_id_, 'PART_1', 1);

    INSERT INTO core.statement_instance (
        source_document_id, financial_account_id, statement_date, period_start, period_end,
        opening_balance, closing_balance, currency_code,
        continuity_status, account_resolution_status, statement_status
    ) VALUES (
        document_id_, account_id_, DATE '2026-09-30', DATE '2026-09-01', DATE '2026-09-30',
        100000.00, 101500.00, 'INR', 'COMPLETE', 'RESOLVED', 'READY'
    ) RETURNING statement_instance_id INTO statement_id_;

    INSERT INTO core.extraction_run (
        source_document_id, adapter_version_id, run_no, status, run_reason, completed_at
    ) VALUES (
        document_id_, adapter_version_id_, 1, 'COMPLETED', 'INITIAL', clock_timestamp()
    ) RETURNING extraction_run_id INTO extraction_run_id_;

    INSERT INTO core.source_record (
        extraction_run_id, source_locator, extraction_sequence,
        raw_record_payload, raw_description, raw_transaction_date,
        raw_debit, raw_reference, record_status
    ) VALUES (
        extraction_run_id_, 'page=1,row=10', 1,
        '{"date":"2026-09-10","debit":"500.00"}'::jsonb,
        'UPI TEST MERCHANT', '10/09/2026', '500.00', 'TESTREF001', 'TRANSACTION_CANDIDATE'
    ) RETURNING source_record_id INTO source_record_id_;

    INSERT INTO core.balance_snapshot (
        financial_account_id, source_document_id, statement_instance_id,
        observed_at, balance_type, balance_amount, currency_code, source_quality
    ) VALUES (
        account_id_, document_id_, statement_id_, '2026-09-30 23:59:00+05:30',
        'CLOSING', 101500.00, 'INR', 'OBSERVED'
    );

    INSERT INTO core.account_data_coverage (
        financial_account_id, period_start, period_end, coverage_status, source_statement_id
    ) VALUES (
        account_id_, DATE '2026-09-01', DATE '2026-09-30', 'COMPLETE', statement_id_
    );

    INSERT INTO core.logical_transaction (financial_account_id, identity_status)
    VALUES (account_id_, 'ACTIVE')
    RETURNING logical_transaction_id INTO logical_id_;

    INSERT INTO core.canonical_transaction_version (
        logical_transaction_id, version_no, source_record_id, extraction_run_id, source_batch_id,
        financial_account_id, transaction_date, amount, direction, posting_status,
        currency_code, raw_description, normalized_description, source_reference,
        extraction_sequence, normalization_status, normalization_confidence,
        normalization_version, change_provenance, duplicate_outcome
    ) VALUES (
        logical_id_, 1, source_record_id_, extraction_run_id_, batch_id_,
        account_id_, DATE '2026-09-10', 500.00, 'OUT', 'POSTED',
        'INR', 'UPI TEST MERCHANT', 'UPI TEST MERCHANT', 'TESTREF001',
        1, 'READY', 0.9900, 'NORM_TEST_1', 'INITIAL', 'DISTINCT'
    ) RETURNING canonical_transaction_version_id INTO canonical_v1;

    INSERT INTO core.transaction_evidence_link (
        logical_transaction_id, source_record_id, canonical_transaction_version_id,
        relationship_type, identity_confidence, is_primary_observation
    ) VALUES (
        logical_id_, source_record_id_, canonical_v1,
        'PRIMARY_VERSION_SOURCE', 1.0000, true
    );

    PERFORM core.activate_canonical_transaction_version(canonical_v1, NULL);

    SELECT current_canonical_version_id INTO current_id
    FROM core.logical_transaction
    WHERE logical_transaction_id = logical_id_;

    IF current_id IS DISTINCT FROM canonical_v1 THEN
        RAISE EXCEPTION 'D10-2 verification failed: v1 was not activated';
    END IF;

    INSERT INTO core.canonical_transaction_version (
        logical_transaction_id, version_no, supersedes_version_id,
        source_record_id, extraction_run_id, source_batch_id,
        financial_account_id, transaction_date, transaction_timestamp, transaction_timezone_source,
        amount, direction, posting_status, currency_code,
        raw_description, normalized_description, source_reference,
        extraction_sequence, normalization_status, normalization_confidence,
        normalization_reason_codes, normalization_version,
        change_provenance, duplicate_outcome
    ) VALUES (
        logical_id_, 2, canonical_v1,
        source_record_id_, extraction_run_id_, batch_id_,
        account_id_, DATE '2026-09-10', '2026-09-10 09:15:00+05:30', 'SOURCE_EXPLICIT',
        500.00, 'OUT', 'SETTLED', 'INR',
        'UPI TEST MERCHANT', 'UPI TEST MERCHANT', 'TESTREF001',
        1, 'READY', 0.9950,
        ARRAY['MULTILINE_DESCRIPTION_MERGED']::text[], 'NORM_TEST_2',
        'SYSTEM_REPROCESS', 'DISTINCT'
    ) RETURNING canonical_transaction_version_id INTO canonical_v2;

    PERFORM core.activate_canonical_transaction_version(canonical_v2, canonical_v1);

    SELECT current_canonical_version_id INTO current_id
    FROM core.logical_transaction
    WHERE logical_transaction_id = logical_id_;

    SELECT count(*) INTO current_count
    FROM core.canonical_transaction_version
    WHERE logical_transaction_id = logical_id_ AND is_current = true;

    IF current_id IS DISTINCT FROM canonical_v2 OR current_count <> 1 THEN
        RAISE EXCEPTION 'D10-2 verification failed: atomic current version switch failed';
    END IF;

    IF EXISTS (
        SELECT 1 FROM core.canonical_transaction_version
        WHERE canonical_transaction_version_id = canonical_v1 AND is_current = true
    ) THEN
        RAISE EXCEPTION 'D10-2 verification failed: superseded version remained current';
    END IF;

    INSERT INTO core.canonical_transaction_version (
        logical_transaction_id, version_no, source_record_id, extraction_run_id, source_batch_id,
        financial_account_id, direction, posting_status,
        normalization_status, normalization_confidence, normalization_reason_codes,
        normalization_version, change_provenance, duplicate_outcome
    ) VALUES (
        logical_id_, 3, source_record_id_, extraction_run_id_, batch_id_,
        account_id_, 'UNKNOWN', 'UNKNOWN',
        'PARTIAL', 0.3000, ARRAY['AMBIGUOUS_DIRECTION']::text[],
        'NORM_TEST_3', 'SYSTEM_REPROCESS', 'REVIEW_REQUIRED'
    ) RETURNING canonical_transaction_version_id INTO partial_v3;

    BEGIN
        PERFORM core.activate_canonical_transaction_version(partial_v3, canonical_v2);
        RAISE EXCEPTION 'D10-2 verification failed: PARTIAL version was incorrectly activatable';
    EXCEPTION
        WHEN raise_exception THEN
            IF SQLERRM NOT LIKE 'only READY canonical versions%' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        INSERT INTO core.canonical_transaction_version (
            logical_transaction_id, version_no, source_record_id, extraction_run_id, source_batch_id,
            financial_account_id, transaction_date, amount, direction, posting_status, currency_code,
            normalization_status, normalization_confidence, normalization_version,
            change_provenance, duplicate_outcome
        ) VALUES (
            logical_id_, 4, source_record_id_, extraction_run_id_, batch_id_,
            account_id_, DATE '2026-09-11', 10.00, 'UNKNOWN', 'POSTED', 'INR',
            'READY', 0.9000, 'NORM_TEST_BAD', 'SYSTEM_REPROCESS', 'DISTINCT'
        );
        RAISE EXCEPTION 'D10-2 verification failed: invalid READY/UNKNOWN direction row was accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM core.v_current_canonical_transaction
        WHERE logical_transaction_id = logical_id_
          AND canonical_transaction_version_id = canonical_v2
          AND direction = 'OUT'
          AND amount = 500.00
    ) THEN
        RAISE EXCEPTION 'D10-2 verification failed: current canonical view missing expected v2';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ops.schema_migration WHERE migration_code = 'D10-2') THEN
        RAISE EXCEPTION 'D10-2 verification failed: schema migration ledger does not contain D10-2';
    END IF;
END $$;

ROLLBACK;

SELECT 'D10-2 verification passed' AS result;
