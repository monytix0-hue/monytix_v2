-- Reviewed copy of the supplied D10-1 foundation pack.
-- Source: frs/Monytix_Personal_Deployment_Bundle.zip API:Technicals/D10-1/D10_1_foundation_identity.sql
-- Does not alter public stub tables from 0001_init.sql and does not create a second ledger.

-- ============================================================================
-- MONYTIX D10-1 - Foundation & Identity
-- Version: 1.0 implementation pack aligned to D10 v1.2 FINAL FREEZE
-- Scope:
--   * Create eight vNext schemas
--   * Establish UUIDv7 + audit/request-context conventions
--   * Create migration ledger
--   * Create global institution reference foundation
--   * Create owner / authenticated actor / membership foundation
--   * Create financial account / instrument / ownership / currency bucket model
-- Non-goals:
--   * No legacy table mutation or migration (D10-9)
--   * No source intake/canonical ledger tables (D10-2)
--   * No transaction intelligence tables (D10-3 onward)
--
-- Execution model:
--   Run as the vNext schema owner/migration role. This migration is idempotent.
--   Application/service role grants are intentionally deferred to A10/ops rollout.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 0. Required extension and vNext schemas
-- --------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS intel;
CREATE SCHEMA IF NOT EXISTS evidence;
CREATE SCHEMA IF NOT EXISTS context;
CREATE SCHEMA IF NOT EXISTS action;
CREATE SCHEMA IF NOT EXISTS experience;
CREATE SCHEMA IF NOT EXISTS ref;
CREATE SCHEMA IF NOT EXISTS ops;

COMMENT ON SCHEMA core       IS 'Authoritative owner, account, source and canonical financial truth.';
COMMENT ON SCHEMA intel      IS 'Transaction structure, party, event, taxonomy and semantic intelligence.';
COMMENT ON SCHEMA evidence   IS 'Evidence facts, aggregates, baselines and signal observations.';
COMMENT ON SCHEMA context    IS 'Weights, profile, context and reconciliation state.';
COMMENT ON SCHEMA action     IS 'Decisions, Missions, outcomes, financial impact and M.I.L.E. ledgers.';
COMMENT ON SCHEMA experience IS 'Disposable/rebuildable user-facing read projections including Live.';
COMMENT ON SCHEMA ref        IS 'Governed global reference and policy registries.';
COMMENT ON SCHEMA ops        IS 'Operational lineage, replay, outbox, audit, migration and diagnostics.';

-- --------------------------------------------------------------------------
-- 1. UUIDv7 generator
--    D10 v1.2 freezes UUIDv7 for new vNext PKs. This SQL implementation is
--    used rather than assuming the PostgreSQL server already exposes uuidv7().
--    UUID byte layout follows RFC 9562: 48-bit Unix ms timestamp, version 7,
--    RFC 4122 variant, and 74 random bits.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.uuid_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
PARALLEL SAFE
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    ts_ms bigint;
    rnd bytea;
    b bytea := decode(repeat('00', 16), 'hex');
    h text;
    i integer;
BEGIN
    ts_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
    rnd := gen_random_bytes(10);

    b := set_byte(b, 0, ((ts_ms >> 40) & 255)::integer);
    b := set_byte(b, 1, ((ts_ms >> 32) & 255)::integer);
    b := set_byte(b, 2, ((ts_ms >> 24) & 255)::integer);
    b := set_byte(b, 3, ((ts_ms >> 16) & 255)::integer);
    b := set_byte(b, 4, ((ts_ms >> 8)  & 255)::integer);
    b := set_byte(b, 5, ( ts_ms        & 255)::integer);

    -- Version 7 in the high nibble of byte 6 + 12 bits rand_a.
    b := set_byte(b, 6, (112 | (get_byte(rnd, 0) & 15))::integer);
    b := set_byte(b, 7, get_byte(rnd, 1));

    -- RFC 4122 variant 10xxxxxx + remaining rand_b.
    b := set_byte(b, 8, (128 | (get_byte(rnd, 2) & 63))::integer);
    FOR i IN 9..15 LOOP
        b := set_byte(b, i, get_byte(rnd, i - 6));
    END LOOP;

    h := encode(b, 'hex');
    RETURN (
        substr(h, 1, 8)  || '-' ||
        substr(h, 9, 4)  || '-' ||
        substr(h, 13, 4) || '-' ||
        substr(h, 17, 4) || '-' ||
        substr(h, 21, 12)
    )::uuid;
