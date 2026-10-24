-- Assign the FRS weight rulebook to each core-ledger movement.

BEGIN;

CREATE TABLE IF NOT EXISTS core.movement_weight (
    logical_transaction_id uuid PRIMARY KEY REFERENCES core.logical_transaction(logical_transaction_id) ON DELETE CASCADE,
    owner_id               uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    eligibility_state      text NOT NULL,
    reason_code            text NOT NULL,
    primary_weight_code    human_context.weight_code,
    secondary_weight_code  human_context.weight_code,
    updated_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_movement_weight_state CHECK (
        eligibility_state IN ('IGNORE', 'OBSERVE', 'WEIGHT', 'PROMOTE')
    ),
    CONSTRAINT ck_movement_weight_primary CHECK (
        (eligibility_state IN ('IGNORE', 'OBSERVE') AND primary_weight_code IS NULL AND secondary_weight_code IS NULL)
        OR (eligibility_state IN ('WEIGHT', 'PROMOTE') AND primary_weight_code IS NOT NULL)
    )
);

ALTER TABLE core.movement_weight ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_movement_weight_owner_read ON core.movement_weight
    FOR SELECT USING (owner_id = ops.current_owner_id());

GRANT SELECT ON core.movement_weight TO monytix_api;

CREATE OR REPLACE FUNCTION spendsense.assign_movement_weight(
    p_category text,
    p_subcategory text,
    p_channel text,
    p_flow text,
    p_amount numeric
) RETURNS TABLE (
    eligibility_state text,
    reason_code text,
    primary_weight_code text,
    secondary_weight_code text
)
LANGUAGE plpgsql
IMMUTABLE
AS $assign$
DECLARE
    v_category text := upper(btrim(coalesce(p_category, '')));
    v_subcategory text := upper(btrim(coalesce(p_subcategory, '')));
    v_channel text := upper(btrim(coalesce(p_channel, '')));
    v_flow text := upper(btrim(coalesce(p_flow, '')));
    v_amount numeric := coalesce(p_amount, 0);
    v_state text;
    v_reason text;
    v_primary text := 'W02_COMFORT';
    v_secondary text;
