-- M2.2 manual transaction create.
-- One security-definer function. No table INSERT grant. No taxonomy tables.
-- Does not alter migrations 0001 through 0005.

BEGIN;

-- uuid_v7 calls pgcrypto. Callers with a narrow search_path, including
-- ops.provision_authenticated_actor, must still be able to generate ids.
ALTER FUNCTION ops.uuid_v7() SET search_path = public, pg_temp;

INSERT INTO ref.adapter_registry (
    adapter_id,
    adapter_version,
    source_type,
    status,
    implementation_ref
) VALUES (
    'monytix.manual',
    'F9H-094-v1.1',
    'MANUAL',
    'ACTIVE',
    'F9H-094 v1.1 manual entry'
)
ON CONFLICT (adapter_id, adapter_version) DO NOTHING;

CREATE OR REPLACE FUNCTION ops.create_manual_transaction(
    p_actor uuid,
    p_owner uuid,
    p_account uuid,
    p_idempotency_key text,
    p_amount_text text,
    p_currency text,
    p_direction text,
    p_occurred_at text,
    p_merchant text,
    p_category text,
    p_subcategory text,
    p_weights jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ref, ops, pg_temp
AS $fn$
DECLARE
    v_amount numeric(20,4);
    v_occurred timestamptz;
    v_currency text;
    v_direction text;
    v_key text;
    v_hash text;
    v_existing_hash text;
    v_existing_status text;
    v_existing_body jsonb;
    v_idem uuid;
    v_adapter uuid;
    v_connection uuid;
    v_batch uuid;
    v_document uuid;
    v_run uuid;
    v_record uuid;
    v_logical uuid;
    v_version uuid;
    v_payload jsonb;
    v_body jsonb;
    v_request_id uuid;
BEGIN
    v_key := btrim(coalesce(p_idempotency_key, ''));
    v_currency := btrim(coalesce(p_currency, ''));
    v_direction := btrim(coalesce(p_direction, ''));

    IF p_actor IS NULL OR p_owner IS NULL OR p_account IS NULL OR v_key = '' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    IF p_amount_text IS NULL OR p_amount_text !~ '^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    v_amount := p_amount_text::numeric(20,4);
    IF v_amount <= 0 OR v_currency !~ '^[A-Z]{3}$' OR v_direction NOT IN ('IN', 'OUT') THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF p_occurred_at IS NULL OR p_occurred_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    BEGIN
        v_occurred := p_occurred_at::timestamptz;
    EXCEPTION
        WHEN invalid_datetime_format OR datetime_field_overflow THEN
            RETURN jsonb_build_object('outcome', 'invalid');
    END;
    IF p_merchant IS NULL OR btrim(p_merchant) = ''
       OR p_category IS NULL OR btrim(p_category) = ''
       OR p_subcategory IS NULL OR btrim(p_subcategory) = '' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF p_weights IS NOT NULL AND (
        jsonb_typeof(p_weights) <> 'array'
        OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_weights) AS element
            WHERE jsonb_typeof(element) <> 'string'
        )
    ) THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('monytix-manual:' || p_owner::text, 0));

    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM core.account_ownership
        WHERE owner_id = p_owner
          AND financial_account_id = p_account
          AND relationship_status = 'ACTIVE'
          AND effective_to IS NULL
          AND effective_from <= clock_timestamp()
    ) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    v_hash := encode(public.digest(convert_to(concat_ws(E'\n',
        p_account::text,
        p_amount_text,
        v_currency,
        v_direction,
        p_occurred_at,
        p_merchant,
        p_category,
        p_subcategory,
        coalesce(p_weights::text, '')
    ), 'UTF8'), 'sha256'), 'hex');

    SELECT request_hash, status, response_body
      INTO v_existing_hash, v_existing_status, v_existing_body
      FROM ops.idempotency_record
     WHERE scope = 'EXTERNAL_WRITE'
       AND owner_id = p_owner
       AND idempotency_key = v_key
     FOR UPDATE;

    IF FOUND THEN
        IF v_existing_status = 'COMPLETED' AND v_existing_hash = v_hash THEN
            RETURN jsonb_build_object('outcome', 'replay', 'body', v_existing_body);
        END IF;
        RETURN jsonb_build_object('outcome', 'conflict');
    END IF;

    INSERT INTO ops.idempotency_record (
        owner_id, actor_id, scope, idempotency_key, request_hash, status
    ) VALUES (
        p_owner, p_actor, 'EXTERNAL_WRITE', v_key, v_hash, 'IN_PROGRESS'
    ) RETURNING idempotency_record_id INTO v_idem;

    SELECT adapter_version_id INTO v_adapter
      FROM ref.adapter_registry
     WHERE adapter_id = 'monytix.manual'
       AND adapter_version = 'F9H-094-v1.1';
    IF v_adapter IS NULL THEN
        RAISE EXCEPTION 'manual adapter is not registered';
    END IF;

    SELECT source_connection_id INTO v_connection
      FROM core.source_connection
     WHERE owner_id = p_owner
       AND connection_type = 'MANUAL'
       AND status = 'ACTIVE'
     ORDER BY created_at
     LIMIT 1
     FOR UPDATE;

    IF v_connection IS NULL THEN
        INSERT INTO core.source_connection (
            owner_id, connection_type, provider_code, status, metadata
        ) VALUES (
            p_owner, 'MANUAL', 'MANUAL_ENTRY', 'ACTIVE',
            jsonb_build_object('api_source', 'MANUAL_ENTRY')
        ) RETURNING source_connection_id INTO v_connection;
    END IF;

    INSERT INTO core.source_batch (
        owner_id, uploaded_by_actor_id, source_connection_id, source_type,
        ingestion_mode, status, metadata
    ) VALUES (
        p_owner, p_actor, v_connection, 'MANUAL',
        'PUSH', 'COMPLETED',
        jsonb_build_object('api_source', 'MANUAL_ENTRY')
    ) RETURNING source_batch_id INTO v_batch;

    INSERT INTO core.source_document (
        source_batch_id, owner_id, uploaded_by_actor_id, status, metadata
    ) VALUES (
        v_batch, p_owner, p_actor, 'AVAILABLE',
        jsonb_build_object('api_source', 'MANUAL_ENTRY')
    ) RETURNING source_document_id INTO v_document;

    INSERT INTO core.extraction_run (
        source_document_id, adapter_version_id, run_no, completed_at, status, run_reason
    ) VALUES (
        v_document, v_adapter, 1, clock_timestamp(), 'COMPLETED', 'INITIAL'
    ) RETURNING extraction_run_id INTO v_run;

    v_payload := jsonb_build_object(
        'api_source', 'MANUAL_ENTRY',
        'category_code', p_category,
        'subcategory_code', p_subcategory,
        'user_selected_weights', p_weights,
        'taxonomy_verified', false,
        'weights_verified', false
    );

    INSERT INTO core.source_record (
        extraction_run_id, extraction_sequence, raw_record_payload, raw_description,
        raw_transaction_timestamp, raw_amount, record_status, reason_codes
    ) VALUES (
        v_run, 1, v_payload, p_merchant,
        p_occurred_at, p_amount_text, 'TRANSACTION_CANDIDATE',
        ARRAY['MANUAL_ENTRY', 'TAXONOMY_UNVERIFIED']
    ) RETURNING source_record_id INTO v_record;

    INSERT INTO core.logical_transaction (financial_account_id)
    VALUES (p_account)
    RETURNING logical_transaction_id INTO v_logical;

    INSERT INTO core.canonical_transaction_version (
        logical_transaction_id, version_no, is_current,
        source_record_id, extraction_run_id, source_batch_id, financial_account_id,
        transaction_date, transaction_timestamp, transaction_timezone_source,
        amount, direction, currency_code, raw_description,
        extraction_sequence, normalization_status, normalization_confidence,
        normalization_reason_codes, normalization_version, change_provenance, duplicate_outcome
    ) VALUES (
        v_logical, 1, false,
        v_record, v_run, v_batch, p_account,
        (v_occurred AT TIME ZONE 'UTC')::date, v_occurred, p_occurred_at,
        v_amount, v_direction, v_currency, p_merchant,
        1, 'READY', 0,
        ARRAY['USER_SUBMITTED_UNVERIFIED_TAXONOMY'],
        'F9H-094-v1.1', 'INITIAL', 'DISTINCT'
    ) RETURNING canonical_transaction_version_id INTO v_version;

    PERFORM core.activate_canonical_transaction_version(v_version, NULL);

    INSERT INTO core.transaction_evidence_link (
        logical_transaction_id, source_record_id, canonical_transaction_version_id,
        relationship_type, identity_confidence, identity_reason_codes, is_primary_observation
    ) VALUES (
        v_logical, v_record, v_version,
        'PRIMARY_VERSION_SOURCE', 1, ARRAY['MANUAL_ENTRY'], true
    );

    INSERT INTO ops.outbox_event (
        owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
    ) VALUES (
        p_owner, 'TRANSACTION_CREATED', 'logical_transaction', v_logical,
        jsonb_build_object(
            'logical_transaction_id', v_logical,
            'canonical_transaction_version_id', v_version,
            'amount', p_amount_text,
            'currency', v_currency,
            'direction', v_direction,
            'occurred_at', p_occurred_at
        ),
        v_key
    );

    v_request_id := ops.uuid_v7();
    v_body := jsonb_build_object(
        'meta', jsonb_build_object(
            'request_id', v_request_id,
            'generated_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'api_version', 'v1.1',
            'ui_state', 'WRITE_COMMITTED'
        ),
        'data', jsonb_build_object(
            'logical_transaction_id', v_logical,
            'canonical_transaction_version_id', v_version,
            'version_no', 1,
            'normalization_status', 'READY',
            'amount', p_amount_text,
            'currency', v_currency,
            'direction', v_direction,
            'occurred_at', p_occurred_at
        )
    );

    UPDATE ops.idempotency_record
       SET status = 'COMPLETED',
           response_code = 201,
           response_body = v_body,
           completed_at = clock_timestamp()
     WHERE idempotency_record_id = v_idem;

    RETURN jsonb_build_object('outcome', 'created', 'body', v_body);
