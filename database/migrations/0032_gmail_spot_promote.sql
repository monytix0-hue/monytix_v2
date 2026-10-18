-- Promote a staged Gmail alert into the canonical ledger.
-- A last-4 is not an account number, so an unmatched or ambiguous mask
-- gets its own shadow account instead of attaching to the wrong one.

BEGIN;

ALTER TABLE core.gmail_spot_transaction
    ADD COLUMN IF NOT EXISTS logical_transaction_id uuid
        REFERENCES core.logical_transaction(logical_transaction_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_gmail_spot_unpromoted
    ON core.gmail_spot_transaction (gmail_spot_transaction_id)
    WHERE logical_transaction_id IS NULL;

CREATE OR REPLACE FUNCTION ops.save_gmail_spot_transaction(
    p_owner uuid,
    p_connection uuid,
    p_message text,
    p_idempotency_key text,
    p_flow text,
    p_amount numeric,
    p_account_last4 text,
    p_payment_ref text,
    p_channel text,
    p_counterparty text,
    p_posted_at timestamptz,
    p_raw_excerpt text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
DECLARE
    v_id uuid;
    v_last4 text;
    v_counterparty text;
BEGIN
    v_last4 := nullif(btrim(coalesce(p_account_last4, '')), '');
    v_counterparty := left(btrim(coalesce(p_counterparty, '')), 120);
    IF p_owner IS NULL
        OR p_connection IS NULL
        OR btrim(coalesce(p_message, '')) = ''
        OR p_idempotency_key !~ '^(ref:[A-Za-z0-9]{10,16}|hash:[0-9a-f]{64})$'
        OR p_flow NOT IN ('DEBIT', 'CREDIT')
        OR p_channel NOT IN ('UPI', 'IMPS', 'NEFT', 'RTGS', 'ATM', 'CARD', 'OTHER')
        OR p_amount IS NULL
        OR p_amount <= 0
        OR (v_last4 IS NOT NULL AND v_last4 !~ '^[0-9]{4}$')
        OR v_counterparty = ''
        OR NOT EXISTS (
            SELECT 1 FROM core.gmail_connection
             WHERE gmail_connection_id = p_connection
               AND owner_id = p_owner
        ) THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    INSERT INTO core.gmail_spot_transaction (
        owner_id, gmail_connection_id, gmail_message_id, idempotency_key, flow, amount,
        account_last4, payment_ref, channel, counterparty, posted_at, raw_excerpt
    ) VALUES (
        p_owner, p_connection, btrim(p_message), p_idempotency_key, p_flow, p_amount,
        v_last4, nullif(btrim(coalesce(p_payment_ref, '')), ''), p_channel, v_counterparty,
        p_posted_at, left(coalesce(p_raw_excerpt, ''), 500)
    )
    ON CONFLICT DO NOTHING
    RETURNING gmail_spot_transaction_id INTO v_id;

    IF v_id IS NULL THEN
        SELECT gmail_spot_transaction_id INTO v_id
          FROM core.gmail_spot_transaction
         WHERE owner_id = p_owner
           AND (
               idempotency_key = p_idempotency_key
               OR (gmail_connection_id = p_connection AND gmail_message_id = btrim(p_message))
           )
         LIMIT 1;
        RETURN jsonb_build_object('outcome', 'replay', 'gmail_spot_transaction_id', v_id);
    END IF;
    RETURN jsonb_build_object('outcome', 'created', 'gmail_spot_transaction_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION ops.promote_gmail_spot(p_spot uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, spendsense, ops, pg_temp
AS $$
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
    v_parsed jsonb;
    v_cleaned text;
    v_normalized text;
    v_rule text;
    v_category text;
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
        v_type := CASE WHEN v_spot.channel = 'CARD' THEN 'CREDIT_CARD' ELSE 'SAVINGS' END;
        v_name := CASE WHEN v_mask IS NULL THEN 'Gmail account' ELSE 'Account ending in ' || v_mask END;
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

    v_direction := CASE WHEN v_spot.flow = 'DEBIT' THEN 'OUT' ELSE 'IN' END;
    v_date := (COALESCE(v_spot.posted_at, v_spot.created_at) AT TIME ZONE 'Asia/Kolkata')::date;
    v_narration := concat_ws(' / ', v_spot.channel, nullif(btrim(coalesce(v_spot.payment_ref, '')), ''), v_spot.counterparty);
    v_parsed := spendsense.parse_narration_v4(v_narration, v_direction);
    v_normalized := nullif(btrim(coalesce(v_parsed->>'normalized_description', '')), '');
    v_cleaned := nullif(btrim(coalesce(v_parsed #>> '{fields,cleaned_counterparty}', '')), '');
    IF v_cleaned IS NULL THEN
        v_cleaned := spendsense.clean_counterparty_name(v_spot.counterparty);
    END IF;

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
        v_narration, COALESCE(v_normalized, v_narration), nullif(btrim(coalesce(v_spot.payment_ref, '')), ''),
        1, 'READY', 1,
        ARRAY['GMAIL_SPOT']::text[], 'GMAIL-SPOT-v1', 'INITIAL', 'DISTINCT',
        ARRAY['GMAIL_SPOT']::text[]
    ) RETURNING canonical_transaction_version_id INTO v_version;

    PERFORM core.activate_canonical_transaction_version(v_version, NULL);

    IF v_cleaned IS NOT NULL THEN
        SELECT category_code INTO v_rule
          FROM core.category_rule
         WHERE owner_id = v_spot.owner_id
           AND match_scope = 'EXACT_MERCHANT'
           AND match_token = v_cleaned
         LIMIT 1;
        v_category := coalesce(v_rule, nullif(btrim(coalesce(spendsense.merchant_category_code(v_cleaned), '')), ''));
        IF v_category IS NOT NULL THEN
            INSERT INTO core.category_choice (
                owner_id, logical_transaction_id, category_code, match_token, match_scope, is_explicit
            ) VALUES (
                v_spot.owner_id, v_logical, v_category, v_cleaned, 'EXACT_MERCHANT', false
            )
            ON CONFLICT (logical_transaction_id) DO NOTHING;
        END IF;
    END IF;

    UPDATE core.gmail_spot_transaction
       SET logical_transaction_id = v_logical
     WHERE gmail_spot_transaction_id = p_spot;
    RETURN v_logical;
END;
$$;

REVOKE ALL ON FUNCTION ops.save_gmail_spot_transaction(uuid, uuid, text, text, text, numeric, text, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.promote_gmail_spot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.save_gmail_spot_transaction(uuid, uuid, text, text, text, numeric, text, text, text, text, timestamptz, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.promote_gmail_spot(uuid) TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'GMAIL-SPOT-PROMOTE',
    'Promote Gmail spot alerts into the ledger',
    'OQ-11-open',
    'gmail-spot-promote',
    'Spot alerts become current canonical rows through a shadow or matched financial account.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