BEGIN
    IF v_category = 'BANK_FEES' THEN
        eligibility_state := 'IGNORE';
        reason_code := 'SYSTEM_FEE_OR_TAX';
        primary_weight_code := NULL;
        secondary_weight_code := NULL;
        RETURN NEXT;
        RETURN;
    END IF;
    IF v_channel = 'OWN_ACCOUNT_TRANSFER' OR (v_category = 'TRANSFER' AND v_subcategory = 'OWN_ACCOUNT') THEN
        eligibility_state := 'IGNORE';
        reason_code := 'INTERNAL_TRANSFER_EXCLUDED';
        primary_weight_code := NULL;
        secondary_weight_code := NULL;
        RETURN NEXT;
        RETURN;
    END IF;
    IF v_subcategory = 'MERCHANT_SETTLEMENT' THEN
        eligibility_state := 'OBSERVE';
        reason_code := 'MERCHANT_SETTLEMENT';
        primary_weight_code := NULL;
        secondary_weight_code := NULL;
        RETURN NEXT;
        RETURN;
    END IF;
    IF v_channel = 'ATM' THEN
        eligibility_state := 'OBSERVE';
        reason_code := 'ATM_CASH';
        primary_weight_code := NULL;
        secondary_weight_code := NULL;
        RETURN NEXT;
        RETURN;
    END IF;
    IF v_flow = 'IN' AND v_category IN ('INCOME', 'SALARY') THEN
        eligibility_state := 'OBSERVE';
        reason_code := 'PASS_THROUGH_INCOME';
        primary_weight_code := NULL;
        secondary_weight_code := NULL;
        RETURN NEXT;
        RETURN;
    END IF;
    IF v_flow = 'OUT' AND v_amount >= 15000 THEN
        v_state := 'PROMOTE';
        v_reason := 'HIGH_MAGNITUDE_OUTFLOW';
    ELSE
        v_state := 'WEIGHT';
        v_reason := 'DISCRETIONARY_CANDIDATE';
    END IF;

    IF v_subcategory = 'GROCERIES_SUPERMARKET' THEN
        v_primary := 'W04_OBLIGATIONS';
        v_secondary := 'W02_COMFORT';
    ELSIF v_subcategory IN ('FOOD_DELIVERY', 'COFFEE_AND_CAFES') THEN
        v_primary := 'W02_COMFORT';
        v_secondary := 'W08_ATTENTION';
    ELSIF v_category = 'FOOD_DINING' THEN
        v_primary := 'W02_COMFORT';
        v_secondary := 'W08_ATTENTION';
    ELSIF v_subcategory = 'TRANSIT_CABS' THEN
        v_primary := 'W01_TIME';
        v_secondary := 'W02_COMFORT';
    ELSIF v_subcategory = 'TRANSIT_FUEL' OR v_category = 'MOBILITY_TRANSPORT' THEN
        v_primary := 'W04_OBLIGATIONS';
        v_secondary := NULL;
    ELSIF v_subcategory = 'SIP_AUTO_DEBIT' THEN
        v_primary := 'W09_RESILIENCE';
        v_secondary := 'W07_OPPORTUNITY';
    ELSIF v_subcategory IN ('LOAN_EMI', 'CREDIT_CARD_BILL') THEN
        v_primary := 'W04_OBLIGATIONS';
        v_secondary := NULL;
    ELSIF v_subcategory = 'STREAMING_SUBSCRIPTIONS' THEN
        v_primary := 'W02_COMFORT';
        v_secondary := NULL;
    ELSIF v_subcategory = 'SOFTWARE_SUBSCRIPTIONS' THEN
        v_primary := 'W07_OPPORTUNITY';
        v_secondary := NULL;
    ELSIF v_category = 'TRANSFER' AND v_subcategory = 'PEER_TO_PEER' THEN
        v_primary := 'W06_RELATIONSHIPS';
        v_secondary := NULL;
    ELSE
        v_primary := 'W02_COMFORT';
        v_secondary := NULL;
    END IF;

    eligibility_state := v_state;
    reason_code := v_reason;
    primary_weight_code := v_primary;
    secondary_weight_code := v_secondary;
    RETURN NEXT;
END;
$assign$;

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
END;
$record$;

