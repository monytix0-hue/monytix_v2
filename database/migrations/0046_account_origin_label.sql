-- Name an account from the bank, instrument, and last four that the source actually mentioned.

BEGIN;

CREATE OR REPLACE FUNCTION ops.movement_account_label(
    p_text text,
    p_channel text,
    p_last4 text,
    p_bank text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $label$
DECLARE
    v_scan text := regexp_replace(lower(coalesce(p_text, '')), '@[a-z0-9.]+', ' ', 'g');
    v_found text[] := ARRAY[]::text[];
    v_hint text;
    v_bank text;
    v_kind text;
    v_last4 text;
    v_head text;
BEGIN
    IF v_scan ~ 'hdfc' THEN
        v_found := array_append(v_found, 'HDFC Bank');
    END IF;
    IF v_scan ~ 'icici[[:space:]]*bank' OR v_scan ~ 'icicibank' THEN
        v_found := array_append(v_found, 'ICICI Bank');
    END IF;
    IF v_scan ~ '(^|[^a-z])sbi([^a-z]|$)' OR v_scan ~ 'sbin' OR v_scan ~ 'state bank' THEN
        v_found := array_append(v_found, 'SBI');
    END IF;
    IF v_scan ~ 'axis[[:space:]]*bank' OR v_scan ~ 'axisbank' OR v_scan ~ '(^|[^a-z])utib([^a-z]|$)' THEN
        v_found := array_append(v_found, 'Axis Bank');
    END IF;
    IF v_scan ~ 'kotak' THEN
        v_found := array_append(v_found, 'Kotak Bank');
    END IF;

    v_hint := CASE upper(btrim(coalesce(p_bank, '')))
        WHEN 'HDFC' THEN 'HDFC Bank'
        WHEN 'ICICI' THEN 'ICICI Bank'
        WHEN 'SBI' THEN 'SBI'
        WHEN 'AXIS' THEN 'Axis Bank'
        WHEN 'KOTAK' THEN 'Kotak Bank'
        ELSE NULL
    END;
    IF v_hint IS NOT NULL AND NOT v_hint = ANY (v_found) THEN
        v_found := array_append(v_found, v_hint);
    END IF;
    IF cardinality(v_found) = 1 THEN
        v_bank := v_found[1];
    END IF;

    IF v_scan ~ 'credit[[:space:]]+card' THEN
        v_kind := 'credit card';
    ELSIF v_scan ~ 'debit[[:space:]]+card' THEN
        v_kind := 'debit card';
    ELSIF upper(btrim(coalesce(p_channel, ''))) = 'CARD' OR v_scan ~ '(^|[^a-z])card([^a-z]|$)' THEN
        v_kind := 'card';
    ELSE
        v_kind := 'account';
    END IF;

    v_last4 := substring(btrim(coalesce(p_last4, '')) FROM '^[0-9]{4}$');
    IF v_last4 IS NULL THEN
        v_last4 := (regexp_match(
            coalesce(p_text, ''),
            '(?:a/c|acct|account|card)\s*(?:ending\s*(?:in\s*)?)?(?:no\.?)?\s*[*xX]*([0-9]{4})([^0-9]|$)',
            'i'
        ))[1];
    END IF;

    IF v_bank IS NULL AND v_last4 IS NULL THEN
        RETURN NULL;
    END IF;

    v_head := CASE v_kind
        WHEN 'credit card' THEN 'Credit card'
        WHEN 'debit card' THEN 'Debit card'
        WHEN 'card' THEN 'Card'
        ELSE 'Account'
    END;

    IF v_bank IS NOT NULL AND v_last4 IS NOT NULL THEN
        RETURN v_bank || ' ' || v_kind || ' ending in ' || v_last4;
    ELSIF v_bank IS NOT NULL THEN
        RETURN v_bank || ' ' || v_kind;
    END IF;
    RETURN v_head || ' ending in ' || v_last4;
END;
$label$;

CREATE OR REPLACE FUNCTION ops.apply_movement_account_label(
    p_account uuid,
    p_text text,
    p_channel text,
    p_last4 text,
    p_bank text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $apply$
DECLARE
    v_current text;
    v_mask text;
    v_meta jsonb;
    v_label text;
    v_plain text;
    v_last4 text;
    v_current_bank text;
    v_new_bank text;
    v_current_rank integer;
    v_new_rank integer;
    v_replaceable boolean;
BEGIN
    IF p_account IS NULL THEN
        RETURN;
    END IF;
    SELECT account_display_name, masked_identifier, metadata
      INTO v_current, v_mask, v_meta
      FROM core.financial_account
     WHERE financial_account_id = p_account
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_last4 := substring(btrim(coalesce(v_mask, '')) FROM '^[0-9]{4}$');
    IF v_last4 IS NULL THEN
        IF coalesce(v_meta->>'label_last4_conflict', '') = 'true' THEN
            v_last4 := NULL;
        ELSE
            v_last4 := substring(btrim(coalesce(p_last4, '')) FROM '^[0-9]{4}$');
            IF v_last4 IS NOT NULL AND coalesce(v_meta->>'label_last4', '') NOT IN ('', v_last4) THEN
                UPDATE core.financial_account
                   SET metadata = v_meta || jsonb_build_object('label_last4_conflict', true),
                       updated_at = clock_timestamp()
                 WHERE financial_account_id = p_account;
                RETURN;
            ELSIF v_last4 IS NOT NULL THEN
                v_meta := v_meta || jsonb_build_object('label_last4', v_last4);
            END IF;
        END IF;
    END IF;

    v_label := ops.movement_account_label(p_text, p_channel, v_last4, p_bank);
    IF coalesce(v_meta->>'label_bank_conflict', '') = 'true' AND v_label IS NOT NULL THEN
        v_label := regexp_replace(v_label, '^(HDFC Bank|ICICI Bank|Axis Bank|Kotak Bank|SBI) ', '');
        IF v_label ~ '^[a-z]' THEN
            v_label := upper(left(v_label, 1)) || substring(v_label FROM 2);
        END IF;
        IF v_label !~ 'ending in [0-9]{4}$' THEN
            v_label := NULL;
        END IF;
    END IF;
    IF v_label IS NULL THEN
        IF v_meta IS DISTINCT FROM (SELECT metadata FROM core.financial_account WHERE financial_account_id = p_account) THEN
            UPDATE core.financial_account
               SET metadata = v_meta, updated_at = clock_timestamp()
             WHERE financial_account_id = p_account;
        END IF;
        RETURN;
    END IF;

    v_current_bank := substring(coalesce(v_current, '') FROM '^(HDFC Bank|ICICI Bank|Axis Bank|Kotak Bank|SBI) ');
    v_new_bank := substring(v_label FROM '^(HDFC Bank|ICICI Bank|Axis Bank|Kotak Bank|SBI) ');
    v_plain := CASE
        WHEN v_last4 IS NULL THEN NULL
        ELSE upper(left(regexp_replace(v_label, '^(HDFC Bank|ICICI Bank|Axis Bank|Kotak Bank|SBI) ', ''), 1))
             || substring(regexp_replace(v_label, '^(HDFC Bank|ICICI Bank|Axis Bank|Kotak Bank|SBI) ', '') FROM 2)
    END;
    IF v_plain IS NOT NULL AND v_plain !~ 'ending in [0-9]{4}$' THEN
        v_plain := NULL;
    END IF;

    IF v_current_bank IS NOT NULL AND v_new_bank IS NOT NULL AND v_current_bank IS DISTINCT FROM v_new_bank THEN
        UPDATE core.financial_account
           SET account_display_name = coalesce(v_plain, v_current),
               metadata = v_meta || jsonb_build_object('label_bank_conflict', true),
               updated_at = clock_timestamp()
         WHERE financial_account_id = p_account;
        RETURN;
    END IF;

    v_replaceable := btrim(coalesce(v_current, '')) = ''
        OR v_current ~* '^(gmail account|personal account)$'
        OR v_current ~* '^(hdfc bank|icici bank|axis bank|kotak bank|sbi) (credit card|debit card|card|account)( ending in [0-9]{4})?$'
        OR v_current ~* '^(credit card|debit card|card|account) ending in [0-9]{4}$';
    IF NOT v_replaceable THEN
        RETURN;
    END IF;

    v_current_rank := CASE
        WHEN v_current ~* 'credit card' THEN 3
        WHEN v_current ~* 'debit card' THEN 2
        WHEN v_current ~* '(^| )card( |$)' THEN 1
        ELSE 0
    END;
    v_new_rank := CASE
        WHEN v_label ~* 'credit card' THEN 3
        WHEN v_label ~* 'debit card' THEN 2
        WHEN v_label ~* '(^| )card( |$)' THEN 1
        ELSE 0
    END;
    IF v_current_bank IS NOT NULL
       AND v_current_bank IS NOT DISTINCT FROM v_new_bank
       AND v_new_rank < v_current_rank
       AND coalesce(v_current, '') ~ 'ending in [0-9]{4}$'
    THEN
        RETURN;
    END IF;

    UPDATE core.financial_account
       SET account_display_name = v_label,
           metadata = v_meta,
           updated_at = clock_timestamp()
     WHERE financial_account_id = p_account
       AND account_display_name IS DISTINCT FROM v_label;
END;
$apply$;

CREATE OR REPLACE FUNCTION ops.name_bound_statement_account(p_document uuid, p_bank text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $statement$
DECLARE
    v_account uuid;
    v_text text;
    v_mask text;
BEGIN
    FOR v_account, v_text, v_mask IN
        SELECT si.financial_account_id,
               concat_ws(' ', sd.original_filename, sd.metadata #>> '{source_metadata,sender}'),
               fa.masked_identifier
          FROM core.statement_instance si
          JOIN core.source_document sd ON sd.source_document_id = si.source_document_id
          JOIN core.financial_account fa ON fa.financial_account_id = si.financial_account_id
         WHERE si.source_document_id = p_document
           AND si.financial_account_id IS NOT NULL
    LOOP
        PERFORM ops.apply_movement_account_label(
            v_account,
            v_text,
            NULL,
            CASE WHEN v_mask ~ '^[0-9]{4}$' THEN v_mask ELSE NULL END,
            p_bank
        );
    END LOOP;
END;
$statement$;

REVOKE ALL ON FUNCTION ops.movement_account_label(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.apply_movement_account_label(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.name_bound_statement_account(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.movement_account_label(text, text, text, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.apply_movement_account_label(uuid, text, text, text, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.name_bound_statement_account(uuid, text) TO monytix_api;

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
    RETURN v_logical;
END;
$promote$;

REVOKE ALL ON FUNCTION ops.promote_gmail_spot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.promote_gmail_spot(uuid) TO monytix_api;

DO $check$
DECLARE
    v_label text;
BEGIN
    v_label := ops.movement_account_label(
        'Your HDFC Bank Credit Card ending 1044 was used at FIGMA',
        'CARD',
        '1044',
        NULL
    );
    IF v_label IS DISTINCT FROM 'HDFC Bank credit card ending in 1044' THEN
        RAISE EXCEPTION 'credit card label failed: %', v_label;
    END IF;

    v_label := ops.movement_account_label('debited from your account', 'UPI', '6544', NULL);
    IF v_label IS DISTINCT FROM 'Account ending in 6544' THEN
        RAISE EXCEPTION 'account last4 label failed: %', v_label;
    END IF;

    v_label := ops.movement_account_label('card payment', 'CARD', '1044', NULL);
    IF v_label IS DISTINCT FROM 'Card ending in 1044' THEN
        RAISE EXCEPTION 'card label failed: %', v_label;
    END IF;

    v_label := ops.movement_account_label('Debit card purchase', 'CARD', '2222', NULL);
    IF v_label IS DISTINCT FROM 'Debit card ending in 2222' THEN
        RAISE EXCEPTION 'debit card label failed: %', v_label;
    END IF;

    v_label := ops.movement_account_label('UPI payment (@icici)', 'UPI', '6544', NULL);
    IF v_label IS DISTINCT FROM 'Account ending in 6544' THEN
        RAISE EXCEPTION 'vpa was treated as the account bank: %', v_label;
    END IF;

    v_label := ops.movement_account_label(
        'HDFC Bank transfer to ICICI Bank account ending 6544',
        'NEFT',
        '6544',
        NULL
    );
    IF v_label IS DISTINCT FROM 'Account ending in 6544' THEN
        RAISE EXCEPTION 'two banks were collapsed to one: %', v_label;
    END IF;

    v_label := ops.movement_account_label('paid Kirankumar', 'IMPS', NULL, NULL);
    IF v_label IS NOT NULL THEN
        RAISE EXCEPTION 'unmentioned account was named: %', v_label;
    END IF;

    v_label := ops.movement_account_label('statement', NULL, NULL, 'HDFC');
    IF v_label IS DISTINCT FROM 'HDFC Bank account' THEN
        RAISE EXCEPTION 'statement bank hint failed: %', v_label;
    END IF;
END;
$check$;

DO $backfill$
DECLARE
    v_row record;
BEGIN
    FOR v_row IN
        SELECT cv.financial_account_id AS account_id,
               s.raw_excerpt,
               s.channel,
               s.account_last4
          FROM core.gmail_spot_transaction s
          JOIN core.canonical_transaction_version cv
            ON cv.logical_transaction_id = s.logical_transaction_id
           AND cv.is_current
         WHERE cv.financial_account_id IS NOT NULL
         ORDER BY s.created_at
    LOOP
        PERFORM ops.apply_movement_account_label(
            v_row.account_id, v_row.raw_excerpt, v_row.channel, v_row.account_last4, NULL
        );
    END LOOP;

    FOR v_row IN
        SELECT DISTINCT source_document_id
          FROM core.statement_instance
         WHERE financial_account_id IS NOT NULL
    LOOP
        PERFORM ops.name_bound_statement_account(v_row.source_document_id, NULL);
    END LOOP;
END;
$backfill$;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'ACCOUNT-ORIGIN-LABEL',
    'Name accounts from the bank, instrument, and last four in the source',
    'OQ-11-open',
    'account-origin-label',
    'Display names use only a bank, card, or last four that the alert or statement mentioned.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
