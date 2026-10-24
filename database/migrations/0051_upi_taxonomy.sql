-- Indian UPI brands, shop words, personal VPAs, and rent on the classifier the phone reads.

BEGIN;

INSERT INTO ref.taxonomy_subcategory (taxonomy_version, category_code, subcategory_code, display_name)
VALUES ('F10E-v1.2', 'HOUSING_HOME', 'RENT', 'Rent')
ON CONFLICT (taxonomy_version, subcategory_code) DO NOTHING;

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
    v_vpa text[];
    v_local text;
    v_handle text;
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
        'ACKO','SLICE','SMOKE','CIGAR','BEEDI','MESS','MILK','DOODH','SABJI','TAXI','CAB','CABS','RENT','EMI',
        'DIESEL','CNG','SHELL','ZEPTO','RAPIDO','GROWW','ZERODHA'
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
    -- A VPA handle is not a merchant. swiggy@paytm is judged on "swiggy", not on "paytm" or "jio".
    v_vpa := regexp_match(v_upper, '^([A-Z0-9][A-Z0-9._-]*)@([A-Z][A-Z0-9]*)$');
    IF v_vpa IS NOT NULL THEN
        v_scan := btrim(regexp_replace(upper(regexp_replace(v_vpa[1], '[^A-Za-z0-9]+', ' ', 'g')), '[[:space:]]+', ' ', 'g'));
    END IF;

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

    IF v_scan ~ '(^| )(ZOMATO|SWIGGY|BUNDL)( |$)' OR v_scan ~ '(^| )MCDONALD' THEN
        v_category := 'FOOD_DINING';
        v_subcategory := 'FOOD_DELIVERY';
    ELSIF v_scan ~ '(^| )(BLINKIT|INSTAMART|ZEPTO|BIGBASKET|DMART)( |$)'
       OR v_scan ~ '(^| )BIG BASKET( |$)' THEN
        v_category := 'FOOD_DINING';
        v_subcategory := 'GROCERIES_SUPERMARKET';
    ELSIF v_scan ~ '(^| )STARBUCKS( |$)' THEN
        v_category := 'FOOD_DINING';
        v_subcategory := 'COFFEE_AND_CAFES';
    ELSIF v_scan ~ '(^| )(UBER|OLA|RAPIDO)( |$)' OR v_scan ~ '(^| )NAMMA YATRI( |$)' THEN
        v_category := 'MOBILITY_TRANSPORT';
        v_subcategory := 'TRANSIT_CABS';
    ELSIF v_scan ~ '(^| )(FUEL|PETROL|DIESEL|CNG|HPCL|BPCL|IOCL|SHELL)( |$)'
       OR v_scan ~ '(^| )INDIAN OIL( |$)' THEN
        v_category := 'MOBILITY_TRANSPORT';
        v_subcategory := 'TRANSIT_FUEL';
    ELSIF v_scan ~ '(^| )IRCTC( |$)' THEN
        v_category := 'TRAVEL';
        v_subcategory := 'TRAVEL_RAILWAYS';
    ELSIF v_scan ~ '(^| )(JIO|AIRTEL)( |$)' THEN
        v_category := 'UTILITIES_COMMUNICATION';
        v_subcategory := 'MOBILE_INTERNET';
    ELSIF v_scan ~ '(^| )(NETFLIX|SPOTIFY|HOTSTAR|ITUNES|APPLESERVICES|YOUTUBE|DISNEY|PLAYSTATION|XBOX|STEAM)( |$)'
       OR v_scan ~ '(^| )(PRIME VIDEO|AMAZON PRIME|APPLE COM BILL|APPLE BILL|APPLE SERVICES|PLAY STATION)( |$)' THEN
        v_category := 'ENTERTAINMENT_MEDIA';
        v_subcategory := 'STREAMING_SUBSCRIPTIONS';
    ELSIF v_scan ~ '(^| )(AMAZON|FLIPKART)( |$)' THEN
        v_category := 'SHOPPING_RETAIL';
        v_subcategory := 'ECOMMERCE';
    ELSIF v_scan ~ '(^| )(PHARMACY|APOLLO|NETMEDS|PHARMEASY|1MG)( |$)'
       OR v_scan ~ '(^| )TATA 1MG( |$)' THEN
        v_category := 'HEALTH_MEDICAL';
        v_subcategory := 'PHARMACY';
    ELSIF v_scan ~ '(^| )(FIGMA|ADOBE|MICROSOFT|GITHUB|CANVA|NOTION|OPENAI|CHATGPT)( |$)' THEN
        v_category := 'TECHNOLOGY_SERVICES';
        v_subcategory := 'SOFTWARE_SUBSCRIPTIONS';
    ELSIF v_scan ~ '(^| )(ZERODHA|GROWW|UPSTOX|CAMS|KFINTECH|KARVY)( |$)'
       OR v_scan ~ '(^| )(ANGEL ONE|MUTUAL FUND)( |$)' THEN
        v_category := 'FINANCIAL_SERVICES';
        v_subcategory := 'SIP_AUTO_DEBIT';
    ELSIF v_scan ~ '(^| )(SMFG|FULLERTON|KREDITBEE|KRAZYBEE|DMI|EMI|LOAN)( |$)'
       OR v_scan ~ '(^| )(BAJAJ FINANCE|BAJAJ FINSERV|TATA CAPITAL|HOME CREDIT|DMI FINANCE)( |$)' THEN
        v_category := 'FINANCIAL_SERVICES';
        v_subcategory := 'LOAN_EMI';
    ELSIF v_scan ~ '(^| )(CRED|CHEQ|AMEX|BILLDESK)( |$)'
       OR v_scan ~ '(^| )(AMERICAN EXPRESS|SBI CARD|HDFC CARD)( |$)' THEN
        v_category := 'FINANCIAL_SERVICES';
        v_subcategory := 'CREDIT_CARD_BILL';
    END IF;

    IF v_category IS NOT NULL THEN
        RETURN QUERY SELECT v_category, v_subcategory;
        RETURN;
    END IF;

    IF v_scan ~ '(^| )(COFFEE|CAFE|ESPRESSO|ROASTERS|BAKERY|BAKEHOUSE|TEA|CHAI|TAPRI|LOUNGE)( |$)' THEN
        v_category := 'FOOD_DINING';
        v_subcategory := 'COFFEE_AND_CAFES';
    ELSIF v_scan ~ '(^| )(RESTAURANT|RESTRO|DINER|KITCHEN|DHABA|BHOJANALAYA|BISTRO|TIFFIN|EATERY|GRILL|BBQ|PIZZERIA|BURGER|BIRYANI|SHAWARMA|SWEETS|MITHAI|CHAAT|CATERERS|WINES|WINE|LIQUOR|BAR|PUB|BREWERY|BEER|SPIRITS|THEKA|AHATA|PAAN|TOBACCO|SMOKE|CIGAR|BEEDI|MESS)( |$)'
       OR v_scan ~ '(^| )PAN (STORE|SHOP)( |$)'
       OR v_scan ~ '(^| )(STORE|SHOP) PAN( |$)' THEN
        v_category := 'FOOD_DINING';
        v_subcategory := 'RESTAURANT_DINE_IN';
    ELSIF v_scan ~ '(^| )(SUPERMARKET|HYPERMARKET|GROCERS|GROCERY|PROVISIONS|KIRANA|VEGETABLES|FRUITS|DAIRY|MILK|DOODH|SABJI)( |$)' THEN
        v_category := 'FOOD_DINING';
        v_subcategory := 'GROCERIES_SUPERMARKET';
    ELSIF v_scan ~ '(^| )(PETROL|DIESEL|FUEL|CNG)( |$)' THEN
        v_category := 'MOBILITY_TRANSPORT';
        v_subcategory := 'TRANSIT_FUEL';
    ELSIF v_scan ~ '(^| )(PHARMACY|CHEMIST|MEDICALS|CLINIC|HOSPITAL|DIAGNOSTICS|PATHOLOGY|LABS)( |$)' THEN
        v_category := 'HEALTH_MEDICAL';
        v_subcategory := 'PHARMACY';
    ELSIF v_scan ~ '(^| )(TAXI|CAB|CABS)( |$)'
       OR (v_scan ~ '(^| )AUTO( |$)' AND v_scan !~ '(^| )AUTO DEBIT( |$)') THEN
        v_category := 'MOBILITY_TRANSPORT';
        v_subcategory := 'TRANSIT_CABS';
    ELSIF v_scan ~ '(^| )RENT( |$)' THEN
        v_category := 'HOUSING_HOME';
        v_subcategory := 'RENT';
    END IF;

    IF v_category IS NOT NULL THEN
        RETURN QUERY SELECT v_category, v_subcategory;
        RETURN;
    END IF;

    -- A consumer VPA with no shop word is a person. Business handles such as @okbiz stay out.
    IF v_channel IN ('IMPS', 'NEFT', 'RTGS', 'UPI') THEN
        v_vpa := regexp_match(v_upper, '([A-Z0-9][A-Z0-9._-]*)@([A-Z][A-Z0-9]*)');
        IF v_vpa IS NOT NULL THEN
            v_local := v_vpa[1];
            v_handle := v_vpa[2];
            IF v_handle IN (
                'OKHDFCBANK', 'OKICICI', 'OKSBI', 'OKAXIS', 'YBL', 'PAYTM', 'IBL', 'AXL', 'APL', 'RAPL',
                'WAAXIS', 'WAHDFCBANK', 'WAICICI', 'WASBI', 'ABFSPAY', 'FREECHARGE', 'NAVIAXIS',
                'YESBANK', 'IDFCBANK', 'AXISBANK', 'ICICI', 'SBI', 'HDFCBANK', 'FBL', 'KOTAK', 'PNB',
                'IDBI', 'UNIONBANK', 'INDUS', 'JIO', 'PINGPAY', 'RBL', 'UBOI'
            ) THEN
                SELECT coalesce(array_agg(token), ARRAY[]::text[])
                  INTO v_tokens
                  FROM (
                      SELECT token
                        FROM unnest(regexp_split_to_array(btrim(regexp_replace(v_local, '[^A-Z]+', ' ', 'g')), '[[:space:]]+')) AS token
                       WHERE token <> ''
                  ) names;
                IF NOT v_tokens && v_blocked THEN
                    RETURN QUERY SELECT 'TRANSFER'::text, 'PEER_TO_PEER'::text;
                    RETURN;
                END IF;
            END IF;
        END IF;
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