REVOKE ALL ON FUNCTION spendsense.assign_movement_weight(text, text, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.record_movement_weight(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION spendsense.assign_movement_weight(text, text, text, text, numeric) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.record_movement_weight(uuid) TO monytix_api;

CREATE OR REPLACE FUNCTION ops.promote_gmail_spot(p_spot uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, spendsense, ops, pg_temp
AS $promote$
DECLARE
    v_spot core.gmail_spot_transaction%ROWTYPE;
    v_mask text;
    v_matches integer;
    v_account uuid;
    v_type text;
    v_name text;
    v_logical uuid;
    v_version uuid;
    v_direction text;
    v_date date;
    v_narration text;
    v_title text;
    v_parsed jsonb;
    v_cleaned text;
    v_normalized text;
    v_rule text;
    v_category text;
    v_subcategory text;
    v_class_category text;
    v_class_subcategory text;
    v_token text;
BEGIN
    SELECT * INTO v_spot
      FROM core.gmail_spot_transaction
     WHERE gmail_spot_transaction_id = p_spot
     FOR UPDATE;
    IF v_spot.gmail_spot_transaction_id IS NULL THEN
        RETURN NULL;
    END IF;
    IF v_spot.logical_transaction_id IS NOT NULL THEN
        RETURN v_spot.logical_transaction_id;
    END IF;

    v_mask := v_spot.account_last4;
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'gmail-spot-account:' || v_spot.owner_id::text || ':' || coalesce(v_mask, ''),
        0
    ));

    IF v_mask IS NOT NULL THEN
        SELECT count(*)::int INTO v_matches
          FROM core.account_ownership o
          JOIN core.financial_account a ON a.financial_account_id = o.financial_account_id
         WHERE o.owner_id = v_spot.owner_id
           AND o.relationship_status = 'ACTIVE'
           AND o.effective_to IS NULL
           AND o.verification_state <> 'REVOKED'
           AND a.lifecycle_status = 'ACTIVE'
           AND a.masked_identifier = v_mask;
        IF v_matches = 1 THEN
            SELECT a.financial_account_id INTO v_account
              FROM core.account_ownership o
              JOIN core.financial_account a ON a.financial_account_id = o.financial_account_id
             WHERE o.owner_id = v_spot.owner_id
               AND o.relationship_status = 'ACTIVE'
               AND o.effective_to IS NULL
               AND o.verification_state <> 'REVOKED'
               AND a.lifecycle_status = 'ACTIVE'
               AND a.masked_identifier = v_mask;
        END IF;
    END IF;

    IF v_account IS NULL THEN
        SELECT a.financial_account_id INTO v_account
          FROM core.account_ownership o
          JOIN core.financial_account a ON a.financial_account_id = o.financial_account_id
         WHERE o.owner_id = v_spot.owner_id
           AND o.relationship_status = 'ACTIVE'
           AND o.effective_to IS NULL
           AND a.lifecycle_status = 'ACTIVE'
           AND a.metadata->>'source' = 'gmail_spot'
           AND a.metadata->>'gmail_spot_mask' = coalesce(v_mask, '')
         LIMIT 1;
    END IF;

    IF v_account IS NULL THEN
        v_name := coalesce(
            ops.movement_account_label(v_spot.raw_excerpt, v_spot.channel, v_mask, NULL),
            CASE WHEN v_mask IS NULL THEN 'Gmail account' ELSE 'Account ending in ' || v_mask END
        );
        v_type := CASE
            WHEN v_name ~* 'credit card' THEN 'CREDIT_CARD'
            WHEN v_spot.channel = 'CARD' AND v_name !~* 'debit card' THEN 'CREDIT_CARD'
            ELSE 'SAVINGS'
        END;
        INSERT INTO core.financial_account (
            account_type, account_display_name, masked_identifier, base_currency_code, lifecycle_status, metadata
        ) VALUES (
            v_type, v_name, v_mask, 'INR', 'ACTIVE',
            jsonb_build_object('source', 'gmail_spot', 'gmail_spot_mask', coalesce(v_mask, ''))
        ) RETURNING financial_account_id INTO v_account;
        INSERT INTO core.account_ownership (
            owner_id, financial_account_id, relationship_role, verification_state, relationship_status
        ) VALUES (
            v_spot.owner_id, v_account, 'PRIMARY_HOLDER', 'DECLARED', 'ACTIVE'
        );
    END IF;

    PERFORM ops.apply_movement_account_label(
        v_account, v_spot.raw_excerpt, v_spot.channel, v_mask, NULL
    );

    v_direction := CASE WHEN v_spot.flow = 'DEBIT' THEN 'OUT' ELSE 'IN' END;
    v_date := (COALESCE(v_spot.posted_at, v_spot.created_at) AT TIME ZONE 'Asia/Kolkata')::date;
    v_cleaned := spendsense.clean_counterparty_name(v_spot.counterparty);
    v_title := nullif(btrim(coalesce(v_cleaned, '')), '');
    IF v_title IS NULL OR lower(v_title) IN ('unknown', 'general') THEN
        v_title := nullif(btrim(coalesce(v_spot.counterparty, '')), '');
    END IF;
    IF v_title IS NULL OR lower(v_title) IN ('unknown', 'general') THEN
        v_title := CASE v_spot.channel
            WHEN 'UPI' THEN 'UPI payment'
            WHEN 'CARD' THEN 'Card payment'
            WHEN 'ATM' THEN 'ATM withdrawal'
            ELSE 'Transaction'
        END;
    END IF;
    v_narration := concat_ws(' ', v_spot.channel, v_spot.counterparty);
    v_parsed := spendsense.parse_narration_v4(v_narration, v_direction);
    v_normalized := nullif(btrim(coalesce(v_parsed->>'normalized_description', '')), '');
    v_cleaned := coalesce(
        nullif(btrim(coalesce(v_parsed #>> '{fields,cleaned_counterparty}', '')), ''),
        v_cleaned,
        v_title
    );
    v_token := coalesce(nullif(btrim(coalesce(v_cleaned, '')), ''), v_title);

    INSERT INTO core.logical_transaction (financial_account_id, identity_metadata)
    VALUES (
        v_account,
        jsonb_build_object('gmail_spot_id', p_spot::text, 'idempotency_key', 'gmail_spot:' || p_spot::text)
    ) RETURNING logical_transaction_id INTO v_logical;

    INSERT INTO core.canonical_transaction_version (
        logical_transaction_id, version_no, is_current, financial_account_id,
        transaction_date, transaction_timestamp, amount, direction, currency_code,
        raw_description, normalized_description, source_reference,
        extraction_sequence, normalization_status, normalization_confidence,
        normalization_reason_codes, normalization_version, change_provenance, duplicate_outcome,
        legacy_limitation_flags
    ) VALUES (
        v_logical, 1, false, v_account,
        v_date, COALESCE(v_spot.posted_at, v_spot.created_at), v_spot.amount, v_direction, 'INR',
        v_title, COALESCE(v_normalized, v_title), nullif(btrim(coalesce(v_spot.payment_ref, '')), ''),
        1, 'READY', 1,
        ARRAY['GMAIL_SPOT']::text[], 'GMAIL-SPOT-v2', 'INITIAL', 'DISTINCT',
        ARRAY['GMAIL_SPOT']::text[]
    ) RETURNING canonical_transaction_version_id INTO v_version;

    PERFORM core.activate_canonical_transaction_version(v_version, NULL);

    SELECT classified.category_code, classified.subcategory_code
      INTO v_class_category, v_class_subcategory
      FROM spendsense.classify_movement(
          v_spot.channel,
          coalesce(v_token, ''),
          concat_ws(' ', v_spot.channel, v_spot.counterparty, v_title),
          v_direction
      ) classified;

    IF v_token IS NOT NULL THEN
        SELECT category_code INTO v_rule
          FROM core.category_rule
         WHERE owner_id = v_spot.owner_id
           AND match_scope = 'EXACT_MERCHANT'
           AND match_token = v_token
         LIMIT 1;
    END IF;
    v_category := coalesce(v_rule, v_class_category);
    v_subcategory := CASE
        WHEN v_category IS NULL THEN NULL
        WHEN v_rule IS NOT NULL AND v_rule IS DISTINCT FROM v_class_category THEN NULL
        ELSE v_class_subcategory
    END;
    IF v_category IS NOT NULL AND v_token IS NOT NULL THEN
        INSERT INTO core.category_choice (
            owner_id, logical_transaction_id, category_code, subcategory_code, match_token, match_scope, is_explicit
        ) VALUES (
            v_spot.owner_id, v_logical, v_category, v_subcategory, v_token, 'EXACT_MERCHANT', false
        )
        ON CONFLICT (logical_transaction_id) DO NOTHING;
    END IF;

    UPDATE core.gmail_spot_transaction
       SET logical_transaction_id = v_logical
     WHERE gmail_spot_transaction_id = p_spot;
    PERFORM ops.record_movement_weight(v_logical);
    RETURN v_logical;
END;
$promote$;


CREATE OR REPLACE FUNCTION ops.apply_import_categories(p_run uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, spendsense, ops, pg_temp
AS $import$
DECLARE
    v_logical uuid;
    v_owner uuid;
    v_description text;
    v_direction text;
    v_parsed jsonb;
    v_cleaned text;
    v_channel text;
    v_token text;
    v_rule text;
    v_category text;
    v_subcategory text;
    v_class_category text;
    v_class_subcategory text;
BEGIN
    FOR v_logical, v_owner, v_description, v_direction IN
        SELECT DISTINCT d.logical_transaction_id, own.owner_id, cv.raw_description, cv.direction
          FROM core.source_record_disposition d
          JOIN core.source_record sr ON sr.source_record_id = d.source_record_id
          JOIN core.logical_transaction lt ON lt.logical_transaction_id = d.logical_transaction_id
          JOIN core.canonical_transaction_version cv
            ON cv.logical_transaction_id = lt.logical_transaction_id
           AND cv.is_current
          JOIN LATERAL (
              SELECT o.owner_id
                FROM core.account_ownership o
               WHERE o.financial_account_id = lt.financial_account_id
                 AND o.relationship_status = 'ACTIVE'
                 AND o.effective_to IS NULL
               ORDER BY CASE WHEN o.relationship_role = 'PRIMARY_HOLDER' THEN 0 ELSE 1 END
               LIMIT 1
          ) own ON true
         WHERE sr.extraction_run_id = p_run
           AND d.logical_transaction_id IS NOT NULL
           AND d.outcome IN ('MAPPED', 'LINKED_EXISTING')
           AND NOT EXISTS (
               SELECT 1 FROM core.category_choice existing
                WHERE existing.logical_transaction_id = d.logical_transaction_id
                  AND existing.is_explicit
           )
    LOOP
        v_parsed := spendsense.parse_narration_v4(coalesce(v_description, ''), coalesce(v_direction, ''));
        v_cleaned := nullif(btrim(coalesce(v_parsed #>> '{fields,cleaned_counterparty}', '')), '');
        v_channel := nullif(btrim(coalesce(v_parsed->>'channel_type', '')), '');
        v_token := coalesce(v_cleaned, nullif(left(btrim(coalesce(v_description, '')), 180), ''));
        v_rule := NULL;
        v_class_category := NULL;
        v_class_subcategory := NULL;
        IF v_token IS NOT NULL THEN
            SELECT classified.category_code, classified.subcategory_code
              INTO v_class_category, v_class_subcategory
              FROM spendsense.classify_movement(v_channel, v_token, v_description, v_direction) classified;
            SELECT category_code INTO v_rule
              FROM core.category_rule
             WHERE owner_id = v_owner
               AND match_scope = 'EXACT_MERCHANT'
               AND match_token = v_token
             LIMIT 1;
        END IF;
        v_category := coalesce(v_rule, v_class_category);
        v_subcategory := CASE
            WHEN v_category IS NULL THEN NULL
            WHEN v_rule IS NOT NULL AND v_rule IS DISTINCT FROM v_class_category THEN NULL
            ELSE v_class_subcategory
        END;
        IF v_category IS NOT NULL AND v_token IS NOT NULL THEN
            INSERT INTO core.category_choice (
                owner_id, logical_transaction_id, category_code, subcategory_code, match_token, match_scope, is_explicit
            ) VALUES (v_owner, v_logical, v_category, v_subcategory, v_token, 'EXACT_MERCHANT', false)
            ON CONFLICT (logical_transaction_id) DO UPDATE
                SET category_code = EXCLUDED.category_code,
                    subcategory_code = EXCLUDED.subcategory_code,
                    match_token = EXCLUDED.match_token
              WHERE core.category_choice.is_explicit = false;
        END IF;
        PERFORM ops.record_movement_weight(v_logical);
    END LOOP;
END;
$import$;


REVOKE ALL ON FUNCTION ops.promote_gmail_spot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.promote_gmail_spot(uuid) TO monytix_api;

REVOKE ALL ON FUNCTION ops.apply_import_categories(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.apply_import_categories(uuid) TO monytix_api;

DO $check$
DECLARE
    v_state text;
    v_reason text;
    v_primary text;
    v_secondary text;
BEGIN
    SELECT eligibility_state, reason_code, primary_weight_code, secondary_weight_code
      INTO v_state, v_reason, v_primary, v_secondary
      FROM spendsense.assign_movement_weight('TECHNOLOGY_SERVICES', 'SOFTWARE_SUBSCRIPTIONS', 'CARD', 'OUT', 2285.89);
    IF v_state IS DISTINCT FROM 'WEIGHT' OR v_primary IS DISTINCT FROM 'W07_OPPORTUNITY' OR v_secondary IS NOT NULL THEN
        RAISE EXCEPTION 'software weight failed: % % %', v_state, v_primary, v_secondary;
    END IF;

    SELECT eligibility_state, reason_code, primary_weight_code, secondary_weight_code
      INTO v_state, v_reason, v_primary, v_secondary
      FROM spendsense.assign_movement_weight('TRANSFER', 'PEER_TO_PEER', 'IMPS', 'OUT', 10000);
    IF v_state IS DISTINCT FROM 'WEIGHT' OR v_primary IS DISTINCT FROM 'W06_RELATIONSHIPS' THEN
        RAISE EXCEPTION 'peer transfer weight failed: % %', v_state, v_primary;
    END IF;

    SELECT eligibility_state, reason_code, primary_weight_code, secondary_weight_code
      INTO v_state, v_reason, v_primary, v_secondary
      FROM spendsense.assign_movement_weight('TRANSFER', 'PEER_TO_PEER', 'IMPS', 'OUT', 20000);
    IF v_state IS DISTINCT FROM 'PROMOTE' OR v_reason IS DISTINCT FROM 'HIGH_MAGNITUDE_OUTFLOW' OR v_primary IS DISTINCT FROM 'W06_RELATIONSHIPS' THEN
        RAISE EXCEPTION 'large peer transfer weight failed: % % %', v_state, v_reason, v_primary;
    END IF;

    SELECT eligibility_state, primary_weight_code
      INTO v_state, v_primary
      FROM spendsense.assign_movement_weight('BANK_FEES', NULL, 'UPI', 'OUT', 18);
    IF v_state IS DISTINCT FROM 'IGNORE' OR v_primary IS NOT NULL THEN
        RAISE EXCEPTION 'fee was weighted: % %', v_state, v_primary;
    END IF;

    SELECT eligibility_state, primary_weight_code
      INTO v_state, v_primary
      FROM spendsense.assign_movement_weight('INCOME', NULL, 'NEFT', 'IN', 50000);
    IF v_state IS DISTINCT FROM 'OBSERVE' OR v_primary IS NOT NULL THEN
        RAISE EXCEPTION 'income was weighted: % %', v_state, v_primary;
    END IF;

    SELECT eligibility_state, primary_weight_code
      INTO v_state, v_primary
      FROM spendsense.assign_movement_weight(NULL, NULL, 'UPI', 'OUT', 40);
    IF v_state IS DISTINCT FROM 'WEIGHT' OR v_primary IS DISTINCT FROM 'W02_COMFORT' THEN
        RAISE EXCEPTION 'uncategorized spend weight failed: % %', v_state, v_primary;
    END IF;
END;
$check$;

DO $backfill$
DECLARE
    v_logical uuid;
BEGIN
    FOR v_logical IN
        SELECT cv.logical_transaction_id
          FROM core.canonical_transaction_version cv
         WHERE cv.is_current
           AND EXISTS (
               SELECT 1
                 FROM core.category_choice choice
                WHERE choice.logical_transaction_id = cv.logical_transaction_id
           )
    LOOP
        PERFORM ops.record_movement_weight(v_logical);
    END LOOP;
END;
$backfill$;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'MOVEMENT-WEIGHT',
    'Assign the FRS weight rulebook to each core-ledger movement',
    'OQ-11-open',
    'movement-weight',
    'Weights follow the existing F2 and F3 rules and are stored on the logical transaction the apps read.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
