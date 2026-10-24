-- The instrument is the phrase attached to the last four.
-- "account ending in 6544" stays an account when a later line says "credit card".

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
    v_phrase text;
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

    v_last4 := substring(btrim(coalesce(p_last4, '')) FROM '^[0-9]{4}$');
    IF v_last4 IS NULL THEN
        v_last4 := (regexp_match(
            coalesce(p_text, ''),
            '(?:a/c|acct|account|card)\s*(?:ending\s*(?:in\s*)?)?(?:no\.?)?\s*[*xX]*([0-9]{4})([^0-9]|$)',
            'i'
        ))[1];
    END IF;

    IF v_last4 IS NOT NULL THEN
        v_phrase := substring(
            v_scan
            FROM '(credit[[:space:]]+card|debit[[:space:]]+card|savings[[:space:]]+account|savings[[:space:]]+a/c|sb[[:space:]]+a/c|account|a/c)'
                || '[[:space:]]*(?:ending[[:space:]]*)?(?:in[[:space:]]*)?(?:(?:no|number)\.?[[:space:]]*)?[*x]*'
                || v_last4
        );
    END IF;

    IF v_phrase ~ '^credit[[:space:]]+card' THEN
        v_kind := 'credit card';
    ELSIF v_phrase ~ '^debit[[:space:]]+card' THEN
        v_kind := 'debit card';
    ELSIF v_phrase IS NOT NULL THEN
        v_kind := 'A/c';
    ELSIF v_scan ~ 'debit[[:space:]]+card' AND v_scan !~ 'credit[[:space:]]+card' THEN
        v_kind := 'debit card';
    ELSIF v_scan ~ '(^|[^a-z])(a/c|account)([^a-z]|$)' AND v_scan ~ 'credit[[:space:]]+card' THEN
        v_kind := 'account';
    ELSIF v_scan ~ 'credit[[:space:]]+card' THEN
        v_kind := 'credit card';
    ELSIF upper(btrim(coalesce(p_channel, ''))) = 'CARD' OR v_scan ~ '(^|[^a-z])card([^a-z]|$)' THEN
        v_kind := 'card';
    ELSE
        v_kind := 'account';
    END IF;

    IF v_bank IS NULL AND v_last4 IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_kind = 'A/c' THEN
        IF v_bank IS NOT NULL AND v_last4 IS NOT NULL THEN
            RETURN v_bank || ' A/c ending in ' || v_last4;
        ELSIF v_bank IS NOT NULL THEN
            RETURN v_bank || ' A/c';
        END IF;
        RETURN 'Account ending in ' || v_last4;
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
    v_explicit_account boolean;
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
        OR v_current ~* '^(hdfc bank|icici bank|axis bank|kotak bank|sbi) (credit card|debit card|card|account|a/c)( ending in [0-9]{4})?$'
        OR v_current ~* '^(credit card|debit card|card|account|a/c) ending in [0-9]{4}$';
    IF NOT v_replaceable THEN
        RETURN;
    END IF;

    v_explicit_account := v_label ~* 'A/c ending in [0-9]{4}$';
    IF coalesce(v_current, '') ~* 'A/c ending in [0-9]{4}$' AND NOT v_explicit_account THEN
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
       AND NOT v_explicit_account
    THEN
        RETURN;
    END IF;

    UPDATE core.financial_account
       SET account_display_name = v_label,
           account_type = CASE
               WHEN v_explicit_account THEN 'SAVINGS'
               ELSE account_type
           END,
           metadata = v_meta,
           updated_at = clock_timestamp()
     WHERE financial_account_id = p_account
       AND (
           account_display_name IS DISTINCT FROM v_label
           OR (v_explicit_account AND account_type IS DISTINCT FROM 'SAVINGS')
       );
END;
$apply$;

REVOKE ALL ON FUNCTION ops.movement_account_label(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.apply_movement_account_label(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.movement_account_label(text, text, text, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.apply_movement_account_label(uuid, text, text, text, text) TO monytix_api;

DO $check$
DECLARE
    v_label text;
    v_id uuid;
    v_name text;
    v_type text;
BEGIN
    v_label := ops.movement_account_label(
        'INR 290.00 debited from your HDFC Bank account ending in 6544 towards FondOf. Apply for a credit card today.',
        'UPI',
        '6544',
        NULL
    );
    IF v_label IS DISTINCT FROM 'HDFC Bank A/c ending in 6544' THEN
        RAISE EXCEPTION 'savings account label failed: %', v_label;
    END IF;

    v_label := ops.movement_account_label(
        'spent on your HDFC Bank credit card ending in 1044 at FIGMA',
        'CARD',
        '1044',
        NULL
    );
    IF v_label IS DISTINCT FROM 'HDFC Bank credit card ending in 1044' THEN
        RAISE EXCEPTION 'credit card label failed: %', v_label;
    END IF;

    v_label := ops.movement_account_label(
        'spent on your HDFC Bank debit card ending in 2222',
        'CARD',
        '2222',
        NULL
    );
    IF v_label IS DISTINCT FROM 'HDFC Bank debit card ending in 2222' THEN
        RAISE EXCEPTION 'debit card label failed: %', v_label;
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
        RAISE EXCEPTION 'debit card purchase label failed: %', v_label;
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

    INSERT INTO core.financial_account (
        account_type, account_display_name, masked_identifier, base_currency_code, lifecycle_status
    ) VALUES (
        'CREDIT_CARD', 'HDFC Bank credit card ending in 6544', '6544', 'INR', 'ACTIVE'
    ) RETURNING financial_account_id INTO v_id;

    PERFORM ops.apply_movement_account_label(
        v_id,
        'INR 290.00 debited from your HDFC Bank account ending in 6544 towards FondOf. Apply for a credit card today.',
        'UPI',
        '6544',
        NULL
    );
    PERFORM ops.apply_movement_account_label(
        v_id,
        'Your HDFC Bank credit card ending in 6544 was used at a store',
        'CARD',
        '6544',
        NULL
    );
    SELECT account_display_name, account_type INTO v_name, v_type
      FROM core.financial_account
     WHERE financial_account_id = v_id;
    IF v_name IS DISTINCT FROM 'HDFC Bank A/c ending in 6544' OR v_type IS DISTINCT FROM 'SAVINGS' THEN
        RAISE EXCEPTION 'account phrase did not replace the credit card name: % %', v_name, v_type;
    END IF;

    UPDATE core.financial_account
       SET account_display_name = 'Household account'
     WHERE financial_account_id = v_id;
    PERFORM ops.apply_movement_account_label(
        v_id,
        'debited from your HDFC Bank account ending in 6544',
        'UPI',
        '6544',
        NULL
    );
    SELECT account_display_name INTO v_name
      FROM core.financial_account
     WHERE financial_account_id = v_id;
    IF v_name IS DISTINCT FROM 'Household account' THEN
        RAISE EXCEPTION 'hand-set account name was replaced: %', v_name;
    END IF;

    DELETE FROM core.financial_account WHERE financial_account_id = v_id;
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
    'ACCOUNT-PHRASE-LABEL',
    'Name the account from the words next to the last four',
    'OQ-11-open',
    'account-phrase-label',
    'An account phrase next to the last four replaces a generated credit-card name. A later credit-card line does not rename it.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