END;
$$;

COMMENT ON FUNCTION ops.uuid_v7() IS
'Generates RFC 9562 UUIDv7 IDs for new vNext objects. UUID ordering is not a substitute for domain timestamps/version numbers.';

-- --------------------------------------------------------------------------
-- 2. Common operational helpers
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ops.current_actor_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION ops.current_owner_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.owner_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION ops.current_actor_id() IS
'Reads the A10-validated actor context from transaction-local setting app.actor_id. It is not authentication by itself.';
COMMENT ON FUNCTION ops.current_owner_id() IS
'Reads the A10-validated owner context from transaction-local setting app.owner_id. It is not authorization by itself.';

-- --------------------------------------------------------------------------
-- 3. Migration ledger
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.schema_migration (
    migration_code       text PRIMARY KEY,
    migration_name       text NOT NULL,
    architecture_version text NOT NULL,
    checksum_hint        text,
    applied_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
    notes                text
);

COMMENT ON TABLE ops.schema_migration IS
'vNext migration ledger. Tracks D10 numbered waves; does not replace the deployment tool migration history.';

-- --------------------------------------------------------------------------
-- 4. Global institution reference foundation
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ref.institution (
    institution_id     uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    institution_code   text NOT NULL,
    display_name       text NOT NULL,
    legal_name         text,
    institution_type   text NOT NULL DEFAULT 'OTHER',
    country_code       char(2) NOT NULL DEFAULT 'IN',
    swift_bic          text,
    website_domain     text,
    status             text NOT NULL DEFAULT 'ACTIVE',
    metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_ref_institution_code UNIQUE (institution_code),
    CONSTRAINT ck_ref_institution_code_nonblank CHECK (btrim(institution_code) <> ''),
    CONSTRAINT ck_ref_institution_display_nonblank CHECK (btrim(display_name) <> ''),
    CONSTRAINT ck_ref_institution_country CHECK (country_code ~ '^[A-Z]{2}$'),
    CONSTRAINT ck_ref_institution_type CHECK (institution_type IN (
        'BANK','NBFC','CARD_ISSUER','WALLET','BROKER','AMC','INSURER',
        'GOVERNMENT','PAYMENT_PROVIDER','OTHER'
    )),
    CONSTRAINT ck_ref_institution_status CHECK (status IN ('ACTIVE','INACTIVE','MERGED','UNKNOWN'))
);

CREATE INDEX IF NOT EXISTS ix_ref_institution_name
    ON ref.institution (lower(display_name));
CREATE INDEX IF NOT EXISTS ix_ref_institution_country_type
    ON ref.institution (country_code, institution_type)
    WHERE status = 'ACTIVE';

DROP TRIGGER IF EXISTS trg_ref_institution_touch_updated_at ON ref.institution;
CREATE TRIGGER trg_ref_institution_touch_updated_at
BEFORE UPDATE ON ref.institution
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

COMMENT ON TABLE ref.institution IS
'Global institution identity shared across Personal and Business. Owner-specific relationships/aliases must not be stored here.';

-- Seed only institutions evidenced in the F10A wave-1 parser asset inventory.
INSERT INTO ref.institution (institution_code, display_name, institution_type, country_code, metadata)
VALUES
    ('HDFC',    'HDFC Bank',       'BANK', 'IN', '{"wave1_parser_asset":true}'::jsonb),
    ('ICICI',   'ICICI Bank',      'BANK', 'IN', '{"wave1_parser_asset":true}'::jsonb),
    ('SBI',     'State Bank of India', 'BANK', 'IN', '{"wave1_parser_asset":true}'::jsonb),
    ('AXIS',    'Axis Bank',       'BANK', 'IN', '{"wave1_parser_asset":true}'::jsonb),
    ('FEDERAL', 'Federal Bank',    'BANK', 'IN', '{"wave1_parser_asset":true}'::jsonb),
    ('CANARA',  'Canara Bank',     'BANK', 'IN', '{"wave1_parser_asset":true}'::jsonb)
ON CONFLICT (institution_code) DO NOTHING;

