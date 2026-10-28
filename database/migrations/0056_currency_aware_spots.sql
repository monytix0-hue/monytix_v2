-- Currency-aware spot alerts.
-- A card alert can state a foreign amount and a domestic posted amount in the same body.
-- The spot keeps both: amount/currency_code stay booked, stated_* carry the foreign side.
-- Booked currency also flows to the canonical row so the ledger stops assuming INR.

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Spot alerts carry a detected currency, its provenance, and the stated pair
-- --------------------------------------------------------------------------
ALTER TABLE core.gmail_spot_transaction
    DROP CONSTRAINT IF EXISTS ck_gmail_spot_currency;

ALTER TABLE core.gmail_spot_transaction
    ADD COLUMN IF NOT EXISTS stated_amount          numeric(20,4),
    ADD COLUMN IF NOT EXISTS stated_currency_code   char(3),
    ADD COLUMN IF NOT EXISTS currency_basis         text,
    ADD COLUMN IF NOT EXISTS currency_confidence    numeric(5,4);

ALTER TABLE core.gmail_spot_transaction
    DROP CONSTRAINT IF EXISTS ck_gmail_spot_currency_format,
    DROP CONSTRAINT IF EXISTS ck_gmail_spot_stated_amount,
    DROP CONSTRAINT IF EXISTS ck_gmail_spot_stated_currency,
    DROP CONSTRAINT IF EXISTS ck_gmail_spot_currency_pair,
    DROP CONSTRAINT IF EXISTS ck_gmail_spot_currency_basis,
    DROP CONSTRAINT IF EXISTS ck_gmail_spot_currency_confidence;

