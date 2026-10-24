-- Classify a merchant from words in the title, and remember a user's category correction.

BEGIN;

INSERT INTO ref.taxonomy_subcategory (taxonomy_version, category_code, subcategory_code, display_name)
VALUES ('F10E-v1.2', 'FOOD_DINING', 'RESTAURANT_DINE_IN', 'Restaurant and bar')
ON CONFLICT (taxonomy_version, subcategory_code) DO NOTHING;

ALTER TABLE core.category_rule
    ADD COLUMN IF NOT EXISTS subcategory_code text;

CREATE OR REPLACE FUNCTION spendsense.classify_movement(
    p_channel text,
    p_counterparty text,
    p_text text,
    p_direction text DEFAULT NULL
) RETURNS TABLE (category_code text, subcategory_code text)
LANGUAGE plpgsql
IMMUTABLE
AS $classify$
DECLARE
    v_channel text := upper(btrim(coalesce(p_channel, '')));
    v_name text := btrim(coalesce(p_counterparty, ''));
    v_upper text := upper(v_name);
    v_direction text := upper(btrim(coalesce(p_direction, '')));
    v_scan text;
    v_category text;
    v_subcategory text;
    v_interest boolean;
    v_tokens text[];
    v_long integer;
    v_initials integer;
    v_blocked text[] := ARRAY[
        'AND','AT','OF','THE','FOR','TO','BY','NEAR','IF','WAS','THIS','YOU','YOUR','NOT','THANK','HOW','KNOW',
        'COFFEE','CAFE','LOUNGE','HOTEL','HOTELS','RESTAURANT','RESTRO','RESORT','RESORTS','STORE','STORES',
        'KIRANA','MART','SHOP','SALON','STUDIO','FITNESS','GYM','PHARMACY','MEDICAL','MEDPLUS','HOSPITAL','CLINIC',
        'PAN','MAHAL','PARLOUR','PARLOR','TEA','BAR','FOOD','FOODS','KITCHEN','BAKERY','FILTER','PAYTM','GPAY',
        'PHONEPE','GOOGLE','AMAZON','SWIGGY','ZOMATO','FLIPKART','NETFLIX','CRED','CLUB','REFUND','PAYMENTS',
        'PAYMENT','ONLINE','INDUSTRIES','INDUSTR','SOLUTIONS','SERVICES','ENTERPRISES','TRADERS','AGENCY',
        'COMPANY','BANK','PVT','LTD','LIMITED','PRIVATE','CORP','LLP','INC','NBFC','FINANCE','LOAN','UPI',
        'MERCHANT','NAGAR','COLONY','PARK','CENTRE','CENTER','POINT','FAMILY','GLAM','FUSION','EXPRESS',
        'AMERICAN','CARD','INOX','PVR','PLAY','TATA','MECHANIC','ELECTRICAL','SANITARY','PACKAGING',
        'MOTOR','TORQUE','EXPERTS','GENERAL','HEALTH','RICE','DEPO','DEPOT','DESIGNER','ADDA','PUFF','WWW','COM',
        'ACKO','SLICE'
    ];
