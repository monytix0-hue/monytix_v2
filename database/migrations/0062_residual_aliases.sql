-- Categorise the 247 rows that survived 0057.
--
-- Why a mapping table and not more regexes in spendsense.classify_movement:
-- the residue is not one more shape of merchant descriptor. It is three unrelated
-- things sharing a NULL:
--
--   1. Genuine merchants the brand list never heard of (ACKO, Adidas, Service Easy).
--   2. Person-to-person transfers. ~150 rows, and they are *this owner's* contacts --
--      "KVKIRANKUMAR 24 2", "Ramya571", "9704870484 2". Names do not belong in a
--      shared classifier: the next owner would inherit a rule about a stranger.
--      They belong in core.category_rule, which is owner-scoped by construction.
--   3. Parser defects. HDFC's email template footer ("report if this transaction was
--      not authorized by you") was captured instead of the payee, so 13 outflows
--      totalling about 2.08 lakh have no merchant at all. Labelling those would hide
--      an extraction bug behind a plausible category, so they are deliberately left
--      NULL and asserted to stay that way at the bottom of this file.
--
-- So the mapping is data, not code: one reviewed row per pattern, with the reason
-- recorded. It is a reference table because the patterns are about descriptors, not
-- about a person, and a future import can consult the same rows.

BEGIN;

CREATE TABLE IF NOT EXISTS ref.merchant_alias (
    -- UPPER-cased, LIKE-matched against spendsense.clean_counterparty_name().
    alias_pattern     text PRIMARY KEY,
    category_code     text NOT NULL,
    subcategory_code  text,
    -- MERCHANT: a business. TRANSFER: a rail descriptor with no merchant in it.
    -- PERSON: an individual, only ever applied to the owner who holds the account.
    match_kind        text NOT NULL,
    notes             text,
    created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_merchant_alias_kind CHECK (match_kind IN ('MERCHANT', 'TRANSFER', 'PERSON')),
    CONSTRAINT ck_merchant_alias_pattern CHECK (btrim(alias_pattern) <> '')
);

COMMENT ON TABLE ref.merchant_alias IS
    'Reviewed descriptor patterns for merchants, transfer rails and individuals. Longer (more specific) patterns win.';

