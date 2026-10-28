-- Correct or delete a recorded movement from the phone.
-- Canonical versions are immutable, so a correction inserts version n + 1 and
-- activates it. A delete unwinds the ledger's ON DELETE RESTRICT children inside
-- one owner-scoped function, because monytix_api has no DELETE grant.

BEGIN;

-- --------------------------------------------------------------------------
-- 1. User-selected weight.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.set_movement_weight(
    p_actor uuid,
    p_owner uuid,
    p_logical uuid,
    p_code text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, human_context, ops, pg_temp
AS $weight$
DECLARE
    v_code text := nullif(btrim(coalesce(p_code, '')), '');
BEGIN
    IF p_actor IS NULL OR p_owner IS NULL OR p_logical IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM core.logical_transaction lt
          JOIN core.account_ownership o ON o.financial_account_id = lt.financial_account_id
         WHERE lt.logical_transaction_id = p_logical
           AND o.owner_id = p_owner
           AND o.relationship_status = 'ACTIVE'
           AND o.effective_to IS NULL
    ) THEN
        RETURN jsonb_build_object('outcome', 'missing');
    END IF;

    -- Clearing the choice hands the movement back to the rulebook.
    IF v_code IS NULL THEN
        DELETE FROM core.movement_weight WHERE logical_transaction_id = p_logical;
        PERFORM ops.record_movement_weight(p_logical);
        RETURN jsonb_build_object('outcome', 'updated', 'body', jsonb_build_object('weight_code', NULL));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM human_context.weight_master
         WHERE code = v_code::human_context.weight_code AND is_active
    ) THEN
        RETURN jsonb_build_object('outcome', 'invalid_weight');
    END IF;

    INSERT INTO core.movement_weight (
        logical_transaction_id, owner_id, eligibility_state, reason_code,
        primary_weight_code, secondary_weight_code
    ) VALUES (
        p_logical, p_owner, 'WEIGHT', 'USER_SELECTED', v_code::human_context.weight_code, NULL
    )
    ON CONFLICT (logical_transaction_id) DO UPDATE
       SET owner_id = EXCLUDED.owner_id,
           eligibility_state = EXCLUDED.eligibility_state,
           reason_code = EXCLUDED.reason_code,
           primary_weight_code = EXCLUDED.primary_weight_code,
           secondary_weight_code = EXCLUDED.secondary_weight_code,
           updated_at = clock_timestamp();

    PERFORM ops.publish_movement_decision(p_logical);
    RETURN jsonb_build_object('outcome', 'updated', 'body', jsonb_build_object('weight_code', v_code));
END;
$weight$;