BEGIN
    IF v_channel IN ('CARD_POS', 'CARD_ECOMMERCE', 'POS') THEN
        v_channel := 'CARD';
    END IF;
    IF v_channel = '' THEN
        v_channel := CASE
            WHEN coalesce(p_text, '') ~* '\mIMPS\M' THEN 'IMPS'
            WHEN coalesce(p_text, '') ~* '\mNEFT\M' THEN 'NEFT'
            WHEN coalesce(p_text, '') ~* '\mRTGS\M' THEN 'RTGS'
            WHEN coalesce(p_text, '') ~* '\mUPI\M' THEN 'UPI'
            ELSE ''
        END;
    END IF;

    v_scan := CASE
        WHEN v_upper IN ('', 'UPI PAYMENT', 'CARD PAYMENT', 'ATM WITHDRAWAL', 'TRANSACTION', 'UNKNOWN', 'GENERAL')
            THEN coalesce(p_text, '')
        ELSE v_name
    END;
    v_scan := btrim(regexp_replace(upper(regexp_replace(v_scan, '[^A-Za-z0-9]+', ' ', 'g')), '[[:space:]]+', ' ', 'g'));

    v_interest := v_upper IN ('INTEREST', 'INT.PD', 'INT PD')
        OR v_scan ~ '(^| )INT PD( |$)'
        OR v_scan ~ '(^| )INTEREST PAID( |$)'
        OR coalesce(p_text, '') ~* '(^|[^A-Za-z])int\.?\s*pd([^A-Za-z]|$)';
    IF v_interest THEN
        IF v_direction IN ('', 'IN', 'CREDIT') THEN
            RETURN QUERY SELECT 'FINANCIAL_SERVICES'::text, 'INTEREST_CREDIT'::text;
        ELSE
            RETURN QUERY SELECT NULL::text, NULL::text;
        END IF;
        RETURN;
    END IF;

    v_category := spendsense.merchant_category_code(v_scan);
    v_subcategory := CASE
        WHEN v_scan ~ '(^| )(ZOMATO|SWIGGY)( |$)' THEN 'FOOD_DELIVERY'
        WHEN v_scan ~ '(^| )(BLINKIT|INSTAMART)( |$)' THEN 'GROCERIES_SUPERMARKET'
        WHEN v_scan ~ '(^| )STARBUCKS( |$)' THEN 'COFFEE_AND_CAFES'
        WHEN v_scan ~ '(^| )(UBER|OLA)( |$)' THEN 'TRANSIT_CABS'
        WHEN v_scan ~ '(^| )(FUEL|PETROL|HPCL|BPCL|IOCL)( |$)' THEN 'TRANSIT_FUEL'
        WHEN v_scan ~ '(^| )IRCTC( |$)' THEN 'TRAVEL_RAILWAYS'
        WHEN v_scan ~ '(^| )(JIO|AIRTEL)( |$)' THEN 'MOBILE_INTERNET'
        WHEN v_scan ~ '(^| )(AMAZON|FLIPKART)( |$)' THEN 'ECOMMERCE'
        WHEN v_scan ~ '(^| )(NETFLIX|SPOTIFY|HOTSTAR)( |$)' THEN 'STREAMING_SUBSCRIPTIONS'
        WHEN v_scan ~ '(^| )(PHARMACY|APOLLO|NETMEDS|PHARMEASY)( |$)' THEN 'PHARMACY'
        WHEN v_scan ~ '(^| )(FIGMA|ADOBE|MICROSOFT|GITHUB|CANVA|NOTION|OPENAI|CHATGPT)( |$)' THEN 'SOFTWARE_SUBSCRIPTIONS'
        ELSE NULL
    END;

    IF v_subcategory = 'SOFTWARE_SUBSCRIPTIONS' THEN
        v_category := 'TECHNOLOGY_SERVICES';
    ELSIF v_subcategory = 'ECOMMERCE' AND v_category IS NULL THEN
        v_category := 'SHOPPING_RETAIL';
    ELSIF v_subcategory = 'STREAMING_SUBSCRIPTIONS' AND v_category IS NULL THEN
        v_category := 'ENTERTAINMENT_MEDIA';
    END IF;

    IF v_category IS NOT NULL THEN
        RETURN QUERY SELECT v_category, v_subcategory;
        RETURN;
    END IF;

    IF v_scan ~ '(^| )(COFFEE|CAFE|ESPRESSO|ROASTERS|BAKERY|BAKEHOUSE|TEA|CHAI|TAPRI|LOUNGE)( |$)' THEN
        v_category := 'FOOD_DINING';
        v_subcategory := 'COFFEE_AND_CAFES';
    ELSIF v_scan ~ '(^| )(RESTAURANT|RESTRO|DINER|KITCHEN|DHABA|BHOJANALAYA|BISTRO|TIFFIN|EATERY|GRILL|BBQ|PIZZERIA|BURGER|BIRYANI|SHAWARMA|SWEETS|MITHAI|CHAAT|CATERERS|WINES|WINE|LIQUOR|BAR|PUB|BREWERY|BEER|SPIRITS|THEKA|AHATA|PAAN|TOBACCO)( |$)' THEN
        v_category := 'FOOD_DINING';
        v_subcategory := 'RESTAURANT_DINE_IN';
    ELSIF v_scan ~ '(^| )(SUPERMARKET|HYPERMARKET|GROCERS|GROCERY|PROVISIONS|KIRANA|VEGETABLES|FRUITS|DAIRY)( |$)' THEN
        v_category := 'FOOD_DINING';
        v_subcategory := 'GROCERIES_SUPERMARKET';
    ELSIF v_scan ~ '(^| )(PETROL|DIESEL|FUEL|CNG)( |$)' THEN
        v_category := 'MOBILITY_TRANSPORT';
        v_subcategory := 'TRANSIT_FUEL';
    ELSIF v_scan ~ '(^| )(PHARMACY|CHEMIST|MEDICALS|CLINIC|HOSPITAL|DIAGNOSTICS|PATHOLOGY|LABS)( |$)' THEN
        v_category := 'HEALTH_MEDICAL';
        v_subcategory := 'PHARMACY';
    END IF;

    IF v_category IS NOT NULL THEN
        RETURN QUERY SELECT v_category, v_subcategory;
        RETURN;
    END IF;

    -- A person is a short alphabetic name, including initials ("Kirankumar K V K N").
    -- A shop, brand, or sentence on the same rail stays uncategorized.
    IF v_channel IN ('IMPS', 'NEFT', 'RTGS', 'UPI')
       AND v_name !~ '[0-9@.]'
       AND v_upper ~ '[[:alpha:]]{3,}'
    THEN
        SELECT coalesce(array_agg(token), ARRAY[]::text[])
          INTO v_tokens
          FROM (
              SELECT token
                FROM unnest(regexp_split_to_array(btrim(regexp_replace(v_upper, '[^A-Z]+', ' ', 'g')), '[[:space:]]+')) AS token
               WHERE token <> ''
                 AND token NOT IN ('MR', 'MRS', 'MS', 'SMT', 'SHRI')
          ) names;
        SELECT count(*) FILTER (WHERE length(token) >= 3),
               count(*) FILTER (WHERE length(token) = 1)
          INTO v_long, v_initials
          FROM unnest(v_tokens) AS token;
        IF cardinality(v_tokens) BETWEEN 1 AND 6
           AND v_long BETWEEN 1 AND 4
           AND (v_long >= 2 OR v_initials >= 1)
           AND NOT v_tokens && v_blocked
        THEN
            RETURN QUERY SELECT 'TRANSFER'::text, 'PEER_TO_PEER'::text;
            RETURN;
        END IF;
    END IF;

    RETURN QUERY SELECT NULL::text, NULL::text;
