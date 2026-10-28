-- Currency support made the ledger able to hold money in any currency. This
-- migration makes the *labels* work for those rows: a country-aware merchant
-- classifier beside the Indian one, the subcategory codes it can return, and
-- the institution reference rows that identify a foreign sender.
--
-- Two rules inherited from the taxonomy itself:
--   * `'F10E-v1.2'` is not forked. The category codes are already
--     country-neutral and 100+ call sites name the version literally.
--   * The Indian classifier stays exactly as it is. `classify_movement` remains
--     the `IN` pack, and `classify_merchant_global` delegates to it, so an
--     existing mailbox classifies byte-for-byte as before.

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Subcategory codes the global classifier can return.
--    Every code is filed under an existing F10E-v1.2 category; nothing new is
--    invented at call time. `ON CONFLICT DO NOTHING` keeps this re-runnable.
-- --------------------------------------------------------------------------
INSERT INTO ref.taxonomy_subcategory (taxonomy_version, category_code, subcategory_code, display_name) VALUES
    ('F10E-v1.2', 'FOOD_DINING',             'BAKERY_CAFE',        'Bakery and cafe'),
    ('F10E-v1.2', 'GROCERIES_HOUSEHOLD',     'GROCERY_STORE',      'Supermarket and grocery store'),
    ('F10E-v1.2', 'GROCERIES_HOUSEHOLD',     'HOUSEHOLD_SUPPLIES', 'Household supplies'),
    ('F10E-v1.2', 'HOUSING_HOME',            'MORTGAGE_PAYMENT',   'Mortgage payment'),
    ('F10E-v1.2', 'HOUSING_HOME',            'HOME_MAINTENANCE',   'Home maintenance and repair'),
    ('F10E-v1.2', 'HOUSING_HOME',            'PROPERTY_FEES',      'Property fees and service charges'),
    ('F10E-v1.2', 'UTILITIES_COMMUNICATION', 'ELECTRICITY_GAS',    'Electricity and gas'),
    ('F10E-v1.2', 'UTILITIES_COMMUNICATION', 'WATER_SEWER',        'Water and sewerage'),
    ('F10E-v1.2', 'UTILITIES_COMMUNICATION', 'BROADBAND',          'Broadband and cable'),
    ('F10E-v1.2', 'MOBILITY_TRANSPORT',      'PUBLIC_TRANSIT',     'Public transport'),
    ('F10E-v1.2', 'MOBILITY_TRANSPORT',      'PARKING_TOLLS',      'Parking and tolls'),
    ('F10E-v1.2', 'MOBILITY_TRANSPORT',      'CONVENIENCE_FUEL',   'Convenience store on a fuel forecourt'),
    ('F10E-v1.2', 'TRAVEL',                  'HOTEL_LODGING',      'Hotel and lodging'),
    ('F10E-v1.2', 'TRAVEL',                  'CAR_RENTAL',         'Car rental'),
    ('F10E-v1.2', 'HEALTH_MEDICAL',          'HOSPITAL_CLINIC',    'Hospital and clinic'),
    ('F10E-v1.2', 'HEALTH_MEDICAL',          'DENTAL_OPTICAL',     'Dental and optical'),
    ('F10E-v1.2', 'EDUCATION_LEARNING',      'TUITION_FEES',       'Tuition and school fees'),
    ('F10E-v1.2', 'EDUCATION_LEARNING',      'ONLINE_COURSES',     'Online courses'),
    ('F10E-v1.2', 'EDUCATION_LEARNING',      'BOOKS_SUPPLIES',     'Books and study supplies'),
    ('F10E-v1.2', 'SHOPPING_RETAIL',         'CLOTHING_APPAREL',   'Clothing and apparel'),
    ('F10E-v1.2', 'SHOPPING_RETAIL',         'ELECTRONICS',        'Electronics and appliances'),
    ('F10E-v1.2', 'SHOPPING_RETAIL',         'HOME_FURNISHING',    'Furniture and furnishings'),
    ('F10E-v1.2', 'PERSONAL_CARE',           'BEAUTY_PRODUCTS',    'Beauty and personal care products'),
    ('F10E-v1.2', 'FITNESS_WELLNESS',        'SPORTS_RECREATION',  'Sports and recreation'),
    ('F10E-v1.2', 'ENTERTAINMENT_MEDIA',     'CINEMA_EVENTS',      'Cinema and live events'),
    ('F10E-v1.2', 'ENTERTAINMENT_MEDIA',     'GAMING',             'Games and in-game purchases'),
    ('F10E-v1.2', 'FAMILY_CHILDCARE',        'CHILDCARE',          'Childcare and nursery'),
    ('F10E-v1.2', 'FAMILY_CHILDCARE',        'KIDS_ACTIVITIES',    'Childrens activities'),
    ('F10E-v1.2', 'PETS',                    'PET_SUPPLIES',       'Pet food and supplies'),
    ('F10E-v1.2', 'PETS',                    'VET_CARE',           'Veterinary care'),
    ('F10E-v1.2', 'GIFTS_CELEBRATIONS',      'GIFTS',              'Gifts'),
    ('F10E-v1.2', 'GIFTS_CELEBRATIONS',      'CELEBRATIONS',       'Celebrations and occasions'),
    ('F10E-v1.2', 'CHARITY_GIVING',          'DONATIONS',          'Donations'),
    ('F10E-v1.2', 'PROFESSIONAL_BUSINESS',   'PROFESSIONAL_FEES',  'Professional and legal fees'),
    ('F10E-v1.2', 'PROFESSIONAL_BUSINESS',   'OFFICE_SUPPLIES',    'Office supplies'),
    ('F10E-v1.2', 'GOVERNMENT_CIVIC',        'TAXES',              'Taxes'),
    ('F10E-v1.2', 'GOVERNMENT_CIVIC',        'LICENCES_FINES',     'Licences, permits and fines'),
    ('F10E-v1.2', 'GOVERNMENT_CIVIC',        'PUBLIC_SERVICES',    'Other public services'),
    ('F10E-v1.2', 'FINANCIAL_SERVICES',      'INVESTMENT_FEES',    'Investment and brokerage fees'),
    ('F10E-v1.2', 'FINANCIAL_SERVICES',      'INSURANCE_PREMIUM',  'Insurance premium'),
    ('F10E-v1.2', 'BANK_FEES',               'ATM_FEE',            'ATM and cash advance fee'),
    ('F10E-v1.2', 'TECHNOLOGY_SERVICES',     'CLOUD_HOSTING',      'Cloud and hosting'),
    ('F10E-v1.2', 'OTHER_PAYMENT',           'MISCELLANEOUS',      'Miscellaneous')
ON CONFLICT (taxonomy_version, subcategory_code) DO NOTHING;

-- --------------------------------------------------------------------------
-- 2. Classifier: MCC first, then the market's keyword pack, then OTHER_MERCHANT.
--
--    Signature is `(text, locale)` as planned; `p_direction` is appended with a
--    default so existing two-argument calls keep resolving.
--
--    `p_locale` is any BCP-47 tag or bare ISO country: `en-GB`, `de-DE`, `GB`.
--    A tag with no region (`en`) means "no country evidence", and a market with
--    no keyword pack falls through to MCC and then OTHER_MERCHANT rather than
--    guessing from an English brand list.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION spendsense.classify_merchant_global(
    p_text text,
    p_locale text DEFAULT NULL,
    p_direction text DEFAULT NULL
) RETURNS TABLE (category_code text, subcategory_code text)
LANGUAGE plpgsql
IMMUTABLE
AS $global$
DECLARE
    v_raw text := btrim(coalesce(p_text, ''));
    v_scan text;
    v_locale text := btrim(coalesce(p_locale, ''));
    v_country text;
    v_mcc text[];
    v_mcc_no integer;
    v_category text;
    v_subcategory text;