END;
$fn$;

COMMENT ON FUNCTION ops.create_manual_transaction(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb) IS
'F9H-094 v1.1 manual create. Owned by the migration role so writes stay inside this function. monytix_api may execute it and may not insert the ledger tables.';

REVOKE ALL ON FUNCTION ops.create_manual_transaction(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.create_manual_transaction(uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb) TO monytix_api;

-- Deferred ledger checks run as the session user after this function returns.
-- monytix_api has no row visibility unless app.owner_id is set, so the checks
-- run as the table owner. The logical-transaction check reads the pointer at
-- commit, because an INSERT in the same transaction still carries NULL.
CREATE OR REPLACE FUNCTION core.check_canonical_current_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
DECLARE
    v_logical_id uuid;
    v_pointer uuid;
    v_current_count integer;
BEGIN
    v_logical_id := COALESCE(NEW.logical_transaction_id, OLD.logical_transaction_id);

    SELECT current_canonical_version_id
      INTO v_pointer
      FROM core.logical_transaction
     WHERE logical_transaction_id = v_logical_id;

    SELECT count(*)
      INTO v_current_count
      FROM core.canonical_transaction_version
     WHERE logical_transaction_id = v_logical_id
       AND is_current = true;

    IF v_pointer IS NULL AND v_current_count <> 0 THEN
        RAISE EXCEPTION 'logical transaction % has current canonical row but NULL current pointer', v_logical_id;
    END IF;

    IF v_pointer IS NOT NULL THEN
        IF v_current_count <> 1 THEN
            RAISE EXCEPTION 'logical transaction % current pointer requires exactly one is_current row; found %', v_logical_id, v_current_count;
        END IF;
        IF NOT EXISTS (
            SELECT 1
            FROM core.canonical_transaction_version
            WHERE canonical_transaction_version_id = v_pointer
              AND logical_transaction_id = v_logical_id
              AND is_current = true
              AND normalization_status = 'READY'
        ) THEN
            RAISE EXCEPTION 'logical transaction % current pointer does not reference its READY is_current canonical version', v_logical_id;
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION core.check_logical_current_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
DECLARE
    v_pointer uuid;
    v_current_count integer;
BEGIN
    -- Deferred checks run at commit. The INSERT event still carries a NULL
    -- pointer even after activate updates that same row, so read the row now.
    SELECT current_canonical_version_id
      INTO v_pointer
      FROM core.logical_transaction
     WHERE logical_transaction_id = NEW.logical_transaction_id;

    SELECT count(*)
      INTO v_current_count
      FROM core.canonical_transaction_version
     WHERE logical_transaction_id = NEW.logical_transaction_id
       AND is_current = true;

    IF v_pointer IS NULL THEN
        IF v_current_count <> 0 THEN
            RAISE EXCEPTION 'logical transaction % has is_current canonical row but NULL pointer', NEW.logical_transaction_id;
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1
            FROM core.canonical_transaction_version
            WHERE canonical_transaction_version_id = v_pointer
              AND logical_transaction_id = NEW.logical_transaction_id
              AND is_current = true
              AND normalization_status = 'READY'
        ) THEN
            RAISE EXCEPTION 'logical transaction % pointer % is not its READY current canonical version',
                NEW.logical_transaction_id, v_pointer;
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION core.check_canonical_current_consistency() FROM PUBLIC;
REVOKE ALL ON FUNCTION core.check_logical_current_consistency() FROM PUBLIC;

INSERT INTO ops.schema_migration (
    migration_code, migration_name, architecture_version, checksum_hint, notes
) VALUES (
    'M2-2-MANUAL',
    'Manual transaction create',
    'D10 v1.2 FINAL FREEZE',
    'f9h-094-v1.1',
    'SECURITY DEFINER create. MANUAL_ENTRY maps to MANUAL. Category and weights stay unverified evidence.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