END;
$classify$;

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
            WHEN v_name ~* 'a/c ending in' THEN 'SAVINGS'
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
    v_rule_sub text;
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
        v_rule_sub := NULL;
        v_class_category := NULL;
        v_class_subcategory := NULL;
        IF v_token IS NOT NULL THEN
            SELECT classified.category_code, classified.subcategory_code
              INTO v_class_category, v_class_subcategory
              FROM spendsense.classify_movement(v_channel, v_token, v_description, v_direction) classified;
            SELECT category_code, subcategory_code INTO v_rule, v_rule_sub
              FROM core.category_rule
             WHERE owner_id = v_owner
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

REVOKE ALL ON FUNCTION spendsense.classify_movement(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION spendsense.classify_movement(text, text, text, text) TO monytix_api;

REVOKE ALL ON FUNCTION ops.promote_gmail_spot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.promote_gmail_spot(uuid) TO monytix_api;

REVOKE ALL ON FUNCTION ops.apply_import_categories(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.apply_import_categories(uuid) TO monytix_api;

DROP FUNCTION IF EXISTS ops.set_transaction_category(uuid, uuid, uuid, text, boolean, text);

CREATE FUNCTION ops.set_transaction_category(
    p_actor uuid,
    p_owner uuid,
    p_logical uuid,
    p_category text,
    p_apply_to_past boolean,
    p_match_scope text,
    p_subcategory text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, spendsense, ops, pg_temp
AS $set_category$
DECLARE
    v_description text;
    v_direction text;
    v_parsed jsonb;
    v_counterparty text;
    v_token text;
    v_saved text;
    v_sanitized text;
    v_count integer := 0;
    v_written integer := 0;
    v_other uuid;
    v_other_description text;
    v_other_direction text;
    v_other_parsed jsonb;
    v_other_token text;
BEGIN
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF p_match_scope NOT IN ('EXACT_MERCHANT', 'RAW_TOKEN') THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM ref.taxonomy_category
         WHERE taxonomy_version = 'F10E-v1.2' AND category_code = p_category
    ) THEN
        RETURN jsonb_build_object('outcome', 'invalid_category');
    END IF;
    IF p_subcategory IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ref.taxonomy_subcategory
         WHERE taxonomy_version = 'F10E-v1.2'
           AND category_code = p_category
           AND subcategory_code = p_subcategory
    ) THEN
        RETURN jsonb_build_object('outcome', 'invalid_category');
    END IF;
    SELECT cv.raw_description, cv.direction
      INTO v_description, v_direction
      FROM core.logical_transaction lt
      JOIN core.financial_account fa ON fa.financial_account_id = lt.financial_account_id
      LEFT JOIN core.canonical_transaction_version cv
        ON cv.logical_transaction_id = lt.logical_transaction_id AND cv.is_current
     WHERE lt.logical_transaction_id = p_logical
       AND fa.owner_id = p_owner;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'missing');
    END IF;

    v_parsed := spendsense.parse_narration_v4(coalesce(v_description, ''), coalesce(v_direction, ''));
    v_counterparty := coalesce(v_parsed #>> '{fields,cleaned_counterparty}', v_parsed #>> '{fields,counterparty_name}', '');
    v_sanitized := btrim(regexp_replace(upper(coalesce(v_description, '')), '[^A-Z0-9]+', ' ', 'g'));
    SELECT match_token INTO v_saved
      FROM core.category_choice
     WHERE logical_transaction_id = p_logical
       AND owner_id = p_owner;
    v_token := CASE
        WHEN p_match_scope = 'RAW_TOKEN' THEN v_sanitized
        WHEN nullif(btrim(coalesce(v_saved, '')), '') IS NOT NULL THEN btrim(v_saved)
        ELSE coalesce(
            nullif(btrim(coalesce(spendsense.clean_counterparty_name(v_description), '')), ''),
            nullif(btrim(v_counterparty), '')
        )
    END;
    IF v_token IS NULL OR v_token = '' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    INSERT INTO core.category_choice (
        owner_id, logical_transaction_id, category_code, subcategory_code, match_token, match_scope, is_explicit
    ) VALUES (p_owner, p_logical, p_category, p_subcategory, v_token, p_match_scope, true)
    ON CONFLICT (logical_transaction_id) DO UPDATE
        SET category_code = EXCLUDED.category_code,
            subcategory_code = EXCLUDED.subcategory_code,
            match_token = EXCLUDED.match_token,
            match_scope = EXCLUDED.match_scope,
            is_explicit = true;

    INSERT INTO core.category_rule (owner_id, match_token, match_scope, category_code, subcategory_code)
    VALUES (p_owner, v_token, p_match_scope, p_category, p_subcategory)
    ON CONFLICT (owner_id, match_scope, match_token) DO UPDATE
        SET category_code = EXCLUDED.category_code,
            subcategory_code = EXCLUDED.subcategory_code;

    PERFORM ops.record_movement_weight(p_logical);

    IF p_apply_to_past THEN
        FOR v_other, v_other_description, v_other_direction IN
            SELECT lt.logical_transaction_id, cv.raw_description, cv.direction
              FROM core.logical_transaction lt
              JOIN core.financial_account fa ON fa.financial_account_id = lt.financial_account_id
              JOIN core.canonical_transaction_version cv
                ON cv.logical_transaction_id = lt.logical_transaction_id AND cv.is_current
             WHERE fa.owner_id = p_owner
               AND lt.logical_transaction_id <> p_logical
               AND NOT EXISTS (
                   SELECT 1 FROM core.category_choice existing
                    WHERE existing.owner_id = p_owner
                      AND existing.logical_transaction_id = lt.logical_transaction_id
                      AND existing.is_explicit
               )
        LOOP
            v_other_parsed := spendsense.parse_narration_v4(coalesce(v_other_description, ''), coalesce(v_other_direction, ''));
            IF p_match_scope = 'EXACT_MERCHANT' THEN
                v_other_token := btrim(coalesce(v_other_parsed #>> '{fields,cleaned_counterparty}', ''));
                IF v_other_token IS DISTINCT FROM v_token THEN
                    SELECT choice.match_token INTO v_other_token
                      FROM core.category_choice choice
                     WHERE choice.logical_transaction_id = v_other
                       AND choice.owner_id = p_owner;
                    IF v_other_token IS DISTINCT FROM v_token THEN
                        CONTINUE;
                    END IF;
                END IF;
            ELSE
                v_other_token := btrim(regexp_replace(upper(coalesce(v_other_description, '')), '[^A-Z0-9]+', ' ', 'g'));
                IF position(' ' || v_token || ' ' IN ' ' || v_other_token || ' ') = 0 THEN
                    CONTINUE;
                END IF;
            END IF;
            INSERT INTO core.category_choice (
                owner_id, logical_transaction_id, category_code, subcategory_code, match_token, match_scope, is_explicit
            ) VALUES (p_owner, v_other, p_category, p_subcategory, v_token, p_match_scope, true)
            ON CONFLICT (logical_transaction_id) DO UPDATE
                SET category_code = EXCLUDED.category_code,
                    subcategory_code = EXCLUDED.subcategory_code,
                    match_token = EXCLUDED.match_token,
                    match_scope = EXCLUDED.match_scope,
                    is_explicit = true
              WHERE core.category_choice.is_explicit = false;
            GET DIAGNOSTICS v_written = ROW_COUNT;
            IF v_written > 0 THEN
                v_count := v_count + 1;
                PERFORM ops.record_movement_weight(v_other);
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'outcome', 'updated',
        'body', jsonb_build_object(
            'updated_transaction', jsonb_build_object('id', p_logical, 'category_id', p_category, 'counterparty', v_counterparty),
            'rule_created', jsonb_build_object('match_token', v_token, 'category_id', p_category),
            'retroactive_count', v_count
        )
    );
END;
$set_category$;

REVOKE ALL ON FUNCTION ops.set_transaction_category(uuid, uuid, uuid, text, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.set_transaction_category(uuid, uuid, uuid, text, boolean, text, text) TO monytix_api;

DO $check$
DECLARE
    v_category text;
    v_subcategory text;
BEGIN
    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('UPI', 'FondOf Coffee Lounge at Skyla Kondapur', 'coffee', 'OUT');
    IF v_category IS DISTINCT FROM 'FOOD_DINING' OR v_subcategory IS DISTINCT FROM 'COFFEE_AND_CAFES' THEN
        RAISE EXCEPTION 'coffee lounge classification failed: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('UPI', 'Swiggy', 'Swiggy order', 'OUT');
    IF v_category IS DISTINCT FROM 'FOOD_DINING' OR v_subcategory IS DISTINCT FROM 'FOOD_DELIVERY' THEN
        RAISE EXCEPTION 'food delivery classification failed: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('IMPS', 'Kirankumar K V K N', 'IMPS Kirankumar', 'OUT');
    IF v_category IS DISTINCT FROM 'TRANSFER' OR v_subcategory IS DISTINCT FROM 'PEER_TO_PEER' THEN
        RAISE EXCEPTION 'person transfer classification failed: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('UPI', 'Paytm', 'Paytm', 'OUT');
    IF v_category IS NOT NULL OR v_subcategory IS NOT NULL THEN
        RAISE EXCEPTION 'single-token brand was classified: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('UPI', 'City Wines', 'wine shop', 'OUT');
    IF v_category IS DISTINCT FROM 'FOOD_DINING' OR v_subcategory IS DISTINCT FROM 'RESTAURANT_DINE_IN' THEN
        RAISE EXCEPTION 'wine shop classification failed: % / %', v_category, v_subcategory;
    END IF;
END;
$check$;

DELETE FROM core.category_choice choice
 WHERE choice.is_explicit = false
   AND (
       EXISTS (
           SELECT 1
             FROM core.gmail_spot_transaction s
            WHERE s.logical_transaction_id = choice.logical_transaction_id
       )
       OR EXISTS (
           SELECT 1
             FROM core.source_record_disposition d
            WHERE d.logical_transaction_id = choice.logical_transaction_id
              AND d.outcome IN ('MAPPED', 'LINKED_EXISTING')
       )
   );

WITH candidates AS (
    SELECT s.owner_id,
           s.logical_transaction_id,
           s.channel,
           coalesce(nullif(btrim(cv.raw_description), ''), nullif(btrim(s.counterparty), '')) AS counterparty,
           concat_ws(' ', s.channel, s.counterparty, cv.raw_description) AS body,
           cv.direction
      FROM core.gmail_spot_transaction s
      JOIN core.canonical_transaction_version cv
        ON cv.logical_transaction_id = s.logical_transaction_id
       AND cv.is_current
     WHERE s.logical_transaction_id IS NOT NULL
    UNION ALL
    SELECT own.owner_id,
           d.logical_transaction_id,
           parsed.channel_type,
           coalesce(parsed.cleaned, nullif(btrim(cv.raw_description), '')),
           cv.raw_description,
           cv.direction
      FROM core.source_record_disposition d
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
      CROSS JOIN LATERAL (
          SELECT spendsense.parse_narration_v4(coalesce(cv.raw_description, ''), coalesce(cv.direction, '')) AS doc
      ) p
      CROSS JOIN LATERAL (
          SELECT nullif(btrim(coalesce(p.doc->>'channel_type', '')), '') AS channel_type,
                 nullif(btrim(coalesce(p.doc #>> '{fields,cleaned_counterparty}', '')), '') AS cleaned
      ) parsed
     WHERE d.logical_transaction_id IS NOT NULL
       AND d.outcome IN ('MAPPED', 'LINKED_EXISTING')
       AND NOT EXISTS (
           SELECT 1
             FROM core.gmail_spot_transaction g
            WHERE g.logical_transaction_id = d.logical_transaction_id
       )
),
classified AS (
    SELECT c.owner_id,
           c.logical_transaction_id,
           cls.category_code,
           cls.subcategory_code,
           left(btrim(c.counterparty), 180) AS match_token,
           rule.category_code AS rule_category,
           rule.subcategory_code AS rule_subcategory
      FROM candidates c
      CROSS JOIN LATERAL spendsense.classify_movement(c.channel, c.counterparty, c.body, c.direction) cls
      LEFT JOIN LATERAL (
          SELECT r.category_code, r.subcategory_code
            FROM core.category_rule r
           WHERE r.owner_id = c.owner_id
             AND r.match_scope = 'EXACT_MERCHANT'
             AND r.match_token = left(btrim(c.counterparty), 180)
           LIMIT 1
      ) rule ON true
     WHERE nullif(btrim(coalesce(c.counterparty, '')), '') IS NOT NULL
),
resolved AS (
    SELECT owner_id,
           logical_transaction_id,
           coalesce(rule_category, category_code) AS category_code,
           CASE
               WHEN rule_category IS NOT NULL AND rule_subcategory IS NOT NULL THEN rule_subcategory
               WHEN rule_category IS NULL OR rule_category = category_code THEN subcategory_code
               ELSE NULL
           END AS subcategory_code,
           match_token
      FROM classified
     WHERE coalesce(rule_category, category_code) IS NOT NULL
       AND nullif(btrim(match_token), '') IS NOT NULL
)
INSERT INTO core.category_choice (
    owner_id, logical_transaction_id, category_code, subcategory_code, match_token, match_scope, is_explicit
)
SELECT DISTINCT ON (logical_transaction_id)
       owner_id, logical_transaction_id, category_code, subcategory_code, match_token, 'EXACT_MERCHANT', false
  FROM resolved
 ORDER BY logical_transaction_id
ON CONFLICT (logical_transaction_id) DO UPDATE
    SET category_code = EXCLUDED.category_code,
        subcategory_code = EXCLUDED.subcategory_code,
        match_token = EXCLUDED.match_token
  WHERE core.category_choice.is_explicit = false;

DO $weights$
DECLARE
    v_logical uuid;
BEGIN
    FOR v_logical IN
        SELECT logical_transaction_id
          FROM core.gmail_spot_transaction
         WHERE logical_transaction_id IS NOT NULL
        UNION
        SELECT logical_transaction_id
          FROM core.source_record_disposition
         WHERE logical_transaction_id IS NOT NULL
           AND outcome IN ('MAPPED', 'LINKED_EXISTING')
    LOOP
        PERFORM ops.record_movement_weight(v_logical);
    END LOOP;
END;
$weights$;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'DESCRIPTOR-CATEGORY',
    'Classify merchants from title words and remember a user category',
    'OQ-11-open',
    'descriptor-category',
    'Coffee, lounge, restaurant, and the other title words get a category. A phone correction is stored on the merchant rule.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