BEGIN
    v_scan := btrim(regexp_replace(upper(regexp_replace(v_raw, '[^A-Za-z0-9]+', ' ', 'g')), '[[:space:]]+', ' ', 'g'));

    -- Region from a BCP-47 tag (`en-GB`, `pt_BR`, `zh-Hant-TW`), or a bare
    -- two-letter country. `en` alone yields NULL and is treated as no signal.
    IF v_locale ~ '^[A-Za-z]{2}$' THEN
        v_country := upper(v_locale);
    ELSIF v_locale ~ '^[A-Za-z]{2,3}[-_][A-Za-z]{2}$' THEN
        v_country := upper(split_part(replace(v_locale, '_', '-'), '-', 2));
    ELSIF v_locale ~ '^[A-Za-z]{2,3}[-_][A-Za-z]{4}[-_][A-Za-z]{2}$' THEN
        v_country := upper(split_part(replace(v_locale, '_', '-'), '-', 3));
    END IF;
    IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
        v_country := NULL;
    END IF;

    -- The Indian rails are a different grammar, not a keyword list. Keep using
    -- the reviewed function so an existing mailbox cannot change its answer.
    IF coalesce(v_country, 'IN') = 'IN' THEN
        RETURN QUERY
        SELECT classified.category_code, classified.subcategory_code
          FROM spendsense.classify_movement('OTHER', v_raw, v_raw, p_direction) classified;
        RETURN;
    END IF;

    -- A credit is not merchant spend, whatever descriptor it carries. This sits
    -- before the MCC and keyword stages, because a refund names the merchant it
    -- refunds and would otherwise be filed as a purchase.
    IF upper(btrim(coalesce(p_direction, ''))) IN ('IN', 'CREDIT') THEN
        RETURN QUERY SELECT NULL::text, NULL::text;
        RETURN;
    END IF;

    -- ----------------------------------------------------------------------
    -- 2a. Merchant Category Code, when the descriptor carries one.
    --
    --     Alerts and statement lines write it as `MCC 5411`, `MCC#5411` or
    --     `MCC:5411`. Only an explicit marker is trusted: a bare four-digit run
    --     is a reference number far more often than an MCC.
    -- ----------------------------------------------------------------------
    v_mcc := regexp_match(upper(v_raw), '\mMCC[[:space:]]*[:#]?[[:space:]]*([0-9]{4})\M');

    IF v_mcc IS NOT NULL THEN
        v_mcc_no := v_mcc[1]::integer;

        -- Cash access is a movement, not spend. Booking it as merchant spend
        -- would double-count the purchases the cash then paid for. The caller
        -- gets NULL so the row keeps its uncategorised state.
        IF v_mcc_no BETWEEN 6010 AND 6011 OR v_mcc_no BETWEEN 6050 AND 6051 THEN
            RETURN QUERY SELECT NULL::text, NULL::text;
            RETURN;
        END IF;

        -- One table for the mapping, ordered by range start. Ranges are
        -- disjoint, so a single row always wins and no branch is dead code.
        SELECT mapped.category, mapped.subcategory
          INTO v_category, v_subcategory
          FROM (VALUES
            (742,  742,  'PETS',                    'VET_CARE'),
            (3000, 3010, 'TRAVEL',                  'AIRLINE_TRAVEL'),
            (3351, 3441, 'TRAVEL',                  'CAR_RENTAL'),
            (4111, 4112, 'MOBILITY_TRANSPORT',      'PUBLIC_TRANSIT'),
            (4121, 4121, 'MOBILITY_TRANSPORT',      'TRANSIT_CABS'),
            (4131, 4131, 'MOBILITY_TRANSPORT',      'PUBLIC_TRANSIT'),
            (4511, 4511, 'TRAVEL',                  'AIRLINE_TRAVEL'),
            (4582, 4582, 'TRAVEL',                  'AIRLINE_TRAVEL'),
            (4722, 4722, 'TRAVEL',                  'FLIGHTS_LODGING'),
            (4812, 4814, 'UTILITIES_COMMUNICATION', 'MOBILE_INTERNET'),
            (4816, 4816, 'UTILITIES_COMMUNICATION', 'BROADBAND'),
            (4899, 4899, 'UTILITIES_COMMUNICATION', 'BROADBAND'),
            (4900, 4900, 'UTILITIES_COMMUNICATION', 'ELECTRICITY_GAS'),
            (5021, 5021, 'SHOPPING_RETAIL',         'ECOMMERCE'),
            (5122, 5122, 'HEALTH_MEDICAL',          'PHARMACY'),
            (5172, 5172, 'MOBILITY_TRANSPORT',      'TRANSIT_FUEL'),
            (5310, 5311, 'SHOPPING_RETAIL',         'CLOTHING_APPAREL'),
            (5331, 5399, 'SHOPPING_RETAIL',         'ECOMMERCE'),
            (5411, 5461, 'GROCERIES_HOUSEHOLD',     'GROCERY_STORE'),
            (5462, 5462, 'FOOD_DINING',             'BAKERY_CAFE'),
            (5499, 5499, 'GROCERIES_HOUSEHOLD',     'GROCERY_STORE'),
            (5541, 5542, 'MOBILITY_TRANSPORT',      'TRANSIT_FUEL'),
            (5611, 5699, 'SHOPPING_RETAIL',         'CLOTHING_APPAREL'),
            (5712, 5719, 'SHOPPING_RETAIL',         'HOME_FURNISHING'),
            (5722, 5735, 'SHOPPING_RETAIL',         'ELECTRONICS'),
            (5811, 5813, 'FOOD_DINING',             'RESTAURANT_DINE_IN'),
            (5814, 5814, 'FOOD_DINING',             'FOOD_DELIVERY'),
            (5815, 5815, 'ENTERTAINMENT_MEDIA',     'STREAMING_SUBSCRIPTIONS'),
            (5816, 5816, 'ENTERTAINMENT_MEDIA',     'GAMING'),
            (5817, 5818, 'ENTERTAINMENT_MEDIA',     'STREAMING_SUBSCRIPTIONS'),
            (5912, 5912, 'HEALTH_MEDICAL',          'PHARMACY'),
            (5940, 5941, 'FITNESS_WELLNESS',        'SPORTS_RECREATION'),
            (5942, 5942, 'EDUCATION_LEARNING',      'BOOKS_SUPPLIES'),
            (5943, 5943, 'PROFESSIONAL_BUSINESS',   'OFFICE_SUPPLIES'),
            (5944, 5944, 'GIFTS_CELEBRATIONS',      'GIFTS'),
            (5945, 5945, 'FAMILY_CHILDCARE',        'KIDS_ACTIVITIES'),
            (5946, 5947, 'GIFTS_CELEBRATIONS',      'GIFTS'),
            (5960, 5960, 'OTHER_PAYMENT',           'MISCELLANEOUS'),
            (5977, 5977, 'PERSONAL_CARE',           'BEAUTY_PRODUCTS'),
            (5983, 5983, 'MOBILITY_TRANSPORT',      'TRANSIT_FUEL'),
            (5992, 5992, 'GIFTS_CELEBRATIONS',      'GIFTS'),
            (5995, 5995, 'PETS',                    'PET_SUPPLIES'),
            (6300, 6399, 'FINANCIAL_SERVICES',      'INSURANCE_PREMIUM'),
            (7011, 7033, 'TRAVEL',                  'HOTEL_LODGING'),
            (7230, 7230, 'PERSONAL_CARE',           'SALON_GROOMING'),
            (7297, 7298, 'PERSONAL_CARE',           'SALON_GROOMING'),
            (7311, 7361, 'PROFESSIONAL_BUSINESS',   'PROFESSIONAL_FEES'),
            (7372, 7372, 'TECHNOLOGY_SERVICES',     'SOFTWARE_SUBSCRIPTIONS'),
            (7373, 7399, 'PROFESSIONAL_BUSINESS',   'PROFESSIONAL_FEES'),
            (7512, 7519, 'TRAVEL',                  'CAR_RENTAL'),
            (7523, 7523, 'MOBILITY_TRANSPORT',      'PARKING_TOLLS'),
            (7531, 7538, 'MOBILITY_TRANSPORT',      'PARKING_TOLLS'),
            (7542, 7542, 'MOBILITY_TRANSPORT',      'PARKING_TOLLS'),
            (7832, 7832, 'ENTERTAINMENT_MEDIA',     'CINEMA_EVENTS'),
            (7841, 7841, 'ENTERTAINMENT_MEDIA',     'CINEMA_EVENTS'),
            (7911, 7911, 'ENTERTAINMENT_MEDIA',     'CINEMA_EVENTS'),
            (7922, 7929, 'ENTERTAINMENT_MEDIA',     'CINEMA_EVENTS'),
            (7991, 7991, 'FITNESS_WELLNESS',        'FITNESS_GYM'),
            (7996, 7999, 'FITNESS_WELLNESS',        'SPORTS_RECREATION'),
            (8011, 8011, 'HEALTH_MEDICAL',          'HOSPITAL_CLINIC'),
            (8021, 8021, 'HEALTH_MEDICAL',          'DENTAL_OPTICAL'),
            (8043, 8043, 'HEALTH_MEDICAL',          'DENTAL_OPTICAL'),
            (8062, 8062, 'HEALTH_MEDICAL',          'HOSPITAL_CLINIC'),
            (8099, 8099, 'HEALTH_MEDICAL',          'HOSPITAL_CLINIC'),
            (8211, 8249, 'EDUCATION_LEARNING',      'TUITION_FEES'),
            (8299, 8299, 'EDUCATION_LEARNING',      'TUITION_FEES'),
            (8351, 8351, 'FAMILY_CHILDCARE',        'CHILDCARE'),
            (8398, 8398, 'CHARITY_GIVING',          'DONATIONS'),
            (8661, 8661, 'CHARITY_GIVING',          'DONATIONS'),
            (9211, 9223, 'GOVERNMENT_CIVIC',        'LICENCES_FINES'),
            (9311, 9311, 'GOVERNMENT_CIVIC',        'TAXES'),
            (9399, 9399, 'GOVERNMENT_CIVIC',        'PUBLIC_SERVICES'),
            (9402, 9402, 'GOVERNMENT_CIVIC',        'PUBLIC_SERVICES')
          ) AS mapped(low, high, category, subcategory)
         WHERE v_mcc_no BETWEEN mapped.low AND mapped.high
         ORDER BY mapped.low DESC
         LIMIT 1;

        IF v_category IS NOT NULL THEN
            -- No runtime taxonomy lookup here: the function is IMMUTABLE and must
            -- not read a table. Every pair it can return is asserted against
            -- ref.taxonomy_subcategory by $taxonomy_check$ below.
            RETURN QUERY SELECT v_category, v_subcategory;
            RETURN;
        END IF;
    END IF;

    -- ----------------------------------------------------------------------
    -- 2b. The market's keyword pack.
    --
    --     Brand names only: a generic word ("COFFEE", "HOTEL") classifies half a
    --     statement wrongly, and the ledger's review row exists so a miss is
    --     visible instead of silently wrong.
    -- ----------------------------------------------------------------------
    v_category := NULL;
    v_subcategory := NULL;

    IF v_country = 'US' THEN
        IF v_scan ~ '(^| )(STARBUCKS|DUNKIN|PEETS)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'COFFEE_AND_CAFES';
        ELSIF v_scan ~ '(^| )(MCDONALDS|MCDONALD|CHIPOTLE|TACO BELL|SUBWAY|PANERA|SHAKE SHACK|FIVE GUYS)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'RESTAURANT_DINE_IN';
        ELSIF v_scan ~ '(^| )(DOORDASH|UBER EATS|UBEREATS|GRUBHUB|POSTMATES|SEAMLESS)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'FOOD_DELIVERY';
        ELSIF v_scan ~ '(^| )(WHOLE FOODS|WHOLEFDS|TRADER JOE|SAFEWAY|KROGER|PUBLIX|ALBERTSONS|INSTACART|SPROUTS)( |$)' THEN v_category := 'GROCERIES_HOUSEHOLD'; v_subcategory := 'GROCERY_STORE';
        ELSIF v_scan ~ '(^| )(WALMART|WAL MART|TARGET|COSTCO|SAMSCLUB|BJ WHOLESALE)( |$)' THEN v_category := 'GROCERIES_HOUSEHOLD'; v_subcategory := 'HOUSEHOLD_SUPPLIES';
        ELSIF v_scan ~ '(^| )(AMAZON|AMZN|EBAY|ETSY|WAYFAIR)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'ECOMMERCE';
        ELSIF v_scan ~ '(^| )(BEST BUY|APPLE STORE|MICRO CENTER)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'ELECTRONICS';
        ELSIF v_scan ~ '(^| )(NETFLIX|SPOTIFY|HULU|DISNEY|HBOMAX|HBO MAX|PEACOCK|PARAMOUNT|YOUTUBE)( |$)' THEN v_category := 'ENTERTAINMENT_MEDIA'; v_subcategory := 'STREAMING_SUBSCRIPTIONS';
        ELSIF v_scan ~ '(^| )(AMC|REGAL|CINEMARK)( |$)' THEN v_category := 'ENTERTAINMENT_MEDIA'; v_subcategory := 'CINEMA_EVENTS';
        ELSIF v_scan ~ '(^| )(STEAM|PLAYSTATION|XBOX|NINTENDO|EPIC GAMES)( |$)' THEN v_category := 'ENTERTAINMENT_MEDIA'; v_subcategory := 'GAMING';
        ELSIF v_scan ~ '(^| )(UBER|LYFT|CURB)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_CABS';
        ELSIF v_scan ~ '(^| )(SHELL|CHEVRON|EXXON|EXXONMOBIL|MOBIL|BP|CIRCLE K|SPEEDWAY|WAWA)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_FUEL';
        ELSIF v_scan ~ '(^| )(DELTA|UNITED AIRLINES|AMERICAN AIRLINES|SOUTHWEST|JETBLUE|ALASKA AIR)( |$)' THEN v_category := 'TRAVEL'; v_subcategory := 'AIRLINE_TRAVEL';
        ELSIF v_scan ~ '(^| )(MARRIOTT|HILTON|HYATT|AIRBNB|VRBO|EXPEDIA|BOOKING COM)( |$)' THEN v_category := 'TRAVEL'; v_subcategory := 'HOTEL_LODGING';
        ELSIF v_scan ~ '(^| )(CVS|WALGREENS|RITE AID)( |$)' THEN v_category := 'HEALTH_MEDICAL'; v_subcategory := 'PHARMACY';
        ELSIF v_scan ~ '(^| )(COMCAST|XFINITY|VERIZON|AT T|T MOBILE)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'MOBILE_INTERNET';
        ELSIF v_scan ~ '(^| )(PG E|CON EDISON|DUKE ENERGY|NATIONAL GRID|SOCALGAS)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'ELECTRICITY_GAS';
        END IF;

    ELSIF v_country = 'GB' THEN
        IF v_scan ~ '(^| )(COSTA|PRET|GREGGS|CAFFE NERO|WASABI)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'COFFEE_AND_CAFES';
        ELSIF v_scan ~ '(^| )(NANDOS|WAGAMAMA|PIZZA EXPRESS|HARVESTER|TOBY CARVERY)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'RESTAURANT_DINE_IN';
        ELSIF v_scan ~ '(^| )(DELIVEROO|JUST EAT|JUSTEAT|UBER EATS)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'FOOD_DELIVERY';
        ELSIF v_scan ~ '(^| )(TESCO|SAINSBURYS|SAINSBURY|ASDA|ALDI|LIDL|WAITROSE|MORRISONS|CO OP|COOP)( |$)' THEN v_category := 'GROCERIES_HOUSEHOLD'; v_subcategory := 'GROCERY_STORE';
        ELSIF v_scan ~ '(^| )(ARGOS|JOHN LEWIS|CURRYS|SCREWFIX|B Q|WICKES|IKEA)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'HOME_FURNISHING';
        ELSIF v_scan ~ '(^| )(AMAZON|EBAY|ASOS|VERY|NEXT RETAIL)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'ECOMMERCE';
        ELSIF v_scan ~ '(^| )(NETFLIX|SPOTIFY|DISNEY|NOW TV|BRITBOX|PRIME VIDEO)( |$)' THEN v_category := 'ENTERTAINMENT_MEDIA'; v_subcategory := 'STREAMING_SUBSCRIPTIONS';
        ELSIF v_scan ~ '(^| )(ODEON|VUE|CINEWORLD|PICTUREHOUSE)( |$)' THEN v_category := 'ENTERTAINMENT_MEDIA'; v_subcategory := 'CINEMA_EVENTS';
        ELSIF v_scan ~ '(^| )(TFL|TRANSPORT FOR LONDON|TRAINLINE|NATIONAL RAIL|LNER|SCOTRAIL|STAGECOACH)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'PUBLIC_TRANSIT';
        ELSIF v_scan ~ '(^| )(UBER|BOLT|ADDISON LEE|FREE NOW)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_CABS';
        ELSIF v_scan ~ '(^| )(SHELL|BP|ESSO|TESCO PETROL|SAINSBURYS PETROL|MORRISONS PETROL)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_FUEL';
        ELSIF v_scan ~ '(^| )(BRITISH AIRWAYS|EASYJET|RYANAIR|VIRGIN ATLANTIC|JET2)( |$)' THEN v_category := 'TRAVEL'; v_subcategory := 'AIRLINE_TRAVEL';
        ELSIF v_scan ~ '(^| )(PREMIER INN|TRAVELODGE|HILTON|MARRIOTT|AIRBNB|BOOKING COM)( |$)' THEN v_category := 'TRAVEL'; v_subcategory := 'HOTEL_LODGING';
        ELSIF v_scan ~ '(^| )(BOOTS|SUPERDRUG|LLOYDS PHARMACY|WELL PHARMACY)( |$)' THEN v_category := 'HEALTH_MEDICAL'; v_subcategory := 'PHARMACY';
        ELSIF v_scan ~ '(^| )(SPECSAVERS|VISION EXPRESS|BUPA DENTAL)( |$)' THEN v_category := 'HEALTH_MEDICAL'; v_subcategory := 'DENTAL_OPTICAL';
        ELSIF v_scan ~ '(^| )(BRITISH GAS|OCTOPUS ENERGY|EDF ENERGY|SCOTTISH POWER|OVO ENERGY)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'ELECTRICITY_GAS';
        ELSIF v_scan ~ '(^| )(THAMES WATER|SEVERN TRENT|ANGLIAN WATER|UNITED UTILITIES)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'WATER_SEWER';
        ELSIF v_scan ~ '(^| )(VODAFONE|O2|EE|THREE|SKY|VIRGIN MEDIA|BT)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'MOBILE_INTERNET';
        ELSIF v_scan ~ '(^| )(COUNCIL TAX|TV LICENCE|DVLA|HMRC)( |$)' THEN v_category := 'GOVERNMENT_CIVIC'; v_subcategory := 'TAXES';
        END IF;

    ELSIF v_country = 'AE' THEN
        IF v_scan ~ '(^| )(CARREFOUR|LULU|SPINNEYS|UNION COOP|CHOITHRAMS)( |$)' THEN v_category := 'GROCERIES_HOUSEHOLD'; v_subcategory := 'GROCERY_STORE';
        ELSIF v_scan ~ '(^| )(TALABAT|DELIVEROO|CAREEM FOOD)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'FOOD_DELIVERY';
        ELSIF v_scan ~ '(^| )(CAREEM|UBER|HALA)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_CABS';
        ELSIF v_scan ~ '(^| )(ADNOC|ENOC|EMARAT)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_FUEL';
        ELSIF v_scan ~ '(^| )(DEWA|SEWA|ADDC|AADC)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'ELECTRICITY_GAS';
        ELSIF v_scan ~ '(^| )(ETISALAT|DU TELECOM|VIRGIN MOBILE)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'MOBILE_INTERNET';
        ELSIF v_scan ~ '(^| )(EMIRATES AIRLINE|ETIHAD|FLYDUBAI|AIR ARABIA)( |$)' THEN v_category := 'TRAVEL'; v_subcategory := 'AIRLINE_TRAVEL';
        ELSIF v_scan ~ '(^| )(NOON|AMAZON AE|NAMISHI)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'ECOMMERCE';
        END IF;

    ELSIF v_country = 'SG' THEN
        IF v_scan ~ '(^| )(NTUC|FAIRPRICE|SHENG SIONG|COLD STORAGE|GIANT)( |$)' THEN v_category := 'GROCERIES_HOUSEHOLD'; v_subcategory := 'GROCERY_STORE';
        ELSIF v_scan ~ '(^| )(GRAB|GOJEK|TADA|COMFORTDELGRO)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_CABS';
        ELSIF v_scan ~ '(^| )(FOODPANDA|DELIVEROO|GRABFOOD)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'FOOD_DELIVERY';
        ELSIF v_scan ~ '(^| )(SINGTEL|STARHUB|M1|SIMBA)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'MOBILE_INTERNET';
        ELSIF v_scan ~ '(^| )(SP GROUP|SP SERVICES|CITY GAS)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'ELECTRICITY_GAS';
        ELSIF v_scan ~ '(^| )(SMRT|SBS TRANSIT|EZ LINK|EZLINK)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'PUBLIC_TRANSIT';
        ELSIF v_scan ~ '(^| )(SINGAPORE AIRLINES|SCOOT|JETSTAR)( |$)' THEN v_category := 'TRAVEL'; v_subcategory := 'AIRLINE_TRAVEL';
        ELSIF v_scan ~ '(^| )(SHOPEE|LAZADA|AMAZON SG)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'ECOMMERCE';
        END IF;

    ELSIF v_country = 'AU' THEN
        IF v_scan ~ '(^| )(WOOLWORTHS|COLES|ALDI|IGA|FOODWORKS)( |$)' THEN v_category := 'GROCERIES_HOUSEHOLD'; v_subcategory := 'GROCERY_STORE';
        ELSIF v_scan ~ '(^| )(UBER|OLA|DIDI|SHEBAH)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_CABS';
        ELSIF v_scan ~ '(^| )(MENULOG|DELIVEROO|UBER EATS|DOORDASH)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'FOOD_DELIVERY';
        ELSIF v_scan ~ '(^| )(BUNNINGS|JB HI FI|JBHIFI|THE GOOD GUYS|KMART|BIG W)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'HOME_FURNISHING';
        ELSIF v_scan ~ '(^| )(TELSTRA|OPTUS|VODAFONE AU|TPG)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'MOBILE_INTERNET';
        ELSIF v_scan ~ '(^| )(AGL|ORIGIN ENERGY|ENERGYAUSTRALIA|SYNERGY)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'ELECTRICITY_GAS';
        ELSIF v_scan ~ '(^| )(QANTAS|VIRGIN AUSTRALIA|JETSTAR|REX)( |$)' THEN v_category := 'TRAVEL'; v_subcategory := 'AIRLINE_TRAVEL';
        ELSIF v_scan ~ '(^| )(CALTEX|AMPOL|SHELL|COLES EXPRESS)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_FUEL';
        ELSIF v_scan ~ '(^| )(OPAL|TRANSPORT NSW|MYKI|PTV)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'PUBLIC_TRANSIT';
        END IF;

    ELSIF v_country = 'CA' THEN
        IF v_scan ~ '(^| )(LOBLAWS|METRO|SOBEYS|SUPERSTORE|NO FRILLS|FOOD BASICS)( |$)' THEN v_category := 'GROCERIES_HOUSEHOLD'; v_subcategory := 'GROCERY_STORE';
        ELSIF v_scan ~ '(^| )(TIM HORTONS|TIMS|SECOND CUP)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'COFFEE_AND_CAFES';
        ELSIF v_scan ~ '(^| )(UBER|LYFT|INSTACART)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_CABS';
        ELSIF v_scan ~ '(^| )(SKIPTHEDISHES|SKIP THE DISHES|DOORDASH|UBER EATS)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'FOOD_DELIVERY';
        ELSIF v_scan ~ '(^| )(TELUS|ROGERS|BELL CANADA|FIDO|KOODO)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'MOBILE_INTERNET';
        ELSIF v_scan ~ '(^| )(HYDRO ONE|HYDRO QUEBEC|BC HYDRO|ENBRIDGE|ATCO)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'ELECTRICITY_GAS';
        ELSIF v_scan ~ '(^| )(PETRO CANADA|ESSO|SHELL)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_FUEL';
        ELSIF v_scan ~ '(^| )(AIR CANADA|WESTJET|PORTER AIRLINES|AIR TRANSAT)( |$)' THEN v_category := 'TRAVEL'; v_subcategory := 'AIRLINE_TRAVEL';
        ELSIF v_scan ~ '(^| )(PRESTO|TTC|COMPASS)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'PUBLIC_TRANSIT';
        END IF;

    ELSIF v_country = 'DE' THEN
        IF v_scan ~ '(^| )(REWE|EDEKA|ALDI|LIDL|PENNY|KAUFLAND|NETTO|NORMA|TEGUT)( |$)' THEN v_category := 'GROCERIES_HOUSEHOLD'; v_subcategory := 'GROCERY_STORE';
        ELSIF v_scan ~ '(^| )(DM DROGERIE|ROSSMANN|MULLER)( |$)' THEN v_category := 'GROCERIES_HOUSEHOLD'; v_subcategory := 'HOUSEHOLD_SUPPLIES';
        ELSIF v_scan ~ '(^| )(LIEFERANDO|HELLOFRESH|WOLT)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'FOOD_DELIVERY';
        ELSIF v_scan ~ '(^| )(STARBUCKS|COFFEE FELLOW|BACKWERK|BALZAC)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'COFFEE_AND_CAFES';
        ELSIF v_scan ~ '(^| )(AMAZON|ZALANDO|OTTO|IDEALO)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'ECOMMERCE';
        ELSIF v_scan ~ '(^| )(IKEA|OBI|HORNBACH|BAUHAUS|ROLLER)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'HOME_FURNISHING';
        ELSIF v_scan ~ '(^| )(NETFLIX|SPOTIFY|DISNEY|RTL PLUS)( |$)' THEN v_category := 'ENTERTAINMENT_MEDIA'; v_subcategory := 'STREAMING_SUBSCRIPTIONS';
        ELSIF v_scan ~ '(^| )(DB FERNVERKEHR|DEUTSCHE BAHN|DB BAHN|BVG|MVG|HVV)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'PUBLIC_TRANSIT';
        ELSIF v_scan ~ '(^| )(UBER|BOLT|FREE NOW|MYTAXI)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_CABS';
        ELSIF v_scan ~ '(^| )(ARAL|SHELL|ESSO|JET|TOTAL|AVIA)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_FUEL';
        ELSIF v_scan ~ '(^| )(LUFTHANSA|EUROWINGS|CONDOR|TUIFLY)( |$)' THEN v_category := 'TRAVEL'; v_subcategory := 'AIRLINE_TRAVEL';
        ELSIF v_scan ~ '(^| )(APOTHEKE|SHOP APOTHEKE|DOC MORRIS|ROSE APOTHEKE)( |$)' THEN v_category := 'HEALTH_MEDICAL'; v_subcategory := 'PHARMACY';
        ELSIF v_scan ~ '(^| )(TELEKOM|VODAFONE|O2|1 UND 1|CONGSTAR)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'MOBILE_INTERNET';
        ELSIF v_scan ~ '(^| )(EON|RWE|VATTENFALL|ENBW|STADTWERKE|GASAG)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'ELECTRICITY_GAS';
        ELSIF v_scan ~ '(^| )(FINANZAMT|ELSTER|KFZ ZULASSUNG|BUSSGELD)( |$)' THEN v_category := 'GOVERNMENT_CIVIC'; v_subcategory := 'TAXES';
        END IF;

    ELSIF v_country = 'FR' THEN
        IF v_scan ~ '(^| )(CARREFOUR|LECLERC|AUCHAN|LIDL|INTERMARCHE|MONOPRIX|FRANPRIX|CASINO|SUPER U|PICARD)( |$)' THEN v_category := 'GROCERIES_HOUSEHOLD'; v_subcategory := 'GROCERY_STORE';
        ELSIF v_scan ~ '(^| )(DELIVEROO|UBER EATS|JUST EAT|FRAICHEL)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'FOOD_DELIVERY';
        ELSIF v_scan ~ '(^| )(MCDONALDS|QUICK|BRIOCHE DOREE|PAUL|STARBUCKS)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'RESTAURANT_DINE_IN';
        ELSIF v_scan ~ '(^| )(AMAZON|FNAC|DARTY|CULTURA|CDISCOUNT)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'ECOMMERCE';
        ELSIF v_scan ~ '(^| )(DECATHLON|IKEA|LEROY MERLIN|CASTORAMA|CONFORAMA)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'HOME_FURNISHING';
        ELSIF v_scan ~ '(^| )(NETFLIX|SPOTIFY|CANAL PLUS|DISNEY|PRIME VIDEO)( |$)' THEN v_category := 'ENTERTAINMENT_MEDIA'; v_subcategory := 'STREAMING_SUBSCRIPTIONS';
        ELSIF v_scan ~ '(^| )(SNCF|RATP|OUIGO|IDF MOBILITES)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'PUBLIC_TRANSIT';
        ELSIF v_scan ~ '(^| )(UBER|BOLT|G7|KAPTEN)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_CABS';
        ELSIF v_scan ~ '(^| )(TOTAL|TOTALENERGIES|ESSO|BP)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_FUEL';
        ELSIF v_scan ~ '(^| )(AIR FRANCE|TRANSAVIA|EASYJET|RYANAIR)( |$)' THEN v_category := 'TRAVEL'; v_subcategory := 'AIRLINE_TRAVEL';
        ELSIF v_scan ~ '(^| )(PHARMACIE|PARASHOP)( |$)' THEN v_category := 'HEALTH_MEDICAL'; v_subcategory := 'PHARMACY';
        ELSIF v_scan ~ '(^| )(ORANGE|SFR|BOUYGUES|FREE|RED BY SFR)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'MOBILE_INTERNET';
        ELSIF v_scan ~ '(^| )(EDF|ENGIE|VEOLIA|SUEZ)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'ELECTRICITY_GAS';
        ELSIF v_scan ~ '(^| )(DGFIP|IMPOTS|AMENDE|ANTS)( |$)' THEN v_category := 'GOVERNMENT_CIVIC'; v_subcategory := 'TAXES';
        END IF;

    ELSIF v_country = 'ES' THEN
        IF v_scan ~ '(^| )(MERCADONA|CARREFOUR|LIDL|DIA|EROSKI|ALCAMPO|HIPERCOR|CONSUM|ALDI)( |$)' THEN v_category := 'GROCERIES_HOUSEHOLD'; v_subcategory := 'GROCERY_STORE';
        ELSIF v_scan ~ '(^| )(GLOVO|JUST EAT|UBER EATS|DELIVEROO)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'FOOD_DELIVERY';
        ELSIF v_scan ~ '(^| )(AMAZON|EL CORTE INGLES|FNAC|PCCOMPONENTES|ALIEXPRESS)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'ECOMMERCE';
        ELSIF v_scan ~ '(^| )(IKEA|LEROY MERLIN|BAUHAUS|CONFORAMA)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'HOME_FURNISHING';
        ELSIF v_scan ~ '(^| )(NETFLIX|SPOTIFY|MOVISTAR PLUS|DISNEY|HBO)( |$)' THEN v_category := 'ENTERTAINMENT_MEDIA'; v_subcategory := 'STREAMING_SUBSCRIPTIONS';
        ELSIF v_scan ~ '(^| )(RENFE|METRO DE MADRID|TMB|EMT|ALSA)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'PUBLIC_TRANSIT';
        ELSIF v_scan ~ '(^| )(UBER|CABIFY|BOLT|FREE NOW)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_CABS';
        ELSIF v_scan ~ '(^| )(REPSOL|CEPSA|BP|SHELL|GALP|BALLENOIL)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_FUEL';
        ELSIF v_scan ~ '(^| )(IBERIA|VUELING|AIR EUROPA|RYANAIR)( |$)' THEN v_category := 'TRAVEL'; v_subcategory := 'AIRLINE_TRAVEL';
        ELSIF v_scan ~ '(^| )(FARMACIA|PARAFARMACIA)( |$)' THEN v_category := 'HEALTH_MEDICAL'; v_subcategory := 'PHARMACY';
        ELSIF v_scan ~ '(^| )(MOVISTAR|VODAFONE|ORANGE|YOIGO|MASMOVIL)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'MOBILE_INTERNET';
        ELSIF v_scan ~ '(^| )(IBERDROLA|ENDESA|NATURGY|HOLALUZ)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'ELECTRICITY_GAS';
        ELSIF v_scan ~ '(^| )(AEAT|AGENCIA TRIBUTARIA|DGT|SEPE)( |$)' THEN v_category := 'GOVERNMENT_CIVIC'; v_subcategory := 'TAXES';
        END IF;

    ELSIF v_country = 'PT' THEN
        IF v_scan ~ '(^| )(CONTINENTE|PINGO DOCE|LIDL|AUCHAN|MINIPRECO|INTERMARCHE|ALDI)( |$)' THEN v_category := 'GROCERIES_HOUSEHOLD'; v_subcategory := 'GROCERY_STORE';
        ELSIF v_scan ~ '(^| )(UBER EATS|GLOVO|BOLT FOOD|DELIVEROO)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'FOOD_DELIVERY';
        ELSIF v_scan ~ '(^| )(GALP|REPSOL|BP|CEPSA|PRIO)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_FUEL';
        ELSIF v_scan ~ '(^| )(UBER|BOLT|FREE NOW|TVDE)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_CABS';
        ELSIF v_scan ~ '(^| )(CP COMBOIOS|METRO DE LISBOA|REDE EXPRESSOS)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'PUBLIC_TRANSIT';
        ELSIF v_scan ~ '(^| )(EDP|GALP ENERGIA|ENDESA PT)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'ELECTRICITY_GAS';
        ELSIF v_scan ~ '(^| )(MEO|NOS|VODAFONE PT|NOWO)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'MOBILE_INTERNET';
        ELSIF v_scan ~ '(^| )(TAP|RYANAIR|EASYJET|SATA)( |$)' THEN v_category := 'TRAVEL'; v_subcategory := 'AIRLINE_TRAVEL';
        ELSIF v_scan ~ '(^| )(AMAZON|WORTEN|FNAC PT|ALIEXPRESS)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'ECOMMERCE';
        ELSIF v_scan ~ '(^| )(FARMACIA|WELLS PT)( |$)' THEN v_category := 'HEALTH_MEDICAL'; v_subcategory := 'PHARMACY';
        END IF;

    ELSIF v_country = 'BR' THEN
        IF v_scan ~ '(^| )(PAO DE ACUCAR|CARREFOUR|EXTRA|ASSAI|ATACADAO|BIG BOM|DIA)( |$)' THEN v_category := 'GROCERIES_HOUSEHOLD'; v_subcategory := 'GROCERY_STORE';
        ELSIF v_scan ~ '(^| )(IFOOD|RAPPI|UBER EATS)( |$)' THEN v_category := 'FOOD_DINING'; v_subcategory := 'FOOD_DELIVERY';
        ELSIF v_scan ~ '(^| )(UBER|99|CABIFY|LADY DRIVER)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_CABS';
        ELSIF v_scan ~ '(^| )(PETROBRAS|SHELL|IPIRANGA|BR DISTRIBUIDORA)( |$)' THEN v_category := 'MOBILITY_TRANSPORT'; v_subcategory := 'TRANSIT_FUEL';
        ELSIF v_scan ~ '(^| )(VIVO|CLARO|TIM|OI)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'MOBILE_INTERNET';
        ELSIF v_scan ~ '(^| )(ENEL|CPFL|LIGHT|SABESP|COPASA|COMGAS)( |$)' THEN v_category := 'UTILITIES_COMMUNICATION'; v_subcategory := 'ELECTRICITY_GAS';
        ELSIF v_scan ~ '(^| )(LATAM|GOL|AZUL|VOEPASS)( |$)' THEN v_category := 'TRAVEL'; v_subcategory := 'AIRLINE_TRAVEL';
        ELSIF v_scan ~ '(^| )(MERCADO LIVRE|AMERICANAS|MAGAZINE LUIZA|SHOPEE)( |$)' THEN v_category := 'SHOPPING_RETAIL'; v_subcategory := 'ECOMMERCE';
        ELSIF v_scan ~ '(^| )(DROGARIA|DROGASIL|ULTRAFARMA|PACHECO)( |$)' THEN v_category := 'HEALTH_MEDICAL'; v_subcategory := 'PHARMACY';
        ELSIF v_scan ~ '(^| )(NETFLIX|SPOTIFY|GLOBOPLAY|DISNEY PLUS)( |$)' THEN v_category := 'ENTERTAINMENT_MEDIA'; v_subcategory := 'STREAMING_SUBSCRIPTIONS';
        END IF;
    END IF;

    IF v_category IS NOT NULL THEN
        RETURN QUERY SELECT v_category, v_subcategory;
        RETURN;
    END IF;

    -- ----------------------------------------------------------------------
    -- 2c. Residual. `OTHER_MERCHANT` is a real category with no subcategory, so
    --     an unrecognised card purchase still lands in spend totals instead of
    --     vanishing into "not recorded".
    -- ----------------------------------------------------------------------
    IF v_raw = '' THEN
        RETURN QUERY SELECT NULL::text, NULL::text;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'OTHER_MERCHANT'::text, NULL::text;
