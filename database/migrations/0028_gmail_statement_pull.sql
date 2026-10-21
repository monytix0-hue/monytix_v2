-- Gmail statement files enter the existing upload path.
-- Email text stays a candidate. A due date is the only structured record taken from it.
-- Holding and policy tables stay empty until a domain reader exists.

BEGIN;

CREATE TABLE core.due_date_notification (
    due_date_notification_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id                 uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    gmail_connection_id      uuid NOT NULL,
    gmail_message_id         text NOT NULL,
    biller                   text NOT NULL,
    amount                   numeric(20,4) NOT NULL,
    currency_code            char(3) NOT NULL DEFAULT 'INR',
    due_date                 date NOT NULL,
    category                 text NOT NULL,
    status                   text NOT NULL DEFAULT 'PENDING',
    created_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT fk_due_date_connection FOREIGN KEY (gmail_connection_id, owner_id)
        REFERENCES core.gmail_connection (gmail_connection_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT uq_due_date_biller UNIQUE (gmail_connection_id, biller, due_date),
    CONSTRAINT ck_due_date_currency CHECK (currency_code = 'INR'),
    CONSTRAINT ck_due_date_category CHECK (category IN ('CREDIT_CARD', 'UTILITY', 'INSURANCE_PREMIUM')),
    CONSTRAINT ck_due_date_status CHECK (status IN ('PENDING', 'PAID', 'OVERDUE')),
    CONSTRAINT ck_due_date_biller CHECK (btrim(biller) <> '')
);

CREATE TABLE core.investment_holding (
    investment_holding_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id              uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    source_document_id    uuid,
    asset_type            text NOT NULL,
    identifier            text NOT NULL,
    name                  text NOT NULL,
    units                 numeric(20,6),
    price                 numeric(20,4),
    value                 numeric(20,4),
    as_of_date            date,
    created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT fk_holding_document FOREIGN KEY (source_document_id, owner_id)
        REFERENCES core.source_document (source_document_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT ck_holding_asset CHECK (asset_type IN ('MUTUAL_FUND', 'EQUITY', 'DEBT'))
);

CREATE TABLE core.insurance_policy (
    insurance_policy_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id            uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    source_document_id  uuid,
    policy_number       text NOT NULL,
    policy_type         text NOT NULL,
    provider            text NOT NULL,
    sum_insured         numeric(20,4),
    premium             numeric(20,4),
    premium_due_date    date,
    renewal_date        date,
    status              text NOT NULL DEFAULT 'ACTIVE',
    created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT fk_policy_document FOREIGN KEY (source_document_id, owner_id)
        REFERENCES core.source_document (source_document_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT uq_policy_number_owner UNIQUE (owner_id, policy_number),
    CONSTRAINT ck_policy_type CHECK (policy_type IN ('HEALTH', 'LIFE', 'TERM', 'VEHICLE')),
    CONSTRAINT ck_policy_status CHECK (status IN ('ACTIVE', 'LAPSED', 'EXPIRED'))
);

CREATE TABLE core.category_choice (
    category_choice_id     uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id               uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    logical_transaction_id uuid NOT NULL REFERENCES core.logical_transaction(logical_transaction_id) ON DELETE RESTRICT,
    category_code          text NOT NULL,
    match_token            text NOT NULL,
    match_scope            text NOT NULL,
    is_explicit            boolean NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_category_choice_logical UNIQUE (logical_transaction_id),
    CONSTRAINT ck_category_choice_scope CHECK (match_scope IN ('EXACT_MERCHANT', 'RAW_TOKEN')),
    CONSTRAINT ck_category_choice_token CHECK (btrim(match_token) <> '')
);

CREATE TABLE core.category_rule (
    category_rule_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id         uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    match_token      text NOT NULL,
    match_scope      text NOT NULL,
    category_code    text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_category_rule_token UNIQUE (owner_id, match_scope, match_token),
    CONSTRAINT ck_category_rule_scope CHECK (match_scope IN ('EXACT_MERCHANT', 'RAW_TOKEN')),
    CONSTRAINT ck_category_rule_token CHECK (btrim(match_token) <> '')
);

CREATE INDEX ix_category_choice_owner_token_explicit
    ON core.category_choice (owner_id, match_token, is_explicit);

ALTER TABLE core.due_date_notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.investment_holding ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.insurance_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.category_choice ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.category_rule ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_due_date_owner_read ON core.due_date_notification
    FOR SELECT USING (owner_id = ops.current_owner_id());
CREATE POLICY pol_holding_owner_read ON core.investment_holding
    FOR SELECT USING (owner_id = ops.current_owner_id());
CREATE POLICY pol_policy_owner_read ON core.insurance_policy
    FOR SELECT USING (owner_id = ops.current_owner_id());
CREATE POLICY pol_category_choice_owner_read ON core.category_choice
    FOR SELECT USING (owner_id = ops.current_owner_id());
CREATE POLICY pol_category_rule_owner_read ON core.category_rule
    FOR SELECT USING (owner_id = ops.current_owner_id());

COMMENT ON TABLE core.due_date_notification IS
'A due date taken from email text. It is not a ledger transaction.';
COMMENT ON TABLE core.investment_holding IS
'Empty until a CAS or broker reader exists. Filename detection does not insert units or NAV.';
COMMENT ON TABLE core.insurance_policy IS
'Empty until a policy reader exists. Policy numbers are unique per owner.';

CREATE OR REPLACE FUNCTION spendsense.clean_counterparty_name(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT nullif(btrim(string_agg(token, ' ' ORDER BY ordinality)), '')
      FROM regexp_split_to_table(
             upper(regexp_replace(split_part(coalesce(p_name, ''), '@', 1), '[^A-Za-z0-9]+', ' ', 'g')),
             ' '
           ) WITH ORDINALITY AS split(token, ordinality)
     WHERE token <> ''
       AND token NOT IN (
           'PVT', 'LTD', 'LIMITED', 'LLP', 'INC',
           'PAYU', 'RAZORPAY', 'BILLDESK', 'CCAVENUE', 'CASHFREE',
           'MUMBAI', 'BANGALORE', 'BENGALURU', 'DELHI', 'CHENNAI', 'HYDERABAD', 'PUNE',
           'KOLKATA', 'BLR', 'GURGAON', 'NOIDA', 'AHMEDABAD', 'JAIPUR', 'KOCHI', 'INDORE'
       );
$$;

CREATE OR REPLACE FUNCTION spendsense.merchant_category_code(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN tokens && ARRAY['SWIGGY', 'BUNDL', 'INSTAMART', 'ZOMATO', 'BLINKIT', 'STARBUCKS']::text[]
          OR p_name ~ '(^| )MCDONALD' THEN 'FOOD_DINING'
        WHEN tokens && ARRAY['UBER', 'OLA', 'FUEL', 'PETROL', 'HPCL', 'BPCL', 'IOCL']::text[] THEN 'MOBILITY_TRANSPORT'
        WHEN tokens && ARRAY['IRCTC']::text[] THEN 'TRAVEL'
        WHEN tokens && ARRAY['JIO', 'AIRTEL']::text[] THEN 'UTILITIES_COMMUNICATION'
        WHEN tokens && ARRAY['AMAZON']::text[] THEN 'SHOPPING_RETAIL'
        WHEN tokens && ARRAY['NETFLIX']::text[] THEN 'ENTERTAINMENT_MEDIA'
        WHEN tokens && ARRAY['HOSPITAL', 'PHARMACY', 'APOLLO', 'NETMEDS', 'PHARMEASY']::text[] THEN 'HEALTH_MEDICAL'
        ELSE NULL
    END
      FROM (
        SELECT string_to_array(upper(btrim(coalesce(p_name, ''))), ' ') AS tokens
      ) named;
$$;

CREATE OR REPLACE FUNCTION spendsense.overlay_bank_narration(
    p_description text,
    p_parsed jsonb,
    p_bank text
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_text text := btrim(regexp_replace(coalesce(p_description, ''), '\s+', ' ', 'g'));
    v_bank text := upper(coalesce(p_bank, ''));
    v_match text[];
    v_channel text;
    v_subtype text;
    v_party text;
    v_ref text;
    v_parsed jsonb := COALESCE(p_parsed, '{}'::jsonb);
    v_cleaned text;
BEGIN
    IF v_bank IN ('', 'HDFC') AND v_channel IS NULL THEN
        v_match := regexp_match(v_text, '^UPI-([A-Z0-9 .&]+)-([A-Z0-9.]+@[A-Z0-9.]+)-[A-Z0-9]+-([0-9]{12})-', 'i');
        IF v_match IS NOT NULL THEN
            v_channel := 'UPI'; v_party := v_match[1]; v_ref := v_match[3];
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, '^UPI-([0-9]{12})-(.+?)-HDFCBANK-', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'UPI'; v_ref := v_match[1]; v_party := v_match[2];
            END IF;
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, '^IMPS-P2A-([0-9]+)-(.+?)-HDFC$', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'IMPS'; v_ref := v_match[1]; v_party := v_match[2];
            END IF;
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, '^NEFT CR-[A-Z0-9]+-(.+)-([A-Z0-9]+)$', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'NEFT'; v_party := v_match[1]; v_ref := v_match[2];
            END IF;
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, '^POS[[:space:]]+[0-9]+X+[0-9]+[[:space:]]+(.+)$', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'POS'; v_subtype := 'POS';
                v_party := regexp_replace(v_match[1], '[[:space:]]+(MUMBAI|BANGALORE|BENGALURU|DELHI|CHENNAI|HYDERABAD|PUNE|KOLKATA|BLR)$', '', 'i');
            END IF;
        END IF;
        IF v_channel IS NULL AND v_text ~* 'ECOM' AND v_text ~* '[0-9]+X+[0-9]+' THEN
            v_channel := 'POS'; v_subtype := 'CARD_ECOMMERCE';
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, '^NWD-(ATM[0-9]+)-', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'ATM'; v_ref := v_match[1];
            END IF;
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, '^ACH D-[[:space:]]*[A-Z0-9]+-[[:space:]]*(.+)$', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'ACH'; v_party := v_match[1];
            END IF;
        END IF;
    END IF;

    IF v_bank IN ('', 'ICICI') AND v_channel IS NULL THEN
        v_match := regexp_match(v_text, '^/UPI/([0-9]+)/([^/]+)/', 'i');
        IF v_match IS NOT NULL THEN
            v_channel := 'UPI'; v_ref := v_match[1]; v_party := v_match[2];
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, 'MMID/IMPS/([0-9]+)/([^/]+)', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'IMPS'; v_ref := v_match[1]; v_party := v_match[2];
            END IF;
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, 'INF/NEFT/([^/]+)/([^/]+)/', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'NEFT'; v_ref := v_match[1]; v_party := v_match[2];
            END IF;
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, 'INF/RTGS/([^/]+)/([^/]+)/', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'RTGS'; v_ref := v_match[1]; v_party := v_match[2];
            END IF;
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, '^VPS/([^/]+)/', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'POS'; v_subtype := 'POS'; v_party := v_match[1];
            END IF;
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, '^NFS/CASH WDL/([^/]+)/', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'ATM'; v_ref := v_match[1];
            END IF;
        END IF;
        IF v_channel IS NULL AND v_text ~* 'CMS/NACH/' THEN
            v_channel := 'NACH';
            v_match := regexp_match(v_text, 'CMS/NACH/([^/]+)', 'i');
            IF v_match IS NOT NULL THEN
                v_party := v_match[1];
            END IF;
        END IF;
    END IF;

    IF v_bank IN ('', 'SBI') AND v_channel IS NULL THEN
        v_match := regexp_match(v_text, 'TRANSFER-UPI/DR/([0-9]+)/[^/]+/([^/]+)', 'i');
        IF v_match IS NOT NULL THEN
            v_channel := 'UPI'; v_ref := v_match[1]; v_party := v_match[2];
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, 'TRANSFER-INB IMPS([0-9]+)/([^/]+)/', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'IMPS'; v_ref := v_match[1]; v_party := v_match[2];
            END IF;
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, 'ATM WDL ATM ([A-Z0-9]+)', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'ATM'; v_ref := v_match[1];
            END IF;
        END IF;
        IF v_channel IS NULL AND v_text ~* 'POS DEBIT' THEN
            v_channel := 'POS'; v_subtype := 'POS';
            v_match := regexp_match(v_text, 'POS DEBIT-?(.*)$', 'i');
            IF v_match IS NOT NULL THEN
                v_party := nullif(btrim(v_match[1]), '');
            END IF;
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, 'NEFT/([A-Z0-9]{16})(?:/([^/]+))?', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'NEFT'; v_ref := v_match[1]; v_party := v_match[2];
            END IF;
        END IF;
    END IF;

    IF v_bank IN ('', 'AXIS') AND v_channel IS NULL THEN
        v_match := regexp_match(v_text, '^UPI/([0-9]+)/([^/]+)/', 'i');
        IF v_match IS NOT NULL THEN
            v_channel := 'UPI'; v_ref := v_match[1]; v_party := v_match[2];
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, '^IMPS/P2A/([0-9]+)/([^/]+)/', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'IMPS'; v_ref := v_match[1]; v_party := v_match[2];
            END IF;
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, '^ECOM PUR/([^/]+)/', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'POS'; v_subtype := 'CARD_ECOMMERCE'; v_party := v_match[1];
            END IF;
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, '^(?:POS PUR|EDC)/([^/]*)', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'POS'; v_subtype := 'POS'; v_party := nullif(btrim(v_match[1]), '');
            END IF;
        END IF;
        IF v_channel IS NULL THEN
            v_match := regexp_match(v_text, 'NEFT[-[:space:]]?(?:AX)?([A-Z0-9]{16})[-[:space:]/]+(.+)$', 'i');
            IF v_match IS NOT NULL THEN
                v_channel := 'NEFT'; v_ref := v_match[1]; v_party := v_match[2];
            END IF;
        END IF;
    END IF;

    IF v_channel IS NULL AND v_text ~* '^RTGS' THEN
        v_channel := 'RTGS';
    ELSIF v_channel IS NULL AND (v_text ~* '\yECOM\y' OR v_text ~* 'WWW[.]') THEN
        v_channel := 'POS'; v_subtype := 'CARD_ECOMMERCE';
    ELSIF v_channel IS NULL AND (v_text ~* '^NFS' OR v_text ~* 'ATM-WDL') THEN
        v_channel := 'ATM';
    ELSIF v_channel IS NULL AND v_text ~* 'ECS/' THEN
        v_channel := 'ACH';
    ELSIF v_channel IS NULL AND v_text !~* 'INET-IMPS' AND v_text ~* 'NET[-\s]?BANKING|NETBANKING' THEN
        v_channel := 'NET_BANKING';
    END IF;

    IF v_channel IS NULL THEN
        RETURN v_parsed;
    END IF;
    IF v_party ~ '[0-9]X{2,}[0-9]' THEN
        v_party := NULL;
        v_ref := NULL;
    END IF;
    v_cleaned := spendsense.clean_counterparty_name(v_party);
    v_parsed := jsonb_set(v_parsed, '{channel_type}', to_jsonb(v_channel), true);
    IF v_subtype IS NOT NULL THEN
        v_parsed := jsonb_set(v_parsed, '{sub_type}', to_jsonb(v_subtype), true);
    END IF;
    IF v_parsed->'fields' IS NULL OR jsonb_typeof(v_parsed->'fields') <> 'object' THEN
        v_parsed := jsonb_set(v_parsed, '{fields}', '{}'::jsonb, true);
    END IF;
    IF v_party IS NOT NULL AND btrim(v_party) <> '' THEN
        v_parsed := jsonb_set(v_parsed, '{fields,counterparty_name}', to_jsonb(btrim(v_party)), true);
    END IF;
    IF v_cleaned IS NOT NULL THEN
        v_parsed := jsonb_set(v_parsed, '{fields,cleaned_counterparty}', to_jsonb(v_cleaned), true);
        IF spendsense.merchant_category_code(v_cleaned) IS NOT NULL THEN
            v_parsed := jsonb_set(v_parsed, '{fields,category_code}', to_jsonb(spendsense.merchant_category_code(v_cleaned)), true);
        END IF;
    END IF;
    IF v_ref IS NOT NULL THEN
        v_parsed := jsonb_set(v_parsed, '{fields,payment_reference}', to_jsonb(v_ref), true);
        IF v_channel = 'UPI' THEN
            v_parsed := jsonb_set(v_parsed, '{fields,upi_rrn}', to_jsonb(v_ref), true);
        END IF;
    END IF;
    RETURN v_parsed;
END;
$$;

ALTER FUNCTION spendsense.parse_narration_v4(text, text) RENAME TO parse_narration_v4_base;

CREATE FUNCTION spendsense.parse_narration_v4(p_description text, p_direction text, p_bank text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = spendsense, pg_temp
AS $$
    SELECT spendsense.overlay_bank_narration(
        p_description,
        spendsense.parse_narration_v4_base(p_description, p_direction),
        p_bank
    );
$$;

CREATE FUNCTION spendsense.parse_narration_v4(p_description text, p_direction text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = spendsense, pg_temp
AS $$
    SELECT spendsense.parse_narration_v4(p_description, p_direction, NULL::text);
$$;

DO $$
DECLARE
    src text;
    patched text;
BEGIN
    SELECT pg_get_functiondef('ops.publish_structure_extraction_run(uuid)'::regprocedure) INTO src;
    patched := replace(src, 'WHEN ''CARD_BILLPAY'' THEN ''BILLPAY''', 'WHEN ''CARD_BILLPAY'' THEN ''BILLPAY'' WHEN ''NET_BANKING'' THEN ''NET_BANKING''');
    patched := replace(patched, 'WHEN v_channel = ''POS'' THEN ''POS''', 'WHEN COALESCE(v_parsed->>''sub_type'', '''') = ''CARD_ECOMMERCE'' THEN ''CARD_ECOMMERCE'' WHEN v_channel = ''POS'' THEN ''POS''');
    IF patched IS DISTINCT FROM src THEN
        EXECUTE patched;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ops.list_gmail_poll_targets()
RETURNS TABLE (
    gmail_connection_id uuid,
    owner_id uuid,
    actor_id uuid,
    history_checkpoint text,
    credential_ciphertext text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
    SELECT DISTINCT ON (g.gmail_connection_id)
           g.gmail_connection_id, g.owner_id, m.actor_id, g.history_checkpoint, g.credential_ciphertext
      FROM core.gmail_connection g
      LEFT JOIN core.actor_owner_membership m
        ON m.owner_id = g.owner_id
       AND m.membership_status = 'ACTIVE'
       AND m.effective_to IS NULL
       AND m.effective_from <= clock_timestamp()
     WHERE g.oauth_state = 'AUTHORIZED'
       AND g.credential_ciphertext IS NOT NULL
     ORDER BY g.gmail_connection_id, m.is_default_owner DESC NULLS LAST, m.created_at;
$$;

CREATE OR REPLACE FUNCTION ops.gmail_part_imported(
    p_connection uuid,
    p_message text,
    p_part integer,
    p_key text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM core.gmail_attachment_handoff
         WHERE gmail_connection_id = p_connection
           AND gmail_message_id = p_message
           AND part_index = p_part
    ) OR EXISTS (
        SELECT 1 FROM ops.idempotency_record
         WHERE idempotency_key = p_key
           AND status = 'COMPLETED'
    );
$$;

CREATE OR REPLACE FUNCTION ops.save_gmail_candidate(
    p_owner uuid,
    p_connection uuid,
    p_message text,
    p_part integer,
    p_mime text,
    p_sha text,
    p_provenance jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
BEGIN
    INSERT INTO core.gmail_message_candidate (
        owner_id, gmail_connection_id, gmail_message_id, part_index, mime_type, content_sha256, provenance
    ) VALUES (p_owner, p_connection, p_message, p_part, p_mime, p_sha, p_provenance)
    ON CONFLICT (gmail_connection_id, gmail_message_id, part_index) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION ops.save_gmail_handoff(
    p_owner uuid,
    p_connection uuid,
    p_message text,
    p_part integer,
    p_file_type text,
    p_size bigint,
    p_sha text,
    p_filename text,
    p_provenance jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
BEGIN
    INSERT INTO core.gmail_attachment_handoff (
        owner_id, gmail_connection_id, gmail_message_id, part_index, file_type, byte_size, sha256, original_filename, provenance
    ) VALUES (p_owner, p_connection, p_message, p_part, p_file_type, p_size, p_sha, p_filename, p_provenance)
    ON CONFLICT (gmail_connection_id, gmail_message_id, part_index) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION ops.save_due_date_notification(
    p_owner uuid,
    p_connection uuid,
    p_message text,
    p_biller text,
    p_amount numeric,
    p_due date,
    p_category text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
BEGIN
    INSERT INTO core.due_date_notification (
        owner_id, gmail_connection_id, gmail_message_id, biller, amount, currency_code, due_date, category
    ) VALUES (p_owner, p_connection, p_message, left(btrim(p_biller), 120), p_amount, 'INR', p_due, p_category)
    ON CONFLICT (gmail_connection_id, biller, due_date) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION ops.set_gmail_history_checkpoint(p_connection uuid, p_checkpoint text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
BEGIN
    IF p_checkpoint IS NULL OR p_checkpoint !~ '^[0-9]+$' THEN
        RETURN;
    END IF;
    UPDATE core.gmail_connection
       SET history_checkpoint = p_checkpoint, updated_at = clock_timestamp()
     WHERE gmail_connection_id = p_connection;
END;
$$;

CREATE OR REPLACE FUNCTION ops.apply_import_categories(p_run uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, spendsense, pg_temp
AS $$
DECLARE
    v_logical uuid;
    v_owner uuid;
    v_description text;
    v_direction text;
    v_parsed jsonb;
    v_cleaned text;
    v_rule text;
    v_system text;
    v_category text;
BEGIN
    FOR v_logical, v_owner, v_description, v_direction IN
        SELECT DISTINCT d.logical_transaction_id, fa.owner_id, cv.raw_description, cv.direction
          FROM core.source_record_disposition d
          JOIN core.source_record sr ON sr.source_record_id = d.source_record_id
          JOIN core.logical_transaction lt ON lt.logical_transaction_id = d.logical_transaction_id
          JOIN core.financial_account fa ON fa.financial_account_id = lt.financial_account_id
          JOIN core.canonical_transaction_version cv
            ON cv.logical_transaction_id = lt.logical_transaction_id
           AND cv.is_current
         WHERE sr.extraction_run_id = p_run
           AND d.logical_transaction_id IS NOT NULL
           AND d.outcome IN ('MAPPED', 'LINKED_EXISTING')
           AND NOT EXISTS (
               SELECT 1 FROM core.category_choice existing
                WHERE existing.logical_transaction_id = d.logical_transaction_id
                  AND existing.is_explicit
           )
    LOOP
        v_parsed := spendsense.parse_narration_v4(v_description, v_direction);
        v_cleaned := nullif(btrim(coalesce(v_parsed #>> '{fields,cleaned_counterparty}', '')), '');
        v_rule := NULL;
        IF v_cleaned IS NOT NULL THEN
            SELECT category_code INTO v_rule
              FROM core.category_rule
             WHERE owner_id = v_owner
               AND match_scope = 'EXACT_MERCHANT'
               AND match_token = v_cleaned
             LIMIT 1;
        END IF;
        v_system := nullif(btrim(coalesce(v_parsed #>> '{fields,category_code}', spendsense.merchant_category_code(v_cleaned))), '');
        v_category := coalesce(v_rule, v_system);
        IF v_category IS NULL OR v_cleaned IS NULL THEN
            CONTINUE;
        END IF;
        INSERT INTO core.category_choice (
            owner_id, logical_transaction_id, category_code, match_token, match_scope, is_explicit
        ) VALUES (v_owner, v_logical, v_category, v_cleaned, 'EXACT_MERCHANT', false)
        ON CONFLICT (logical_transaction_id) DO UPDATE
            SET category_code = EXCLUDED.category_code,
                match_token = EXCLUDED.match_token
          WHERE core.category_choice.is_explicit = false;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION ops.set_transaction_category(
    p_actor uuid,
    p_owner uuid,
    p_logical uuid,
    p_category text,
    p_apply_to_past boolean,
    p_match_scope text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, spendsense, ops, pg_temp
AS $$
DECLARE
    v_description text;
    v_direction text;
    v_parsed jsonb;
    v_counterparty text;
    v_token text;
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
    v_token := CASE WHEN p_match_scope = 'RAW_TOKEN' THEN v_sanitized ELSE btrim(v_counterparty) END;
    IF v_token IS NULL OR v_token = '' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    INSERT INTO core.category_choice (
        owner_id, logical_transaction_id, category_code, match_token, match_scope, is_explicit
    ) VALUES (p_owner, p_logical, p_category, v_token, p_match_scope, true)
    ON CONFLICT (logical_transaction_id) DO UPDATE
        SET category_code = EXCLUDED.category_code,
            match_token = EXCLUDED.match_token,
            match_scope = EXCLUDED.match_scope,
            is_explicit = true;

    INSERT INTO core.category_rule (owner_id, match_token, match_scope, category_code)
    VALUES (p_owner, v_token, p_match_scope, p_category)
    ON CONFLICT (owner_id, match_scope, match_token) DO UPDATE
        SET category_code = EXCLUDED.category_code;

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
                    CONTINUE;
                END IF;
            ELSE
                v_other_token := btrim(regexp_replace(upper(coalesce(v_other_description, '')), '[^A-Z0-9]+', ' ', 'g'));
                IF position(' ' || v_token || ' ' IN ' ' || v_other_token || ' ') = 0 THEN
                    CONTINUE;
                END IF;
            END IF;
            INSERT INTO core.category_choice (
                owner_id, logical_transaction_id, category_code, match_token, match_scope, is_explicit
            ) VALUES (p_owner, v_other, p_category, v_token, p_match_scope, true)
            ON CONFLICT (logical_transaction_id) DO UPDATE
                SET category_code = EXCLUDED.category_code,
                    match_token = EXCLUDED.match_token,
                    match_scope = EXCLUDED.match_scope,
                    is_explicit = true
              WHERE core.category_choice.is_explicit = false;
            GET DIAGNOSTICS v_written = ROW_COUNT;
            IF v_written > 0 THEN
                v_count := v_count + 1;
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
$$;

REVOKE ALL ON FUNCTION spendsense.parse_narration_v4(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION spendsense.parse_narration_v4(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION spendsense.overlay_bank_narration(text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.list_gmail_poll_targets() FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.gmail_part_imported(uuid, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.save_gmail_candidate(uuid, uuid, text, integer, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.save_gmail_handoff(uuid, uuid, text, integer, text, bigint, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.save_due_date_notification(uuid, uuid, text, text, numeric, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.set_gmail_history_checkpoint(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.apply_import_categories(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.set_transaction_category(uuid, uuid, uuid, text, boolean, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION spendsense.parse_narration_v4(text, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION spendsense.parse_narration_v4(text, text, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION spendsense.overlay_bank_narration(text, jsonb, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION spendsense.clean_counterparty_name(text) TO monytix_api;
GRANT EXECUTE ON FUNCTION spendsense.merchant_category_code(text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.list_gmail_poll_targets() TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.gmail_part_imported(uuid, text, integer, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.save_gmail_candidate(uuid, uuid, text, integer, text, text, jsonb) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.save_gmail_handoff(uuid, uuid, text, integer, text, bigint, text, text, jsonb) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.save_due_date_notification(uuid, uuid, text, text, numeric, date, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.set_gmail_history_checkpoint(uuid, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.apply_import_categories(uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.set_transaction_category(uuid, uuid, uuid, text, boolean, text) TO monytix_api;

GRANT SELECT ON core.due_date_notification, core.investment_holding, core.insurance_policy, core.category_choice, core.category_rule TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'GMAIL-STATEMENT-PULL',
    'Pull Gmail statement files into the existing import path',
    'D10 v1.2 FINAL FREEZE',
    'M2.11-v1',
    'Statement files use authorize_statement_upload. Only BANKING is mapped. Email text can record a due date and cannot become ledger truth.'
)
ON CONFLICT (migration_code) DO UPDATE SET notes = EXCLUDED.notes;

COMMIT;