-- --------------------------------------------------------------------------
-- 5. Authenticated actor projection
--    Credentials/tokens/passwords remain in Firebase/Supabase/external IdP.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.authenticated_actor (
    actor_id              uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    actor_type            text NOT NULL DEFAULT 'HUMAN',
    auth_provider         text NOT NULL,
    auth_subject          text NOT NULL,
    email                 text,
    display_name          text,
    status                text NOT NULL DEFAULT 'ACTIVE',
    last_authenticated_at timestamptz,
    metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_authenticated_actor_provider_subject UNIQUE (auth_provider, auth_subject),
    CONSTRAINT ck_authenticated_actor_provider_nonblank CHECK (btrim(auth_provider) <> ''),
    CONSTRAINT ck_authenticated_actor_subject_nonblank CHECK (btrim(auth_subject) <> ''),
    CONSTRAINT ck_authenticated_actor_type CHECK (actor_type IN ('HUMAN','SERVICE')),
    CONSTRAINT ck_authenticated_actor_status CHECK (status IN ('ACTIVE','SUSPENDED','DISABLED'))
);

CREATE INDEX IF NOT EXISTS ix_authenticated_actor_email
    ON core.authenticated_actor (lower(email)) WHERE email IS NOT NULL;

DROP TRIGGER IF EXISTS trg_authenticated_actor_touch_updated_at ON core.authenticated_actor;
CREATE TRIGGER trg_authenticated_actor_touch_updated_at
BEFORE UPDATE ON core.authenticated_actor
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

COMMENT ON TABLE core.authenticated_actor IS
'Domain/RLS projection of an authenticated principal. Never stores credentials or bearer tokens.';