REVOKE ALL ON FUNCTION ops.set_movement_weight(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.set_movement_weight(uuid, uuid, uuid, text) TO monytix_api;

-- --------------------------------------------------------------------------
-- 2. Keep a chosen weight when a later category edit recomputes the movement.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.record_movement_weight(p_logical uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, spendsense, ops, pg_temp
AS $record$
DECLARE
    v_owner uuid;
    v_category text;
    v_subcategory text;
    v_channel text;
    v_flow text;
    v_amount numeric;
    v_state text;
    v_reason text;
    v_primary text;
    v_secondary text;
BEGIN
    IF p_logical IS NULL THEN
        RETURN;
    END IF;
    SELECT o.owner_id
      INTO v_owner
      FROM core.logical_transaction lt
      JOIN core.account_ownership o ON o.financial_account_id = lt.financial_account_id
     WHERE lt.logical_transaction_id = p_logical
       AND o.relationship_status = 'ACTIVE'
       AND o.effective_to IS NULL
     ORDER BY CASE WHEN o.relationship_role = 'PRIMARY_HOLDER' THEN 0 ELSE 1 END
     LIMIT 1;
    IF v_owner IS NULL THEN
        RETURN;
    END IF;

    -- A weight the user picked outranks the rulebook until they clear it.
    IF EXISTS (
        SELECT 1 FROM core.movement_weight
         WHERE logical_transaction_id = p_logical
           AND reason_code = 'USER_SELECTED'
    ) THEN
        UPDATE core.movement_weight
           SET owner_id = v_owner,
               updated_at = clock_timestamp()
         WHERE logical_transaction_id = p_logical;
        RETURN;
    END IF;

    SELECT choice.category_code, choice.subcategory_code
      INTO v_category, v_subcategory
      FROM core.category_choice choice
     WHERE choice.logical_transaction_id = p_logical
     ORDER BY choice.is_explicit DESC
     LIMIT 1;
    SELECT cv.direction, cv.amount, s.channel
      INTO v_flow, v_amount, v_channel
      FROM core.canonical_transaction_version cv
      LEFT JOIN core.gmail_spot_transaction s ON s.logical_transaction_id = cv.logical_transaction_id
     WHERE cv.logical_transaction_id = p_logical
       AND cv.is_current
     LIMIT 1;
    IF v_flow IS NULL THEN
        RETURN;
    END IF;
    SELECT assigned.eligibility_state, assigned.reason_code, assigned.primary_weight_code, assigned.secondary_weight_code
      INTO v_state, v_reason, v_primary, v_secondary
      FROM spendsense.assign_movement_weight(v_category, v_subcategory, v_channel, v_flow, v_amount) assigned;
    INSERT INTO core.movement_weight (
        logical_transaction_id, owner_id, eligibility_state, reason_code, primary_weight_code, secondary_weight_code
    ) VALUES (
        p_logical, v_owner, v_state, v_reason,
        v_primary::human_context.weight_code,
        v_secondary::human_context.weight_code
    )
    ON CONFLICT (logical_transaction_id) DO UPDATE
       SET owner_id = EXCLUDED.owner_id,
           eligibility_state = EXCLUDED.eligibility_state,
           reason_code = EXCLUDED.reason_code,
           primary_weight_code = EXCLUDED.primary_weight_code,
           secondary_weight_code = EXCLUDED.secondary_weight_code,
           updated_at = clock_timestamp();
    PERFORM ops.publish_movement_decision(p_logical);
END;
$record$;

REVOKE ALL ON FUNCTION ops.record_movement_weight(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.record_movement_weight(uuid) TO monytix_api;

-- --------------------------------------------------------------------------
-- 3. Correct a recorded movement.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.correct_transaction(
    p_actor uuid,
    p_owner uuid,
    p_logical uuid,
    p_idempotency_key text,
    p_expected_version uuid,
    p_amount text,
    p_direction text,
    p_occurred_at text,
    p_description text,
    p_category text,
    p_subcategory text,
    p_weight text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ref, human_context, ops, pg_temp
AS $correct$
DECLARE
    v_key text;
    v_hash text;
    v_existing_hash text;
    v_existing_status text;
    v_existing_body jsonb;
    v_idem uuid;
    v_amount numeric(20,4);
    v_occurred timestamptz;
    v_direction text;
    v_description text;
    v_category text := nullif(btrim(coalesce(p_category, '')), '');
    v_subcategory text := nullif(btrim(coalesce(p_subcategory, '')), '');
    v_weight text := nullif(btrim(coalesce(p_weight, '')), '');
    v_current core.canonical_transaction_version%ROWTYPE;
    v_next integer;
    v_version uuid;
    v_body jsonb;
    v_nested_result jsonb;
BEGIN
    v_key := btrim(coalesce(p_idempotency_key, ''));
    IF p_actor IS NULL OR p_owner IS NULL OR p_logical IS NULL OR v_key = '' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    -- Every field is optional on the wire; null keeps what the ledger already holds.
    IF p_amount IS NOT NULL THEN
        IF p_amount !~ '^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$' THEN
            RETURN jsonb_build_object('outcome', 'invalid');
        END IF;
        v_amount := p_amount::numeric(20,4);
        IF v_amount <= 0 THEN
            RETURN jsonb_build_object('outcome', 'invalid');
        END IF;
    END IF;
    IF p_direction IS NOT NULL THEN
        v_direction := btrim(p_direction);
        IF v_direction NOT IN ('IN', 'OUT') THEN
            RETURN jsonb_build_object('outcome', 'invalid');
        END IF;
    END IF;
    IF p_occurred_at IS NOT NULL THEN
        IF p_occurred_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN
            RETURN jsonb_build_object('outcome', 'invalid');
        END IF;
        BEGIN
            v_occurred := p_occurred_at::timestamptz;
        EXCEPTION
            WHEN invalid_datetime_format OR datetime_field_overflow THEN
                RETURN jsonb_build_object('outcome', 'invalid');
        END;
    END IF;
    IF p_description IS NOT NULL THEN
        v_description := btrim(p_description);
        IF v_description = '' THEN
            RETURN jsonb_build_object('outcome', 'invalid');
        END IF;
    END IF;
    IF v_category IS NULL AND v_subcategory IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    -- Validate before writing so an unknown code is a 422, not a rolled-back exception.
    IF v_category IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ref.taxonomy_category
         WHERE taxonomy_version = 'F10E-v1.2' AND category_code = v_category
    ) THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF v_subcategory IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ref.taxonomy_subcategory
         WHERE taxonomy_version = 'F10E-v1.2'
           AND category_code = v_category
           AND subcategory_code = v_subcategory
    ) THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF v_weight IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM human_context.weight_master
         WHERE code = v_weight::human_context.weight_code AND is_active
    ) THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('monytix-correct:' || p_owner::text, 0));

    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT cv.*
      INTO v_current
      FROM core.canonical_transaction_version cv
      JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
      JOIN core.account_ownership o ON o.financial_account_id = lt.financial_account_id
     WHERE cv.logical_transaction_id = p_logical
       AND lt.identity_status = 'ACTIVE'
       AND cv.is_current
       AND o.owner_id = p_owner
       AND o.relationship_status = 'ACTIVE'
       AND o.effective_to IS NULL
     FOR UPDATE OF cv;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'missing');
    END IF;
    IF p_expected_version IS NOT NULL AND p_expected_version <> v_current.canonical_transaction_version_id THEN
        RETURN jsonb_build_object('outcome', 'stale');
    END IF;

    -- A correction always writes a READY version, so the result must still carry
    -- the full minimum truth. A row missing any of it can only be edited by
    -- supplying the missing piece.
    IF coalesce(v_amount, v_current.amount) IS NULL
       OR coalesce(v_direction, v_current.direction) NOT IN ('IN', 'OUT')
       OR coalesce((v_occurred AT TIME ZONE 'UTC')::date, v_current.transaction_date) IS NULL
       OR v_current.currency_code IS NULL
       OR v_current.extraction_sequence IS NULL THEN
        RETURN jsonb_build_object('outcome', 'incomplete');
    END IF;

    v_hash := encode(public.digest(convert_to(concat_ws(E'\n',
        p_logical::text,
        coalesce(p_expected_version::text, ''),
        coalesce(p_amount, ''),
        coalesce(v_direction, ''),
        coalesce(p_occurred_at, ''),
        coalesce(v_description, ''),
        coalesce(v_category, ''),
        coalesce(v_subcategory, ''),
        coalesce(v_weight, '')
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

    v_next := v_current.version_no + 1;

    -- Lineage is copied so core.validate_canonical_transaction_version_insert still
    -- sees a source record that belongs to this account and extraction run.
    INSERT INTO core.canonical_transaction_version (
        logical_transaction_id, version_no, is_current, supersedes_version_id,
        source_record_id, extraction_run_id, source_batch_id, financial_account_id,
        instrument_id, account_currency_bucket_id,
        transaction_date, transaction_timestamp, transaction_timezone_source, value_date,
        amount, direction, posting_status, reversal_indicator, reversal_reference,
        currency_code, original_amount, original_currency_code, source_fx_rate, derived_fx_rate,
        raw_description, normalized_description, source_reference, running_balance, source_sequence,
        extraction_sequence, normalization_status, normalization_confidence,
        normalization_reason_codes, normalization_version, change_provenance, duplicate_outcome,
        legacy_limitation_flags
    ) VALUES (
        v_current.logical_transaction_id, v_next, false, v_current.canonical_transaction_version_id,
        v_current.source_record_id, v_current.extraction_run_id, v_current.source_batch_id,
        v_current.financial_account_id,
        v_current.instrument_id, v_current.account_currency_bucket_id,
        CASE WHEN v_occurred IS NOT NULL THEN (v_occurred AT TIME ZONE 'UTC')::date ELSE v_current.transaction_date END,
        coalesce(v_occurred, v_current.transaction_timestamp),
        v_current.transaction_timezone_source,
        v_current.value_date,
        coalesce(v_amount, v_current.amount),
        coalesce(v_direction, v_current.direction),
        v_current.posting_status, v_current.reversal_indicator, v_current.reversal_reference,
        v_current.currency_code, v_current.original_amount, v_current.original_currency_code,
        v_current.source_fx_rate, v_current.derived_fx_rate,
        coalesce(v_description, v_current.raw_description),
        v_current.normalized_description, v_current.source_reference,
        v_current.running_balance, v_current.source_sequence,
        v_current.extraction_sequence, 'READY', v_current.normalization_confidence,
        v_current.normalization_reason_codes || ARRAY['USER_CORRECTION'],
        v_current.normalization_version, 'USER_CORRECTION', 'DISTINCT',
        -- ck_canonical_legacy_lineage needs a source record or legacy flags; a Gmail
        -- spot row has neither, so the flag that admitted it must carry over.
        v_current.legacy_limitation_flags
    ) RETURNING canonical_transaction_version_id INTO v_version;

    PERFORM core.activate_canonical_transaction_version(v_version, v_current.canonical_transaction_version_id);

    IF v_category IS NOT NULL THEN
        v_nested_result := ops.set_transaction_category(
            p_actor, p_owner, p_logical, v_category, false, 'EXACT_MERCHANT', v_subcategory
        );
        IF v_nested_result ->> 'outcome' <> 'updated' THEN
            RAISE EXCEPTION 'category correction failed: %', v_nested_result ->> 'outcome';
        END IF;
    END IF;

    IF p_weight IS NOT NULL THEN
        v_nested_result := ops.set_movement_weight(p_actor, p_owner, p_logical, v_weight);
        IF v_nested_result ->> 'outcome' <> 'updated' THEN
            RAISE EXCEPTION 'weight correction failed: %', v_nested_result ->> 'outcome';
        END IF;
    END IF;

    v_body := jsonb_build_object(
        'logical_transaction_id', p_logical,
        'canonical_transaction_version_id', v_version,
        'superseded_version_id', v_current.canonical_transaction_version_id,
        'version_no', v_next,
        'amount', coalesce(v_amount, v_current.amount)::text,
        'direction', coalesce(v_direction, v_current.direction),
        'occurred_at', to_char(
            coalesce(v_occurred, v_current.transaction_timestamp) AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        ),
        'description', coalesce(v_description, v_current.raw_description),
        'category_code', coalesce(v_category, (
            SELECT choice.category_code FROM core.category_choice choice
             WHERE choice.logical_transaction_id = p_logical
             ORDER BY choice.is_explicit DESC LIMIT 1
        )),
        'subcategory_code', coalesce(v_subcategory, (
            SELECT choice.subcategory_code FROM core.category_choice choice
             WHERE choice.logical_transaction_id = p_logical
             ORDER BY choice.is_explicit DESC LIMIT 1
        )),
        'weight_code', (
            SELECT wm.code::text
              FROM core.movement_weight mw
              JOIN human_context.weight_master wm ON wm.code = mw.primary_weight_code
             WHERE mw.logical_transaction_id = p_logical
        )
    );

    INSERT INTO ops.outbox_event (
        owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
    ) VALUES (
        p_owner, 'TRANSACTION_CORRECTED', 'logical_transaction', p_logical,
        -- Namespaced so the same key used for a create or a delete cannot collide.
        v_body, 'correct:' || v_key
    );

    UPDATE ops.idempotency_record
       SET status = 'COMPLETED',
           response_code = 200,
           response_body = v_body,
           completed_at = clock_timestamp()
     WHERE idempotency_record_id = v_idem;

    RETURN jsonb_build_object('outcome', 'updated', 'body', v_body);
END;
$correct$;

REVOKE ALL ON FUNCTION ops.correct_transaction(uuid, uuid, uuid, text, uuid, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.correct_transaction(uuid, uuid, uuid, text, uuid, text, text, text, text, text, text, text) TO monytix_api;

-- --------------------------------------------------------------------------
-- 4. Delete a recorded movement.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.delete_transaction(
    p_actor uuid,
    p_owner uuid,
    p_logical uuid,
    p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, intel, human_context, ops, pg_temp
AS $delete$
DECLARE
    v_key text;
    v_hash text;
    v_existing_hash text;
    v_existing_status text;
    v_existing_body jsonb;
    v_idem uuid;
    v_body jsonb;
BEGIN
    v_key := btrim(coalesce(p_idempotency_key, ''));
    IF p_actor IS NULL OR p_owner IS NULL OR p_logical IS NULL OR v_key = '' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('monytix-delete:' || p_owner::text, 0));

    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM core.logical_transaction lt
          JOIN core.account_ownership o ON o.financial_account_id = lt.financial_account_id
         WHERE lt.logical_transaction_id = p_logical
           AND o.owner_id = p_owner
           AND o.relationship_status = 'ACTIVE'
           AND o.effective_to IS NULL
    ) THEN
        RETURN jsonb_build_object('outcome', 'missing');
    END IF;

    v_hash := encode(public.digest(convert_to(p_logical::text, 'UTF8'), 'sha256'), 'hex');

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

    -- Interpretation layer first: every one of these references the logical or
    -- canonical row with ON DELETE RESTRICT.
    DELETE FROM intel.transaction_identifier
     WHERE transaction_structure_id IN (
        SELECT transaction_structure_id FROM intel.transaction_structure
         WHERE logical_transaction_id = p_logical
     );
    DELETE FROM intel.transaction_structure WHERE logical_transaction_id = p_logical;
    DELETE FROM intel.category_resolution WHERE logical_transaction_id = p_logical;
    DELETE FROM intel.purpose_resolution WHERE logical_transaction_id = p_logical;
    DELETE FROM intel.transaction_party_resolution WHERE logical_transaction_id = p_logical;
    DELETE FROM intel.entity_observation WHERE logical_transaction_id = p_logical;
    DELETE FROM intel.financial_event_resolution WHERE logical_transaction_id = p_logical;

    -- Core ledger children.
    DELETE FROM core.category_choice WHERE logical_transaction_id = p_logical;
    DELETE FROM core.movement_weight WHERE logical_transaction_id = p_logical;
    DELETE FROM core.transaction_evidence_link WHERE logical_transaction_id = p_logical;

    -- Ingestion lineage outlives the movement: keep the source record, its
    -- disposition, and the spot alert, and just drop the link.
    UPDATE core.source_record_disposition
       SET logical_transaction_id = NULL,
           canonical_transaction_version_id = NULL
     WHERE logical_transaction_id = p_logical;
    UPDATE core.gmail_spot_transaction
       SET logical_transaction_id = NULL
     WHERE logical_transaction_id = p_logical;

    -- Context rows carry the id without a foreign key.
    DELETE FROM human_context.weight_associations
     WHERE target_type = 'TRANSACTION' AND target_id = p_logical;
    DELETE FROM human_context.weight_feedback
     WHERE target_type = 'TRANSACTION' AND target_id = p_logical;

    -- Drop the current pointer first so the deferred consistency triggers see
    -- NULL pointer and zero is_current rows by the time the transaction commits.
    UPDATE core.logical_transaction
       SET current_canonical_version_id = NULL
     WHERE logical_transaction_id = p_logical;
    DELETE FROM core.canonical_transaction_version WHERE logical_transaction_id = p_logical;
    DELETE FROM core.logical_transaction WHERE logical_transaction_id = p_logical;

    v_body := jsonb_build_object('logical_transaction_id', p_logical);

    INSERT INTO ops.outbox_event (
        owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
    ) VALUES (
        p_owner, 'TRANSACTION_DELETED', 'logical_transaction', p_logical,
        v_body, 'delete:' || p_logical::text
    );

    UPDATE ops.idempotency_record
       SET status = 'COMPLETED',
           response_code = 200,
           response_body = v_body,
           completed_at = clock_timestamp()
     WHERE idempotency_record_id = v_idem;

    RETURN jsonb_build_object('outcome', 'deleted', 'body', v_body);
END;
$delete$;

REVOKE ALL ON FUNCTION ops.delete_transaction(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.delete_transaction(uuid, uuid, uuid, text) TO monytix_api;

COMMENT ON FUNCTION ops.correct_transaction(uuid, uuid, uuid, text, uuid, text, text, text, text, text, text, text) IS
'F9H-094 v1.2 user correction. Inserts version n + 1 with USER_CORRECTION provenance and activates it. Category and weight route through the existing owner-scoped functions.';

COMMENT ON FUNCTION ops.delete_transaction(uuid, uuid, uuid, text) IS
'Hard delete of one recorded movement. Unwinds the read layers and keeps the ingestion source record as audit.';

INSERT INTO ops.schema_migration (
    migration_code, migration_name, architecture_version, checksum_hint, notes
) VALUES (
    'TRANSACTION-CORRECTION',
    'Correct and delete a recorded movement',
    'D10 v1.2 FINAL FREEZE',
    'f9h-094-v1.2',
    'Canonical versions stay immutable: a correction appends version n + 1. Delete runs in one SECURITY DEFINER function because monytix_api holds no DELETE grant.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