END;
$global$;

REVOKE ALL ON FUNCTION spendsense.classify_merchant_global(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION spendsense.classify_merchant_global(text, text, text) TO monytix_api;

-- --------------------------------------------------------------------------
-- 2c. Ingestion adapter.
--
--     Live promotion knows the channel and the counterparty token, not just one
--     descriptor string, and the Indian pack needs both. This keeps that
--     signature and delegates:
--       country IN or unknown -> classify_movement (byte-identical to before)
--       anywhere else         -> classify_merchant_global
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION spendsense.classify_alert_merchant(
    p_channel text,
    p_counterparty text,
    p_text text,
    p_direction text DEFAULT NULL,
    p_country text DEFAULT NULL
) RETURNS TABLE (category_code text, subcategory_code text)
LANGUAGE plpgsql
IMMUTABLE
AS $alert$
DECLARE
    v_country text := upper(btrim(coalesce(p_country, '')));
BEGIN
    IF v_country IN ('', 'IN') THEN
        RETURN QUERY
        SELECT classified.category_code, classified.subcategory_code
          FROM spendsense.classify_movement(p_channel, p_counterparty, p_text, p_direction) classified;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT classified.category_code, classified.subcategory_code
      FROM spendsense.classify_merchant_global(p_text, v_country, p_direction) classified;
END;
$alert$;

REVOKE ALL ON FUNCTION spendsense.classify_alert_merchant(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION spendsense.classify_alert_merchant(text, text, text, text, text) TO monytix_api;

-- --------------------------------------------------------------------------
-- 2d. Point live promotion at the adapter.
--
--     A text patch on the deployed body, because `pg_get_functiondef` does not
--     reproduce the source file and a full rewrite of `promote_gmail_spot` would
--     have to restate the 0056 currency, stated-pair and account-matching work.
--     Every replacement is asserted: a future rewrite fails here rather than
--     silently dropping the country signal.
-- --------------------------------------------------------------------------
DO $promote_patch$
DECLARE
    src text;
    patched text;
BEGIN
    SELECT pg_get_functiondef('ops.promote_gmail_spot(uuid)'::regprocedure) INTO src;

    -- The owner's country, read beside the timezone the 0056 body already reads.
    patched := regexp_replace(
        src,
        'v_timezone text;',
        'v_timezone text;
    v_country text;',
        ''
    );
    IF patched = src THEN
        RAISE EXCEPTION 'promote_gmail_spot: v_timezone declaration not found';
    END IF;
    IF patched !~ 'v_country text;' THEN
        RAISE EXCEPTION 'promote_gmail_spot: v_country declaration was not added';
    END IF;

    src := patched;
    -- `\s+` rather than a literal layout: `pg_get_functiondef` re-renders whitespace,
    -- so an exact match on the source file's indentation would fail on a deployed body.
    patched := regexp_replace(
        src,
        'SELECT\s+coalesce\(nullif\(btrim\(timezone_name\),\s*''''\),\s*''UTC''\)\s+INTO\s+v_timezone',
        'SELECT coalesce(nullif(btrim(timezone_name), ''''), ''UTC''), coalesce(nullif(upper(btrim(metadata->>''country_code'')), ''''), NULL) INTO v_timezone, v_country',
        ''
    );
    IF patched = src THEN
        RAISE EXCEPTION 'promote_gmail_spot: owner timezone read not found';
    END IF;
    IF patched !~ 'v_country' THEN
        RAISE EXCEPTION 'promote_gmail_spot: country read was not added';
    END IF;

    src := patched;
    patched := regexp_replace(
        src,
        'FROM spendsense\.classify_movement\(\s*v_spot\.channel,\s*coalesce\(v_token, ''''\),\s*concat_ws\('' '', v_spot\.channel, v_spot\.counterparty, v_title\),\s*v_direction\s*\) classified;',
        'FROM spendsense.classify_alert_merchant(
          v_spot.channel,
          coalesce(v_token, ''''),
          concat_ws('' '', v_spot.channel, v_spot.counterparty, v_title),
          v_direction,
          v_country
      ) classified;',
        ''
    );
    IF patched = src THEN
        RAISE EXCEPTION 'promote_gmail_spot: classify_movement call not found';
    END IF;
    IF patched !~ 'classify_alert_merchant' THEN
        RAISE EXCEPTION 'promote_gmail_spot: adapter call was not added';
    END IF;

    EXECUTE patched;
END;
$promote_patch$;


-- --------------------------------------------------------------------------
-- 3. Institutions: website domains, and the foreign banks whose senders the
--    alert pipeline now recognises. `ref.institution.country_code` feeds the `$`
--    resolution order in money/detect.ts, so a wrong row here would mis-price a
--    card alert.
--
--    Mirrors `services/api/src/gmail/institutions.ts`; keep the two in step.
-- --------------------------------------------------------------------------
UPDATE ref.institution AS i
   SET website_domain = v.domain
  FROM (VALUES
    ('HDFC',    'hdfcbank.com'),
    ('ICICI',   'icicibank.com'),
    ('SBI',     'sbi.co.in'),
    ('AXIS',    'axisbank.com'),
    ('FEDERAL', 'federalbank.co.in'),
    ('CANARA',  'canarabank.com')
  ) AS v(code, domain)
 WHERE i.institution_code = v.code
   AND i.website_domain IS NULL;

INSERT INTO ref.institution (institution_code, display_name, institution_type, country_code, website_domain, metadata) VALUES
    ('KOTAK',            'Kotak Mahindra Bank',            'BANK',        'IN', 'kotak.com',            '{"currency_engine":true}'::jsonb),
    ('CHASE',            'JPMorgan Chase',                'BANK',        'US', 'chase.com',            '{"currency_engine":true}'::jsonb),
    ('BANK_OF_AMERICA',  'Bank of America',               'BANK',        'US', 'bankofamerica.com',    '{"currency_engine":true}'::jsonb),
    ('WELLS_FARGO',      'Wells Fargo',                   'BANK',        'US', 'wellsfargo.com',       '{"currency_engine":true}'::jsonb),
    ('CITI',             'Citibank',                      'BANK',        'US', 'citibank.com',         '{"currency_engine":true}'::jsonb),
    ('CAPITAL_ONE',      'Capital One',                   'CARD_ISSUER', 'US', 'capitalone.com',       '{"currency_engine":true}'::jsonb),
    ('BARCLAYS',         'Barclays',                      'BANK',        'GB', 'barclays.co.uk',       '{"currency_engine":true}'::jsonb),
    ('HSBC',             'HSBC',                          'BANK',        'GB', 'hsbc.co.uk',           '{"currency_engine":true}'::jsonb),
    ('LLOYDS',           'Lloyds Bank',                   'BANK',        'GB', 'lloydsbank.com',       '{"currency_engine":true}'::jsonb),
    ('NATWEST',          'NatWest',                       'BANK',        'GB', 'natwest.com',          '{"currency_engine":true}'::jsonb),
    ('MONZO',            'Monzo',                         'BANK',        'GB', 'monzo.com',            '{"currency_engine":true}'::jsonb),
    ('REVOLUT',          'Revolut',                       'BANK',        'GB', 'revolut.com',          '{"currency_engine":true}'::jsonb),
    ('STARLING',         'Starling Bank',                 'BANK',        'GB', 'starlingbank.com',     '{"currency_engine":true}'::jsonb),
    ('DEUTSCHE_BANK',    'Deutsche Bank',                 'BANK',        'DE', 'deutsche-bank.de',     '{"currency_engine":true}'::jsonb),
    ('COMMERZBANK',      'Commerzbank',                   'BANK',        'DE', 'commerzbank.de',       '{"currency_engine":true}'::jsonb),
    ('N26',              'N26',                           'BANK',        'DE', 'n26.com',              '{"currency_engine":true}'::jsonb),
    ('BNP_PARIBAS',      'BNP Paribas',                   'BANK',        'FR', 'bnpparibas.fr',        '{"currency_engine":true}'::jsonb),
    ('SOCIETE_GENERALE', 'Societe Generale',              'BANK',        'FR', 'societegenerale.fr',   '{"currency_engine":true}'::jsonb),
    ('SANTANDER',        'Santander',                     'BANK',        'ES', 'santander.es',         '{"currency_engine":true}'::jsonb),
    ('BBVA',             'BBVA',                          'BANK',        'ES', 'bbva.es',              '{"currency_engine":true}'::jsonb),
    ('ITAU',             'Itau Unibanco',                 'BANK',        'BR', 'itau.com.br',          '{"currency_engine":true}'::jsonb),
    ('NUBANK',           'Nubank',                        'BANK',        'BR', 'nubank.com.br',        '{"currency_engine":true}'::jsonb),
    ('EMIRATES_NBD',     'Emirates NBD',                  'BANK',        'AE', 'emiratesnbd.com',      '{"currency_engine":true}'::jsonb),
    ('DBS',              'DBS Bank',                      'BANK',        'SG', 'dbs.com.sg',           '{"currency_engine":true}'::jsonb),
    ('CBA',              'Commonwealth Bank of Australia','BANK',        'AU', 'commbank.com.au',      '{"currency_engine":true}'::jsonb),
    ('RBC',              'Royal Bank of Canada',          'BANK',        'CA', 'rbc.com',              '{"currency_engine":true}'::jsonb)
ON CONFLICT (institution_code) DO NOTHING;

CREATE INDEX IF NOT EXISTS ix_ref_institution_domain
    ON ref.institution (lower(website_domain))
    WHERE website_domain IS NOT NULL;

-- --------------------------------------------------------------------------
-- 4. Every code the new classifier can return must exist in the taxonomy.
--    A missing code would fail the composite FK on the next ingest rather than
--    here, which is far harder to diagnose.
-- --------------------------------------------------------------------------
DO $taxonomy_check$
DECLARE
    v_missing text;
BEGIN
    SELECT string_agg(pair, ', ')
      INTO v_missing
      FROM (
        SELECT wanted.cat || '/' || wanted.sub AS pair
          FROM (VALUES
            ('FOOD_DINING', 'RESTAURANT_DINE_IN'),
            ('FOOD_DINING', 'FOOD_DELIVERY'),
            ('FOOD_DINING', 'COFFEE_AND_CAFES'),
            ('FOOD_DINING', 'BAKERY_CAFE'),
            ('FOOD_DINING', 'GROCERIES_SUPERMARKET'),
            ('GROCERIES_HOUSEHOLD', 'GROCERY_STORE'),
            ('GROCERIES_HOUSEHOLD', 'HOUSEHOLD_SUPPLIES'),
            ('HOUSING_HOME', 'MORTGAGE_PAYMENT'),
            ('HOUSING_HOME', 'HOME_MAINTENANCE'),
            ('HOUSING_HOME', 'PROPERTY_FEES'),
            ('UTILITIES_COMMUNICATION', 'MOBILE_INTERNET'),
            ('UTILITIES_COMMUNICATION', 'ELECTRICITY_GAS'),
            ('UTILITIES_COMMUNICATION', 'WATER_SEWER'),
            ('UTILITIES_COMMUNICATION', 'BROADBAND'),
            ('MOBILITY_TRANSPORT', 'TRANSIT_CABS'),
            ('MOBILITY_TRANSPORT', 'TRANSIT_FUEL'),
            ('MOBILITY_TRANSPORT', 'PUBLIC_TRANSIT'),
            ('MOBILITY_TRANSPORT', 'PARKING_TOLLS'),
            ('MOBILITY_TRANSPORT', 'CONVENIENCE_FUEL'),
            ('TRAVEL', 'AIRLINE_TRAVEL'),
            ('TRAVEL', 'FLIGHTS_LODGING'),
            ('TRAVEL', 'TRAVEL_RAILWAYS'),
            ('TRAVEL', 'HOTEL_LODGING'),
            ('TRAVEL', 'CAR_RENTAL'),
            ('HEALTH_MEDICAL', 'PHARMACY'),
            ('HEALTH_MEDICAL', 'MEDICAL_EXPENSES'),
            ('HEALTH_MEDICAL', 'HOSPITAL_CLINIC'),
            ('HEALTH_MEDICAL', 'DENTAL_OPTICAL'),
            ('EDUCATION_LEARNING', 'TUITION_FEES'),
            ('EDUCATION_LEARNING', 'ONLINE_COURSES'),
            ('EDUCATION_LEARNING', 'BOOKS_SUPPLIES'),
            ('SHOPPING_RETAIL', 'ECOMMERCE'),
            ('SHOPPING_RETAIL', 'CLOTHING_APPAREL'),
            ('SHOPPING_RETAIL', 'ELECTRONICS'),
            ('SHOPPING_RETAIL', 'HOME_FURNISHING'),
            ('PERSONAL_CARE', 'SALON_GROOMING'),
            ('PERSONAL_CARE', 'BEAUTY_PRODUCTS'),
            ('FITNESS_WELLNESS', 'FITNESS_GYM'),
            ('FITNESS_WELLNESS', 'SPORTS_RECREATION'),
            ('ENTERTAINMENT_MEDIA', 'STREAMING_SUBSCRIPTIONS'),
            ('ENTERTAINMENT_MEDIA', 'CINEMA_EVENTS'),
            ('ENTERTAINMENT_MEDIA', 'GAMING'),
            ('FAMILY_CHILDCARE', 'CHILDCARE'),
            ('FAMILY_CHILDCARE', 'KIDS_ACTIVITIES'),
            ('PETS', 'PET_SUPPLIES'),
            ('PETS', 'VET_CARE'),
            ('GIFTS_CELEBRATIONS', 'GIFTS'),
            ('GIFTS_CELEBRATIONS', 'CELEBRATIONS'),
            ('CHARITY_GIVING', 'DONATIONS'),
            ('PROFESSIONAL_BUSINESS', 'PROFESSIONAL_FEES'),
            ('PROFESSIONAL_BUSINESS', 'OFFICE_SUPPLIES'),
            ('GOVERNMENT_CIVIC', 'TAXES'),
            ('GOVERNMENT_CIVIC', 'LICENCES_FINES'),
            ('GOVERNMENT_CIVIC', 'PUBLIC_SERVICES'),
            ('FINANCIAL_SERVICES', 'INVESTMENT_FEES'),
            ('FINANCIAL_SERVICES', 'INSURANCE_PREMIUM'),
            ('BANK_FEES', 'ATM_FEE'),
            ('TECHNOLOGY_SERVICES', 'SOFTWARE_SUBSCRIPTIONS'),
            ('TECHNOLOGY_SERVICES', 'CLOUD_HOSTING'),
            ('OTHER_PAYMENT', 'MISCELLANEOUS')
          ) AS wanted(cat, sub)
         WHERE NOT EXISTS (
             SELECT 1 FROM ref.taxonomy_subcategory s
              WHERE s.taxonomy_version = 'F10E-v1.2'
                AND s.category_code = wanted.cat
                AND s.subcategory_code = wanted.sub
         )
      ) gaps;
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'global classifier references unknown taxonomy codes: %', v_missing;
    END IF;
END;
$taxonomy_check$;

-- --------------------------------------------------------------------------
-- 5. Behaviour checks.
-- --------------------------------------------------------------------------
DO $check$
DECLARE
    v_category text;
    v_subcategory text;
BEGIN
    -- MCC beats the keyword pack when both are present.
    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_merchant_global('TESCO STORES MCC 5411', 'en-GB', 'OUT');
    IF v_category IS DISTINCT FROM 'GROCERIES_HOUSEHOLD' OR v_subcategory IS DISTINCT FROM 'GROCERY_STORE' THEN
        RAISE EXCEPTION 'MCC grocery failed: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_merchant_global('DELIVEROO LONDON', 'en-GB', 'OUT');
    IF v_category IS DISTINCT FROM 'FOOD_DINING' OR v_subcategory IS DISTINCT FROM 'FOOD_DELIVERY' THEN
        RAISE EXCEPTION 'UK delivery failed: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_merchant_global('WHOLEFDS MKT 10234', 'en-US', 'OUT');
    IF v_category IS DISTINCT FROM 'GROCERIES_HOUSEHOLD' OR v_subcategory IS DISTINCT FROM 'GROCERY_STORE' THEN
        RAISE EXCEPTION 'US grocery failed: % / %', v_category, v_subcategory;
    END IF;

    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_merchant_global('REWE SAGT DANKE', 'de-DE', 'OUT');
    IF v_category IS DISTINCT FROM 'GROCERIES_HOUSEHOLD' OR v_subcategory IS DISTINCT FROM 'GROCERY_STORE' THEN
        RAISE EXCEPTION 'German grocery failed: % / %', v_category, v_subcategory;
    END IF;

    -- An unrecognised descriptor still lands in spend rather than vanishing.
    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_merchant_global('XYZ HOLDINGS LTD', 'en-GB', 'OUT');
    IF v_category IS DISTINCT FROM 'OTHER_MERCHANT' OR v_subcategory IS NOT NULL THEN
        RAISE EXCEPTION 'residual failed: % / %', v_category, v_subcategory;
    END IF;

    -- Cash access is a movement, not a merchant.
    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_merchant_global('ATM WITHDRAWAL MCC 6011', 'en-US', 'OUT');
    IF v_category IS NOT NULL OR v_subcategory IS NOT NULL THEN
        RAISE EXCEPTION 'cash access was classified as spend: % / %', v_category, v_subcategory;
    END IF;

    -- A credit is not merchant spend.
    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_merchant_global('REFUND FROM TESCO', 'en-GB', 'IN');
    IF v_category IS NOT NULL OR v_subcategory IS NOT NULL THEN
        RAISE EXCEPTION 'credit was classified as spend: % / %', v_category, v_subcategory;
    END IF;

    -- The Indian pack must answer exactly as it did before this migration.
    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_merchant_global('swiggy@paytm', 'en-IN', 'OUT');
    IF v_category IS DISTINCT FROM 'FOOD_DINING' OR v_subcategory IS DISTINCT FROM 'FOOD_DELIVERY' THEN
        RAISE EXCEPTION 'Indian delegation regressed: % / %', v_category, v_subcategory;
    END IF;

    -- No locale at all still means India: that is the historical default.
    SELECT category_code, subcategory_code INTO v_category, v_subcategory
      FROM spendsense.classify_merchant_global('swiggy@paytm', NULL, 'OUT');
    IF v_category IS DISTINCT FROM 'FOOD_DINING' OR v_subcategory IS DISTINCT FROM 'FOOD_DELIVERY' THEN
        RAISE EXCEPTION 'locale-less delegation regressed: % / %', v_category, v_subcategory;
    END IF;
END;
$check$;

-- --------------------------------------------------------------------------
-- 6. Institutions referenced above must really be there, with a country.
-- --------------------------------------------------------------------------
DO $institution_check$
DECLARE
    v_missing text;
BEGIN
    SELECT string_agg(code, ', ')
      INTO v_missing
      FROM (VALUES
        ('HDFC'), ('ICICI'), ('SBI'), ('AXIS'), ('KOTAK'), ('FEDERAL'), ('CANARA'),
        ('CHASE'), ('BANK_OF_AMERICA'), ('WELLS_FARGO'), ('CITI'), ('CAPITAL_ONE'),
        ('BARCLAYS'), ('HSBC'), ('LLOYDS'), ('NATWEST'), ('MONZO'), ('REVOLUT'),
        ('STARLING'), ('DEUTSCHE_BANK'), ('COMMERZBANK'), ('N26'), ('BNP_PARIBAS'),
        ('SOCIETE_GENERALE'), ('SANTANDER'), ('BBVA'), ('ITAU'), ('NUBANK'),
        ('EMIRATES_NBD'), ('DBS'), ('CBA'), ('RBC')
      ) AS wanted(code)
     WHERE NOT EXISTS (
         SELECT 1 FROM ref.institution i
          WHERE i.institution_code = wanted.code
            AND i.website_domain IS NOT NULL
            AND i.country_code ~ '^[A-Z]{2}$'
     );
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'institutions missing a domain or country: %', v_missing;
    END IF;
END;
$institution_check$;

INSERT INTO ops.schema_migration (
    migration_code, migration_name, architecture_version, checksum_hint, notes
) VALUES (
    'GLOBAL-TAXONOMY',
    'Country-aware merchant classifier and institution reference coverage',
    'D10 v1.2 FINAL FREEZE',
    'currency-global-taxonomy',
    'Adds spendsense.classify_merchant_global beside the Indian classify_movement, seeds the subcategory codes it returns into F10E-v1.2 without forking the version, and fills ref.institution.website_domain plus 26 foreign banks whose country_code resolves an ambiguous $.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