-- --------------------------------------------------------------------------
-- 6. Owner / tenant context
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.owner (
    owner_id               uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_type             text NOT NULL,
    display_name           text,
    default_currency_code  char(3) NOT NULL DEFAULT 'INR',
    timezone_name          text NOT NULL DEFAULT 'Asia/Kolkata',
    status                 text NOT NULL DEFAULT 'ACTIVE',
    metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_owner_type CHECK (owner_type IN ('PERSON','BUSINESS')),
    CONSTRAINT ck_owner_currency CHECK (default_currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_owner_status CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED'))
);

CREATE INDEX IF NOT EXISTS ix_owner_type_status
    ON core.owner (owner_type, status);

DROP TRIGGER IF EXISTS trg_owner_touch_updated_at ON core.owner;
CREATE TRIGGER trg_owner_touch_updated_at
BEFORE UPDATE ON core.owner
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

COMMENT ON TABLE core.owner IS
'Financial-data ownership/tenant context. PERSON and BUSINESS use the same root identity model.';

-- --------------------------------------------------------------------------
-- 7. Actor <-> owner authorization membership
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.actor_owner_membership (
    membership_id      uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    actor_id           uuid NOT NULL REFERENCES core.authenticated_actor(actor_id) ON DELETE RESTRICT,
    owner_id           uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    membership_role    text NOT NULL,
    membership_status  text NOT NULL DEFAULT 'ACTIVE',
    is_default_owner   boolean NOT NULL DEFAULT false,
    effective_from     timestamptz NOT NULL DEFAULT clock_timestamp(),
    effective_to       timestamptz,
    permissions        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_actor_owner_membership_role CHECK (membership_role IN (
        'OWNER','ADMIN','MEMBER','VIEWER','SERVICE'
    )),
    CONSTRAINT ck_actor_owner_membership_status CHECK (membership_status IN (
        'ACTIVE','INVITED','SUSPENDED','REVOKED'
    )),
    CONSTRAINT ck_actor_owner_membership_dates CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_actor_owner_membership_active
    ON core.actor_owner_membership (actor_id, owner_id)
    WHERE membership_status = 'ACTIVE' AND effective_to IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_actor_default_owner_active
    ON core.actor_owner_membership (actor_id)
    WHERE is_default_owner = true
      AND membership_status = 'ACTIVE'
      AND effective_to IS NULL;

CREATE INDEX IF NOT EXISTS ix_actor_owner_membership_owner
    ON core.actor_owner_membership (owner_id, membership_status);

DROP TRIGGER IF EXISTS trg_actor_owner_membership_touch_updated_at ON core.actor_owner_membership;
CREATE TRIGGER trg_actor_owner_membership_touch_updated_at
BEFORE UPDATE ON core.actor_owner_membership
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

-- --------------------------------------------------------------------------
-- 8. Stable financial account identity
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.financial_account (
    financial_account_id       uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    institution_id             uuid REFERENCES ref.institution(institution_id) ON DELETE RESTRICT,
    account_type               text NOT NULL,
    account_subtype            text,
    account_display_name       text,
    masked_identifier          text,
    provider_account_reference text,
    base_currency_code         char(3) NOT NULL DEFAULT 'INR',
    lifecycle_status           text NOT NULL DEFAULT 'ACTIVE',
    opened_on                  date,
    closed_on                  date,
    metadata                   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_financial_account_type CHECK (account_type IN (
        'SAVINGS','CURRENT','CREDIT_CARD','LOAN','INVESTMENT','WALLET',
        'CASH','DEPOSIT','OVERDRAFT','OTHER'
    )),
    CONSTRAINT ck_financial_account_currency CHECK (base_currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_financial_account_status CHECK (lifecycle_status IN (
        'ACTIVE','CLOSED','BLOCKED','DORMANT','UNKNOWN'
    )),
    CONSTRAINT ck_financial_account_dates CHECK (
        closed_on IS NULL OR opened_on IS NULL OR closed_on >= opened_on
    )
);

-- Provider identity can be authoritative when supplied, but masked last-4 never is.
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_account_provider_ref
    ON core.financial_account (institution_id, provider_account_reference)
    WHERE institution_id IS NOT NULL AND provider_account_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_financial_account_institution_type
    ON core.financial_account (institution_id, account_type, lifecycle_status);
CREATE INDEX IF NOT EXISTS ix_financial_account_masked_identifier
    ON core.financial_account (masked_identifier)
    WHERE masked_identifier IS NOT NULL;

DROP TRIGGER IF EXISTS trg_financial_account_touch_updated_at ON core.financial_account;
CREATE TRIGGER trg_financial_account_touch_updated_at
BEFORE UPDATE ON core.financial_account
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

COMMENT ON TABLE core.financial_account IS
'Stable underlying bank/card/wallet/credit/investment account identity. Ownership is separate and may be many-to-many.';
COMMENT ON COLUMN core.financial_account.masked_identifier IS
'Display/resolution evidence only. A last-4 or other masked token is never globally unique.';

-- --------------------------------------------------------------------------
-- 9. Physical / virtual / add-on / tokenized instrument lineage
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.financial_account_instrument (
    instrument_id                  uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    financial_account_id           uuid NOT NULL REFERENCES core.financial_account(financial_account_id) ON DELETE RESTRICT,
    instrument_type                text NOT NULL,
    masked_identifier              text,
    provider_instrument_reference  text,
    predecessor_instrument_id      uuid REFERENCES core.financial_account_instrument(instrument_id) ON DELETE RESTRICT,
    valid_from                     date,
    valid_to                       date,
    status                         text NOT NULL DEFAULT 'ACTIVE',
    metadata                       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at                     timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at                     timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_financial_account_instrument_type CHECK (instrument_type IN (
        'PHYSICAL_CARD','VIRTUAL_CARD','ADD_ON_CARD','TOKENIZED_CARD',
        'REPLACEMENT_CARD','OTHER'
    )),
    CONSTRAINT ck_financial_account_instrument_status CHECK (status IN (
        'ACTIVE','REPLACED','EXPIRED','BLOCKED','UNKNOWN'
    )),
    CONSTRAINT ck_financial_account_instrument_dates CHECK (
        valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from
    ),
    CONSTRAINT ck_financial_account_instrument_not_self_predecessor CHECK (
        predecessor_instrument_id IS NULL OR predecessor_instrument_id <> instrument_id
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_account_instrument_provider_ref
    ON core.financial_account_instrument (financial_account_id, provider_instrument_reference)
    WHERE provider_instrument_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_financial_account_instrument_account_status
    ON core.financial_account_instrument (financial_account_id, status);

DROP TRIGGER IF EXISTS trg_financial_account_instrument_touch_updated_at ON core.financial_account_instrument;
CREATE TRIGGER trg_financial_account_instrument_touch_updated_at
BEFORE UPDATE ON core.financial_account_instrument
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

-- --------------------------------------------------------------------------
-- 10. Owner <-> financial account relationship
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.account_ownership (
    account_ownership_id  uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id              uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    financial_account_id  uuid NOT NULL REFERENCES core.financial_account(financial_account_id) ON DELETE RESTRICT,
    relationship_role     text NOT NULL,
    verification_state    text NOT NULL DEFAULT 'UNVERIFIED',
    relationship_status   text NOT NULL DEFAULT 'ACTIVE',
    verification_source   text,
    effective_from        timestamptz NOT NULL DEFAULT clock_timestamp(),
    effective_to          timestamptz,
    metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_account_ownership_role CHECK (relationship_role IN (
        'PRIMARY_HOLDER','JOINT_HOLDER','AUTHORIZED_USER','ADD_ON_HOLDER',
        'BUSINESS_OWNER','BUSINESS_AUTHORIZED','OTHER'
    )),
    CONSTRAINT ck_account_ownership_verification CHECK (verification_state IN (
        'VERIFIED','DECLARED','UNVERIFIED','REVOKED'
    )),
    CONSTRAINT ck_account_ownership_status CHECK (relationship_status IN (
        'ACTIVE','ENDED','SUSPENDED'
    )),
    CONSTRAINT ck_account_ownership_dates CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_ownership_active
    ON core.account_ownership (owner_id, financial_account_id)
    WHERE relationship_status = 'ACTIVE' AND effective_to IS NULL;
CREATE INDEX IF NOT EXISTS ix_account_ownership_account
    ON core.account_ownership (financial_account_id, relationship_status);
CREATE INDEX IF NOT EXISTS ix_account_ownership_owner
    ON core.account_ownership (owner_id, relationship_status, verification_state);

DROP TRIGGER IF EXISTS trg_account_ownership_touch_updated_at ON core.account_ownership;
CREATE TRIGGER trg_account_ownership_touch_updated_at
BEFORE UPDATE ON core.account_ownership
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

COMMENT ON TABLE core.account_ownership IS
'Owner/account relationship. Joint ownership is represented here; one underlying account is not cloned for each owner.';

-- --------------------------------------------------------------------------
-- 11. Multi-currency account buckets
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.account_currency_bucket (
    account_currency_bucket_id  uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    financial_account_id        uuid NOT NULL REFERENCES core.financial_account(financial_account_id) ON DELETE RESTRICT,
    currency_code               char(3) NOT NULL,
    provider_bucket_reference   text,
    status                      text NOT NULL DEFAULT 'ACTIVE',
    effective_from              timestamptz NOT NULL DEFAULT clock_timestamp(),
    effective_to                timestamptz,
    metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at                  timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at                  timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_account_currency_bucket_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_account_currency_bucket_status CHECK (status IN ('ACTIVE','CLOSED','UNKNOWN')),
    CONSTRAINT ck_account_currency_bucket_dates CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_currency_bucket_identity
    ON core.account_currency_bucket (
        financial_account_id,
        currency_code,
        COALESCE(provider_bucket_reference, '')
    )
    WHERE status = 'ACTIVE' AND effective_to IS NULL;
CREATE INDEX IF NOT EXISTS ix_account_currency_bucket_account
    ON core.account_currency_bucket (financial_account_id, status);

DROP TRIGGER IF EXISTS trg_account_currency_bucket_touch_updated_at ON core.account_currency_bucket;
CREATE TRIGGER trg_account_currency_bucket_touch_updated_at
BEFORE UPDATE ON core.account_currency_bucket
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

-- --------------------------------------------------------------------------
-- 12. RLS foundation
--     A10 must validate actor<->owner authorization, then set transaction-local
--     app.actor_id and app.owner_id. These policies are defense-in-depth.
--     Migration/schema-owner roles normally bypass RLS; application roles must not.
-- --------------------------------------------------------------------------
ALTER TABLE core.authenticated_actor       ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.owner                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.actor_owner_membership    ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.financial_account         ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.financial_account_instrument ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.account_ownership         ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.account_currency_bucket   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_authenticated_actor_self_read ON core.authenticated_actor;
CREATE POLICY pol_authenticated_actor_self_read
ON core.authenticated_actor
FOR SELECT
USING (actor_id = ops.current_actor_id());

DROP POLICY IF EXISTS pol_owner_context_read ON core.owner;
CREATE POLICY pol_owner_context_read
ON core.owner
FOR SELECT
USING (owner_id = ops.current_owner_id());

DROP POLICY IF EXISTS pol_actor_owner_membership_context_read ON core.actor_owner_membership;
CREATE POLICY pol_actor_owner_membership_context_read
ON core.actor_owner_membership
FOR SELECT
USING (
    owner_id = ops.current_owner_id()
    OR actor_id = ops.current_actor_id()
);

DROP POLICY IF EXISTS pol_account_ownership_context_read ON core.account_ownership;
CREATE POLICY pol_account_ownership_context_read
ON core.account_ownership
FOR SELECT
USING (owner_id = ops.current_owner_id());

DROP POLICY IF EXISTS pol_financial_account_owner_read ON core.financial_account;
CREATE POLICY pol_financial_account_owner_read
ON core.financial_account
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM core.account_ownership ao
        WHERE ao.financial_account_id = financial_account.financial_account_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

DROP POLICY IF EXISTS pol_financial_account_instrument_owner_read ON core.financial_account_instrument;
CREATE POLICY pol_financial_account_instrument_owner_read
ON core.financial_account_instrument
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM core.account_ownership ao
        WHERE ao.financial_account_id = financial_account_instrument.financial_account_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

DROP POLICY IF EXISTS pol_account_currency_bucket_owner_read ON core.account_currency_bucket;
CREATE POLICY pol_account_currency_bucket_owner_read
ON core.account_currency_bucket
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM core.account_ownership ao
        WHERE ao.financial_account_id = account_currency_bucket.financial_account_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

-- --------------------------------------------------------------------------
-- 13. Current-state read views
--     Native lifecycle fields remain authoritative; views standardize the
--     D10/F10L "current/active" read convention without flattening semantics.
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW core.v_active_actor_owner_membership
WITH (security_invoker = true) AS
SELECT
    membership_id,
    actor_id,
    owner_id,
    membership_role,
    is_default_owner,
    effective_from,
    permissions,
    created_at,
    updated_at
FROM core.actor_owner_membership
WHERE membership_status = 'ACTIVE'
  AND effective_to IS NULL;

CREATE OR REPLACE VIEW core.v_active_account_ownership
WITH (security_invoker = true) AS
SELECT
    account_ownership_id,
    owner_id,
    financial_account_id,
    relationship_role,
    verification_state,
    verification_source,
    effective_from,
    metadata,
    created_at,
    updated_at
FROM core.account_ownership
WHERE relationship_status = 'ACTIVE'
  AND effective_to IS NULL;

CREATE OR REPLACE VIEW core.v_current_owner_account
WITH (security_invoker = true) AS
SELECT
    ao.owner_id,
    ao.relationship_role,
    ao.verification_state,
    fa.financial_account_id,
    fa.institution_id,
    i.institution_code,
    i.display_name AS institution_name,
    fa.account_type,
    fa.account_subtype,
    fa.account_display_name,
    fa.masked_identifier,
    fa.base_currency_code,
    fa.lifecycle_status,
    (fa.lifecycle_status = 'ACTIVE') AS is_current_active,
    fa.created_at,
    fa.updated_at
FROM core.v_active_account_ownership ao
JOIN core.financial_account fa
  ON fa.financial_account_id = ao.financial_account_id
LEFT JOIN ref.institution i
  ON i.institution_id = fa.institution_id;

COMMENT ON VIEW core.v_current_owner_account IS
'Standard current-state account read view. Domain lifecycle status remains authoritative; is_current_active is a convenience projection.';

-- --------------------------------------------------------------------------
-- 14. Migration registration
-- --------------------------------------------------------------------------
INSERT INTO ops.schema_migration (
    migration_code,
    migration_name,
    architecture_version,
    checksum_hint,
    notes
)
VALUES (
    'D10-1',
    'Foundation & Identity',
    'D10 v1.2 FINAL FREEZE',
    'd10-1-foundation-identity-v1',
    'Eight schemas; UUIDv7; actor/owner/account foundation; RLS-ready current-state views. No legacy mutation.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