ALTER TABLE core.gmail_spot_transaction
    ADD CONSTRAINT ck_gmail_spot_currency_format
        CHECK (currency_code ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT ck_gmail_spot_stated_amount
        CHECK (stated_amount IS NULL OR stated_amount > 0),
    ADD CONSTRAINT ck_gmail_spot_stated_currency
        CHECK (stated_currency_code IS NULL OR stated_currency_code ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT ck_gmail_spot_currency_pair
        CHECK (
            (stated_amount IS NULL AND stated_currency_code IS NULL)
            OR (stated_amount IS NOT NULL AND stated_currency_code IS NOT NULL)
        ),
    ADD CONSTRAINT ck_gmail_spot_currency_basis
        CHECK (
            currency_basis IS NULL
            OR currency_basis IN (
                'EXPLICIT_ISO','UNAMBIGUOUS_SYMBOL','PREFIXED_DOLLAR',
                'TLD_OR_COUNTRY','OWNER_DEFAULT','ACCOUNT_DEFAULT'
            )
        ),
    ADD CONSTRAINT ck_gmail_spot_currency_confidence
        CHECK (currency_confidence IS NULL OR (currency_confidence >= 0 AND currency_confidence <= 1));

COMMENT ON COLUMN core.gmail_spot_transaction.stated_amount IS
'The foreign amount exactly as the alert wrote it. Evidence only; the booked amount reconciles.';
COMMENT ON COLUMN core.gmail_spot_transaction.currency_basis IS
'Why this currency was chosen. Low confidence routes the row to review instead of guessing.';

-- --------------------------------------------------------------------------
-- 2. Due-date notices are not rupee-only either
-- --------------------------------------------------------------------------
ALTER TABLE core.due_date_notification
    DROP CONSTRAINT IF EXISTS ck_due_date_currency;

-- --------------------------------------------------------------------------
-- 3. Pinned rates for currencies the ECB feed does not quote (AED, SAR, PKR, BDT, NGN)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.manual_fx_rates (
    rate_date   date NOT NULL,
    base_code   char(3) NOT NULL,
    quote_code  char(3) NOT NULL,
    rate        numeric(18,8) NOT NULL CHECK (rate > 0),
    is_pegged   boolean NOT NULL DEFAULT false,
    source      text NOT NULL DEFAULT 'MANUAL',
    created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (rate_date, base_code, quote_code),
    CONSTRAINT ck_manual_fx_base CHECK (base_code ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_manual_fx_quote CHECK (quote_code ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_manual_fx_pair CHECK (base_code <> quote_code)
);

COMMENT ON TABLE finance.manual_fx_rates IS
'Pinned and pegged rates for corridors the ECB daily feed does not quote. Takes precedence over finance.fx_rates.';

GRANT SELECT, INSERT, UPDATE ON finance.manual_fx_rates TO monytix_api, monytix_finance;

-- --------------------------------------------------------------------------
-- 4. save_gmail_spot_transaction accepts currency and the stated pair
--    The twelve original parameters keep their order, so a twelve-argument
--    call still resolves through the trailing defaults.
-- --------------------------------------------------------------------------
DROP FUNCTION IF EXISTS ops.save_gmail_spot_transaction(
    uuid, uuid, text, text, text, numeric, text, text, text, text, timestamptz, text
);

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
    p_raw_excerpt text,
    p_currency text DEFAULT 'INR',
    p_currency_basis text DEFAULT NULL,
    p_currency_confidence numeric DEFAULT NULL,
    p_stated_amount numeric DEFAULT NULL,
    p_stated_currency text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
DECLARE
    v_id uuid;
    v_last4 text;
    v_counterparty text;
    v_currency text;
    v_stated_currency text;
BEGIN
    v_last4 := nullif(btrim(coalesce(p_account_last4, '')), '');
    v_counterparty := left(btrim(coalesce(p_counterparty, '')), 120);
    v_currency := upper(btrim(coalesce(p_currency, 'INR')));
    v_stated_currency := nullif(upper(btrim(coalesce(p_stated_currency, ''))), '');

    IF p_owner IS NULL
        OR p_connection IS NULL
        OR btrim(coalesce(p_message, '')) = ''
        OR p_idempotency_key !~ '^(ref:[A-Za-z0-9]{10,16}|hash:[0-9a-f]{64})$'
        OR p_flow NOT IN ('DEBIT', 'CREDIT')
        OR p_channel NOT IN ('UPI', 'IMPS', 'NEFT', 'RTGS', 'ATM', 'CARD', 'OTHER')
        OR p_amount IS NULL
        OR p_amount <= 0
        OR v_currency !~ '^[A-Z]{3}$'
        OR (v_stated_currency IS NOT NULL AND v_stated_currency !~ '^[A-Z]{3}$')
        OR (p_stated_amount IS NOT NULL AND p_stated_amount <= 0)
        OR ((p_stated_amount IS NULL) <> (v_stated_currency IS NULL))
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
        currency_code, account_last4, payment_ref, channel, counterparty, posted_at, raw_excerpt,
        currency_basis, currency_confidence, stated_amount, stated_currency_code
    ) VALUES (
        p_owner, p_connection, btrim(p_message), p_idempotency_key, p_flow, p_amount,
        v_currency, v_last4, nullif(btrim(coalesce(p_payment_ref, '')), ''), p_channel, v_counterparty,
        p_posted_at, left(coalesce(p_raw_excerpt, ''), 500),
        nullif(btrim(coalesce(p_currency_basis, '')), ''), p_currency_confidence,
        p_stated_amount, v_stated_currency
    )
    ON CONFLICT DO NOTHING
    RETURNING gmail_spot_transaction_id INTO v_id;

    IF v_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'replay');
    END IF;
    RETURN jsonb_build_object('outcome', 'created');
END;
$$;

REVOKE ALL ON FUNCTION ops.save_gmail_spot_transaction(
    uuid, uuid, text, text, text, numeric, text, text, text, text, timestamptz, text,
    text, text, numeric, numeric, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.save_gmail_spot_transaction(
    uuid, uuid, text, text, text, numeric, text, text, text, text, timestamptz, text,
    text, text, numeric, numeric, text
) TO monytix_api;

-- --------------------------------------------------------------------------
-- 5. promote_gmail_spot stops assuming INR and Asia/Kolkata
--    Everything else is the 0049 body: advisory lock, masked-identifier
--    resolution, ownership insert, movement label, classify_movement,
--    and core.activate_canonical_transaction_version().
-- --------------------------------------------------------------------------
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
    v_rule_sub text;
    v_category text;
    v_subcategory text;
    v_class_category text;
    v_class_subcategory text;
    v_token text;
    v_currency char(3);
    v_timezone text;
    v_original_amount numeric(20,4);
    v_original_currency char(3);
    v_fx_rate numeric(24,10);
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

    -- The owner's own timezone, not a fixed one. Missing rows fall back to UTC.
    SELECT coalesce(nullif(btrim(timezone_name), ''), 'UTC') INTO v_timezone
      FROM core.owner
     WHERE owner_id = v_spot.owner_id;
    v_timezone := coalesce(v_timezone, 'UTC');

    v_currency := coalesce(nullif(btrim(v_spot.currency_code), ''), 'INR');

    -- The stated pair is evidence. A NULL pair means "same as booked", never "unknown".
    IF v_spot.stated_amount IS NOT NULL
       AND v_spot.stated_currency_code IS NOT NULL
       AND v_spot.stated_currency_code <> v_currency
       AND v_spot.stated_amount > 0 THEN
        v_original_amount := v_spot.stated_amount;
        v_original_currency := v_spot.stated_currency_code;
        v_fx_rate := round((v_spot.amount / v_spot.stated_amount)::numeric, 10);
    END IF;

    v_mask := v_spot.account_last4;
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'gmail-spot-account:' || v_spot.owner_id::text || ':' || coalesce(v_mask, ''),
        0
    ));

    -- Same last four digits in two currencies are two accounts, not one.
    IF v_mask IS NOT NULL THEN
        SELECT count(*)::int INTO v_matches
          FROM core.account_ownership o
          JOIN core.financial_account a ON a.financial_account_id = o.financial_account_id
         WHERE o.owner_id = v_spot.owner_id
           AND o.relationship_status = 'ACTIVE'
           AND o.effective_to IS NULL
           AND o.verification_state <> 'REVOKED'
           AND a.lifecycle_status = 'ACTIVE'
           AND a.masked_identifier = v_mask
           AND btrim(a.base_currency_code) = v_currency;
        IF v_matches = 1 THEN
            SELECT a.financial_account_id INTO v_account
              FROM core.account_ownership o
              JOIN core.financial_account a ON a.financial_account_id = o.financial_account_id
             WHERE o.owner_id = v_spot.owner_id
               AND o.relationship_status = 'ACTIVE'
               AND o.effective_to IS NULL
               AND o.verification_state <> 'REVOKED'
               AND a.lifecycle_status = 'ACTIVE'
               AND a.masked_identifier = v_mask
               AND btrim(a.base_currency_code) = v_currency;
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
           AND btrim(a.base_currency_code) = v_currency
         LIMIT 1;
    END IF;

    IF v_account IS NULL THEN
        v_name := coalesce(
            ops.movement_account_label(v_spot.raw_excerpt, v_spot.channel, v_mask, NULL),
            CASE WHEN v_mask IS NULL THEN 'Gmail account' ELSE 'Account ending in ' || v_mask END
        );
        v_type := CASE
            WHEN v_name ~* 'a/c ending in' THEN 'SAVINGS'
            WHEN v_name ~* 'credit card' THEN 'CREDIT_CARD'
            WHEN v_spot.channel = 'CARD' AND v_name !~* 'debit card' THEN 'CREDIT_CARD'
            ELSE 'SAVINGS'
        END;
        INSERT INTO core.financial_account (
            account_type, account_display_name, masked_identifier, base_currency_code, lifecycle_status, metadata
        ) VALUES (
            v_type, v_name, v_mask, v_currency, 'ACTIVE',
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
    v_date := (COALESCE(v_spot.posted_at, v_spot.created_at) AT TIME ZONE v_timezone)::date;
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
        original_amount, original_currency_code, source_fx_rate,
        raw_description, normalized_description, source_reference,
        extraction_sequence, normalization_status, normalization_confidence,
        normalization_reason_codes, normalization_version, change_provenance, duplicate_outcome,
        legacy_limitation_flags
    ) VALUES (
        v_logical, 1, false, v_account,
        v_date, COALESCE(v_spot.posted_at, v_spot.created_at), v_spot.amount, v_direction, v_currency,
        v_original_amount, v_original_currency, v_fx_rate,
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
        SELECT category_code, subcategory_code INTO v_rule, v_rule_sub
          FROM core.category_rule
         WHERE owner_id = v_spot.owner_id
           AND match_scope = 'EXACT_MERCHANT'
           AND match_token = v_token
         LIMIT 1;
    END IF;
    v_category := coalesce(v_rule, v_class_category);
    v_subcategory := CASE
        WHEN v_category IS NULL THEN NULL
        WHEN v_rule IS NOT NULL AND v_rule_sub IS NOT NULL THEN v_rule_sub
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

REVOKE ALL ON FUNCTION ops.promote_gmail_spot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.promote_gmail_spot(uuid) TO monytix_api;

-- --------------------------------------------------------------------------
-- 6. The worker needs the owner's market, zone and home currency to parse
--    Replaces the 0030 body: same columns, plus four preference columns.
-- --------------------------------------------------------------------------
DROP FUNCTION IF EXISTS ops.list_gmail_poll_targets();

CREATE FUNCTION ops.list_gmail_poll_targets()
RETURNS TABLE (
    gmail_connection_id uuid,
    owner_id uuid,
    actor_id uuid,
    history_checkpoint text,
    credential_ciphertext text,
    initial_window_drained boolean,
    owner_timezone text,
    owner_currency text,
    owner_country text,
    owner_locale text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
    SELECT DISTINCT ON (g.gmail_connection_id)
           g.gmail_connection_id, g.owner_id, m.actor_id, g.history_checkpoint,
           g.credential_ciphertext, g.initial_window_drained,
           o.timezone_name,
           btrim(o.default_currency_code),
           nullif(upper(btrim(o.metadata->>'country_code')), ''),
           nullif(btrim(o.metadata->>'locale'), '')
      FROM core.gmail_connection g
      JOIN core.owner o ON o.owner_id = g.owner_id
      LEFT JOIN core.actor_owner_membership m
        ON m.owner_id = g.owner_id
       AND m.membership_status = 'ACTIVE'
       AND m.effective_to IS NULL
       AND m.effective_from <= clock_timestamp()
     WHERE g.oauth_state = 'AUTHORIZED'
       AND g.credential_ciphertext IS NOT NULL
     ORDER BY g.gmail_connection_id, m.is_default_owner DESC NULLS LAST, m.created_at;
$$;

REVOKE ALL ON FUNCTION ops.list_gmail_poll_targets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.list_gmail_poll_targets() TO monytix_api;

-- --------------------------------------------------------------------------
-- 7. Due-date notices record their own currency
--    The eighth parameter is defaulted, so the seven-argument call still works.
-- --------------------------------------------------------------------------
DROP FUNCTION IF EXISTS ops.save_due_date_notification(uuid, uuid, text, text, numeric, date, text);

CREATE OR REPLACE FUNCTION ops.save_due_date_notification(
    p_owner uuid,
    p_connection uuid,
    p_message text,
    p_biller text,
    p_amount numeric,
    p_due date,
    p_category text,
    p_currency text DEFAULT 'INR'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
DECLARE
    v_currency text := upper(btrim(coalesce(p_currency, 'INR')));
BEGIN
    IF v_currency !~ '^[A-Z]{3}$' THEN
        v_currency := 'INR';
    END IF;
    INSERT INTO core.due_date_notification (
        owner_id, gmail_connection_id, gmail_message_id, biller, amount, currency_code, due_date, category
    ) VALUES (p_owner, p_connection, p_message, left(btrim(p_biller), 120), p_amount, v_currency, p_due, p_category)
    ON CONFLICT (gmail_connection_id, biller, due_date) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION ops.save_due_date_notification(uuid, uuid, text, text, numeric, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.save_due_date_notification(uuid, uuid, text, text, numeric, date, text, text) TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'CURRENCY-AWARE-SPOTS',
    'Spot alerts carry detected currency, stated pair, and the owner timezone',
    'OQ-11-open',
    'currency-aware-spots',
    'Booked currency flows to the canonical row. The stated foreign pair lands in original_* with source_fx_rate.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