REVOKE ALL ON FUNCTION spendsense.classify_movement(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION spendsense.classify_movement(text, text, text, text) TO monytix_api;

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
    ELSIF v_subcategory IN ('TRANSIT_CABS', 'TRANSIT_FUEL') OR v_category = 'MOBILITY_TRANSPORT' THEN
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
    ELSIF v_subcategory = 'RENT' OR v_category = 'HOUSING_HOME' THEN
        v_primary := 'W04_OBLIGATIONS';
        v_secondary := NULL;
    ELSIF v_subcategory = 'PHARMACY' OR v_category = 'HEALTH_MEDICAL' THEN
        v_primary := 'W04_OBLIGATIONS';
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

DO $check$
DECLARE
    v_category text;
    v_subcategory text;
    v_primary text;
BEGIN
    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('UPI', 'CONNECT PAN STORE', 'CONNECT PAN STORE', 'OUT');
    IF v_category IS DISTINCT FROM 'FOOD_DINING' OR v_subcategory IS DISTINCT FROM 'RESTAURANT_DINE_IN' THEN
        RAISE EXCEPTION 'pan store classification failed: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('UPI', 'INCOME TAX PAN CARD', 'PAN CARD', 'OUT');
    IF v_category IS NOT NULL OR v_subcategory IS NOT NULL THEN
        RAISE EXCEPTION 'pan card was classified: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('UPI', 'FondOf Coffee Lounge at Skyla Kondapur', 'coffee', 'OUT');
    IF v_category IS DISTINCT FROM 'FOOD_DINING' OR v_subcategory IS DISTINCT FROM 'COFFEE_AND_CAFES' THEN
        RAISE EXCEPTION 'coffee lounge classification failed: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('UPI', 'rahul@ybl', 'rahul@ybl', 'OUT');
    IF v_category IS DISTINCT FROM 'TRANSFER' OR v_subcategory IS DISTINCT FROM 'PEER_TO_PEER' THEN
        RAISE EXCEPTION 'personal vpa classification failed: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('UPI', 'swiggy@paytm', 'swiggy@paytm', 'OUT');
    IF v_category IS DISTINCT FROM 'FOOD_DINING' OR v_subcategory IS DISTINCT FROM 'FOOD_DELIVERY' THEN
        RAISE EXCEPTION 'swiggy vpa classification failed: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('UPI', 'Swiggy', 'Swiggy', 'OUT');
    IF v_category IS DISTINCT FROM 'FOOD_DINING' OR v_subcategory IS DISTINCT FROM 'FOOD_DELIVERY' THEN
        RAISE EXCEPTION 'swiggy classification failed: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('UPI', 'BRAMPTON', 'INR 50', 'OUT');
    IF v_category IS NOT NULL OR v_subcategory IS NOT NULL THEN
        RAISE EXCEPTION 'small unknown name was classified: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('UPI', 'ramesh@okbizaxis', 'ramesh@okbizaxis', 'OUT');
    IF v_category IS NOT NULL OR v_subcategory IS NOT NULL THEN
        RAISE EXCEPTION 'business vpa was classified: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_movement('UPI', 'HOUSE RENT', 'HOUSE RENT', 'OUT');
    IF v_category IS DISTINCT FROM 'HOUSING_HOME' OR v_subcategory IS DISTINCT FROM 'RENT' THEN
        RAISE EXCEPTION 'rent classification failed: % / %', v_category, v_subcategory;
    END IF;

    SELECT primary_weight_code INTO v_primary
      FROM spendsense.assign_movement_weight('MOBILITY_TRANSPORT', 'TRANSIT_CABS', 'UPI', 'OUT', 180);
    IF v_primary IS DISTINCT FROM 'W04_OBLIGATIONS' THEN
        RAISE EXCEPTION 'cab weight failed: %', v_primary;
    END IF;

    SELECT primary_weight_code INTO v_primary
      FROM spendsense.assign_movement_weight('HOUSING_HOME', 'RENT', 'UPI', 'OUT', 12000);
    IF v_primary IS DISTINCT FROM 'W04_OBLIGATIONS' THEN
        RAISE EXCEPTION 'rent weight failed: %', v_primary;
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
    'UPI-TAXONOMY',
    'Classify Indian UPI brands, personal VPAs, and rent',
    'OQ-11-open',
    'upi-taxonomy',
    'Brand and shop words use the existing taxonomy. A consumer VPA with no shop word is a peer transfer. Rent is housing.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