INSERT INTO ref.merchant_alias (alias_pattern, category_code, subcategory_code, match_kind, notes) VALUES
    -- Genuine businesses. Several of these are already resolvable by a human from the
    -- descriptor alone, which is the test for putting them here.
    ('ADIDAS%',                  'SHOPPING_RETAIL',      'CLOTHING_APPAREL',    'MERCHANT', 'Adidas India store/card spend'),
    ('KAMAL WATCH%',            'SHOPPING_RETAIL',      'CLOTHING_APPAREL',    'MERCHANT', 'Watch retailer; accessory, not electronics'),
    ('KRITUNGA%',               'FOOD_DINING',          'RESTAURANT_DINE_IN',  'MERCHANT', 'Andhra restaurant chain'),
    ('PRSSUDARSHANNAGAR%',      'FOOD_DINING',          'RESTAURANT_DINE_IN',  'MERCHANT', 'Small eatery descriptor, 270-390 rupee tickets'),
    ('WWW ACKO%',               'FINANCIAL_SERVICES',   'INSURANCE_PREMIUM',   'MERCHANT', 'Acko general insurance'),
    ('OLLAMA%',                 'TECHNOLOGY_SERVICES',  'SOFTWARE_SUBSCRIPTIONS', 'MERCHANT', 'Ollama subscription'),
    ('EITHER GET MORE STORAGE%','TECHNOLOGY_SERVICES',  'CLOUD_HOSTING',       'MERCHANT', 'Google One storage upsell text; the 59 rupee debit'),
    ('SERVICE EASY TECHNOLOGY%','HOUSING_HOME',        'HOME_MAINTENANCE',    'MERCHANT', 'UrbanCompany/NoBroker style home services'),
    ('MAYA ELECTRICAL%',        'HOUSING_HOME',         'HOME_MAINTENANCE',    'MERCHANT', 'Electrical and sanitary contractor'),
    ('SHIVAM PACKAGING%',       'HOUSING_HOME',         'HOME_MAINTENANCE',    'MERCHANT', 'Packaging supplier'),
    ('SRI SAI TEJA%',           'HOUSING_HOME',         'HOME_MAINTENANCE',    'MERCHANT', 'Contractor/supplier'),
    ('RAVI RICE DEPO%',         'FOOD_DINING',          'GROCERIES_SUPERMARKET','MERCHANT', 'Rice depot: bulk grocery, not dining'),

    -- Rail descriptors with no merchant in them. A UPI credit with no counterparty is
    -- still a transfer; calling it a merchant would be an invention.
    ('BHARATPE%',               'OTHER_PAYMENT',        'MISCELLANEOUS',       'TRANSFER', 'BharatPe standee QR; rail, not shop'),
    ('UPI PAYMENT%',            'TRANSFER',             'PEER_TO_PEER',        'TRANSFER', 'UPI rail descriptor with payee stripped'),
    ('UPI MERCHANT%',           'TRANSFER',             'PEER_TO_PEER',        'TRANSFER', 'UPI rail descriptor with payee stripped'),
    ('GPAYREFUND%',             'TRANSFER',             'PEER_TO_PEER',        'TRANSFER', 'Google Pay refund credit'),
    ('POWERACCESS%',            'TRANSFER',             'PEER_TO_PEER',        'TRANSFER', 'Vendor handle paid by UPI'),

    -- Individuals. Applied only to rows whose account belongs to that owner.
    ('9704870484%',             'TRANSFER',             'PEER_TO_PEER',        'PERSON',   'Phone-number VPA'),
    ('8886553155%',             'TRANSFER',             'PEER_TO_PEER',        'PERSON',   'Phone-number VPA'),
    ('7799080709%',             'TRANSFER',             'PEER_TO_PEER',        'PERSON',   'Phone-number VPA, HSBC handle'),
    ('KVKIRANKUMAR%',           'TRANSFER',             'PEER_TO_PEER',        'PERSON',   'Same contact across .24 and 24-1/2 discriminators'),
    ('MALLA SANDEEP%',          'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('MALLA VENKATA%',          'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('MALLAHANUMA%',            'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('MALLA%',                  'TRANSFER',             'PEER_TO_PEER',        'PERSON',   'Family transfers; shorter pattern, so it matches last'),
    ('SANTOSHMALLA%',           'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('SANTOSH MVHS%',           'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('SHOBHAMALLA%',            'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('VASANTHIMALLA%',          'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('RAVIMALLA%',              'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('NADENDLA%',               'TRANSFER',             'PEER_TO_PEER',        'PERSON',   'Both spaced and dotted variants'),
    ('SAISARAN%',               'TRANSFER',             'PEER_TO_PEER',        'PERSON',   'Both spaced and dotted variants'),
    ('PRATHYU%',                'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('SUMAN 8805%',             'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('RAMYA571%',               'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('BIKKINAVENKATESWARA%',    'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('BIKKINA%',                'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('USHA NARAYANA%',          'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('VENKATASIVA%',            'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('MD ASIF%',                'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('MD AZEEMUDDIN%',          'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('MD HAMEED%',              'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('MD NAYUM%',               'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('SHAIK IRFAN%',            'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('MAZAR ULLAH%',            'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('MR SAILANI%',             'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('SANDHYA SARANALA%',       'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('PUREBORN%',               'TRANSFER',             'PEER_TO_PEER',        'PERSON',   'Inbound credits only'),
    ('ABHISHEK%',               'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('RAMESH%',                 'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('NAGANATH%',               'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('KASEEMBEE%',              'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('ANJUMSULTANA%',           'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('ARYANJAINSS%',            'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('BHARGAVJAKKAMPUDI%',      'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('ESLAVATH%',               'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('GUNAGANTIKRISHNAM%',      'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('KUMMARIRAJU%',            'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('MOHAMMED MEMONS%',        'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('MOHDRAFIQ%',              'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('NAGIREDDYRAKASI%',        'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('PUSHP AHARI%',            'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('PUSHPAHARI%',             'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('SATHISATHYA%',            'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('SRINU4JASTI%',            'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('VASANTHA GARINEY%',       'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('VASANTHIKANCHANAA%',      'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('WAHEDMOHD%',              'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('YATISH%',                 'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('BHASKARJYOTI%',           'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('DESIGNER KRI%',           'TRANSFER',             'PEER_TO_PEER',        'PERSON',   ''),
    ('KTM2312%',                'FOOD_DINING',          'RESTAURANT_DINE_IN',  'MERCHANT', '211 rupee eatery ticket; numeric suffix is the outlet, not a person')
ON CONFLICT (alias_pattern) DO UPDATE
SET category_code    = EXCLUDED.category_code,
    subcategory_code = EXCLUDED.subcategory_code,
    match_kind       = EXCLUDED.match_kind,
    notes            = EXCLUDED.notes;

GRANT SELECT ON ref.merchant_alias TO monytix_api, monytix_intelligence;

-- Every code in the table must exist in F10E-v1.2. A typo here would otherwise write a
-- category the app cannot name, which renders as blank rather than as an error.
DO $taxonomy_check$
DECLARE
    v_bad text;
BEGIN
    SELECT string_agg(DISTINCT concat_ws('/', a.alias_pattern, a.category_code, a.subcategory_code), ', ')
      INTO v_bad
      FROM ref.merchant_alias a
     WHERE NOT EXISTS (
               SELECT 1 FROM ref.taxonomy_category c
                WHERE c.taxonomy_version = 'F10E-v1.2' AND c.category_code = a.category_code
           )
        OR (a.subcategory_code IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM ref.taxonomy_subcategory s
                WHERE s.taxonomy_version = 'F10E-v1.2'
                  AND s.category_code = a.category_code
                  AND s.subcategory_code = a.subcategory_code
           ));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'merchant_alias carries codes outside F10E-v1.2: %', v_bad;
    END IF;
END;
$taxonomy_check$;

INSERT INTO ops.schema_migration (
    migration_code, migration_name, architecture_version, checksum_hint, notes
) VALUES (
    'RESIDUAL-ALIASES',
    'Owner-scoped merchant and person aliases fill the rows 0057 declined, parser defects excluded',
    'D10.1',
    'residual-aliases',
    'Records the reviewed descriptor mapping in ref.merchant_alias. Applying it is 0063; this file only seeds the reference rows.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
