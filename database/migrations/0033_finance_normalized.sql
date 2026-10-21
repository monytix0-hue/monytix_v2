-- Normalized finance domains for the Fastify writer.
-- Intelligence never receives grants on these tables.

BEGIN;

CREATE SCHEMA IF NOT EXISTS finance;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monytix_finance') THEN
        CREATE ROLE monytix_finance NOLOGIN NOINHERIT NOBYPASSRLS;
    END IF;
END $$;

ALTER ROLE monytix_finance NOLOGIN NOINHERIT NOBYPASSRLS;

CREATE TABLE finance.financial_accounts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    institution     text,
    masked_account  text NOT NULL,
    channel         text,
    currency_code   char(3) NOT NULL DEFAULT 'INR',
    created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_finance_account UNIQUE (owner_id, masked_account),
    CONSTRAINT ck_finance_account_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_finance_account_mask CHECK (btrim(masked_account) <> '')
);

CREATE TABLE finance.user_category_overrides (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    match_token     text NOT NULL,
    category_id     varchar(64) NOT NULL,
    subcategory_id  varchar(64),
    created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_finance_override UNIQUE (owner_id, match_token)
);

CREATE TABLE finance.ledger_transactions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    account_id          uuid NOT NULL REFERENCES finance.financial_accounts(id) ON DELETE RESTRICT,
    posted_at           timestamptz NOT NULL,
    amount              numeric(14, 2) NOT NULL,
    flow                varchar(8) NOT NULL,
    channel             varchar(32) NOT NULL,
    payment_ref         varchar(128),
    raw_narration       text NOT NULL,
    clean_merchant      varchar(128),
    category_id         varchar(64) NOT NULL,
    subcategory_id      varchar(64),
    is_user_overridden  boolean NOT NULL DEFAULT false,
    currency_code       char(3) NOT NULL DEFAULT 'INR',
    source_mongo_id     text NOT NULL,
    line_no             integer NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_ledger_flow CHECK (flow IN ('IN', 'OUT')),
    CONSTRAINT ck_ledger_amount CHECK (amount > 0),
    CONSTRAINT ck_ledger_channel CHECK (channel IN ('UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD_POS', 'ATM', 'ACH', 'CARD', 'FT', 'OTHER')),
    CONSTRAINT ck_ledger_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT uq_ledger_source_line UNIQUE (source_mongo_id, line_no)
);

CREATE UNIQUE INDEX uq_ledger_payment_ref
    ON finance.ledger_transactions (owner_id, account_id, payment_ref)
    WHERE payment_ref IS NOT NULL;

CREATE TABLE finance.due_date_notifications (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    biller_name      varchar(128) NOT NULL,
    amount_due       numeric(14, 2),
    due_date         date NOT NULL,
    instrument_type  varchar(32) NOT NULL,
    status           varchar(16) NOT NULL DEFAULT 'PENDING',
    currency_code    char(3) NOT NULL DEFAULT 'INR',
    source_mongo_id  text,
    created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_due_alert UNIQUE (owner_id, biller_name, due_date),
    CONSTRAINT ck_due_status CHECK (status IN ('PENDING', 'PAID', 'OVERDUE')),
    CONSTRAINT ck_due_instrument CHECK (instrument_type IN ('CREDIT_CARD', 'UTILITY', 'LOAN_EMI', 'INSURANCE_PREMIUM'))
);

CREATE TABLE finance.mf_holdings (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    folio_number     varchar(64) NOT NULL,
    scheme_name      varchar(255) NOT NULL,
    isin             varchar(16),
    units            numeric(18, 4) NOT NULL,
    nav              numeric(14, 4),
    nav_date         date,
    current_value    numeric(14, 2),
    cost_value       numeric(14, 2),
    currency_code    char(3) NOT NULL DEFAULT 'INR',
    source_mongo_id  text,
    updated_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_folio_scheme UNIQUE (owner_id, folio_number, isin)
);

CREATE TABLE finance.mf_transactions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    holding_id        uuid NOT NULL REFERENCES finance.mf_holdings(id) ON DELETE CASCADE,
    transaction_date  date NOT NULL,
    type              varchar(32) NOT NULL,
    amount            numeric(14, 2) NOT NULL,
    units             numeric(18, 4),
    nav               numeric(14, 4),
    currency_code     char(3) NOT NULL DEFAULT 'INR',
    source_mongo_id   text,
    created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_mf_txn_type CHECK (type IN ('SIP', 'PURCHASE', 'REDEMPTION', 'STAMP_DUTY')),
    CONSTRAINT uq_mf_txn UNIQUE (holding_id, transaction_date, type, amount, units)
);

CREATE TABLE finance.asset_holdings (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    institution       text,
    account_number    varchar(64) NOT NULL,
    principal_amount  numeric(14, 2),
    interest_rate     numeric(7, 2),
    maturity_date     date,
    maturity_amount   numeric(14, 2),
    currency_code     char(3) NOT NULL DEFAULT 'INR',
    source_mongo_id   text,
    updated_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_asset_account UNIQUE (owner_id, account_number)
);

CREATE TABLE finance.investment_holdings (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    instrument_name  text NOT NULL,
    isin             varchar(16) NOT NULL,
    asset_class      varchar(16) NOT NULL,
    units            numeric(18, 4),
    price            numeric(14, 4),
    value            numeric(14, 2),
    as_of_date       date,
    currency_code    char(3) NOT NULL DEFAULT 'INR',
    source_mongo_id  text,
    updated_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_investment_class CHECK (asset_class IN ('EQUITY', 'BOND', 'OTHER')),
    CONSTRAINT uq_investment_isin UNIQUE (owner_id, isin)
);

CREATE TABLE finance.debt_liabilities (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id                uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    lender_name             varchar(128) NOT NULL,
    account_or_loan_number  varchar(64) NOT NULL,
    loan_type               varchar(32) NOT NULL,
    principal_amount        numeric(14, 2),
    outstanding_balance     numeric(14, 2) NOT NULL,
    emi_amount              numeric(14, 2),
    interest_rate           numeric(7, 2),
    next_emi_date           date,
    currency_code           char(3) NOT NULL DEFAULT 'INR',
    source_mongo_id         text,
    updated_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_debt_account UNIQUE (owner_id, account_or_loan_number),
    CONSTRAINT ck_debt_type CHECK (loan_type IN ('HOME_LOAN', 'PERSONAL_LOAN', 'CAR_LOAN', 'BNPL', 'CREDIT_CARD'))
);

CREATE TABLE finance.insurance_policies (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    provider            varchar(128) NOT NULL,
    policy_number       varchar(128) NOT NULL,
    policy_type         varchar(32) NOT NULL,
    sum_insured         numeric(14, 2) NOT NULL,
    premium_amount      numeric(14, 2) NOT NULL,
    premium_frequency   varchar(16) NOT NULL,
    renewal_date        date NOT NULL,
    policy_status       varchar(16) NOT NULL DEFAULT 'ACTIVE',
    currency_code       char(3) NOT NULL DEFAULT 'INR',
    source_mongo_id     text,
    created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_policy UNIQUE (owner_id, policy_number),
    CONSTRAINT ck_policy_type CHECK (policy_type IN ('HEALTH', 'TERM_LIFE', 'VEHICLE', 'LIFE', 'GENERAL')),
    CONSTRAINT ck_policy_frequency CHECK (premium_frequency IN ('ANNUAL', 'MONTHLY')),
    CONSTRAINT ck_policy_status CHECK (policy_status IN ('ACTIVE', 'LAPSED', 'EXPIRED'))
);

INSERT INTO ref.taxonomy_subcategory (taxonomy_version, category_code, subcategory_code, display_name)
VALUES
    ('F10E-v1.2', 'FOOD_DINING', 'FOOD_DELIVERY', 'Food delivery'),
    ('F10E-v1.2', 'FOOD_DINING', 'COFFEE_AND_CAFES', 'Coffee and cafes'),
    ('F10E-v1.2', 'FINANCIAL_SERVICES', 'SIP_AUTO_DEBIT', 'SIP auto debit')
ON CONFLICT (taxonomy_version, subcategory_code) DO NOTHING;

ALTER TABLE finance.financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.user_category_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.due_date_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.mf_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.mf_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.asset_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.investment_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.debt_liabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.insurance_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_finance_account ON finance.financial_accounts
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_finance_override ON finance.user_category_overrides
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_finance_ledger ON finance.ledger_transactions
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_finance_due ON finance.due_date_notifications
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_finance_mf ON finance.mf_holdings
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_finance_mf_txn ON finance.mf_transactions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM finance.mf_holdings h
            WHERE h.id = holding_id AND h.owner_id = ops.current_owner_id()
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM finance.mf_holdings h
            WHERE h.id = holding_id AND h.owner_id = ops.current_owner_id()
        )
    );
CREATE POLICY pol_finance_asset ON finance.asset_holdings
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_finance_investment ON finance.investment_holdings
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_finance_debt ON finance.debt_liabilities
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_finance_policy ON finance.insurance_policies
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());

GRANT USAGE ON SCHEMA finance, core, ref, ops TO monytix_finance;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA finance TO monytix_finance;
GRANT SELECT ON ref.taxonomy_category, ref.taxonomy_subcategory, ref.taxonomy_version TO monytix_finance;
GRANT EXECUTE ON FUNCTION ops.provision_authenticated_actor(text, text, text) TO monytix_finance;
GRANT EXECUTE ON FUNCTION ops.actor_can_access_owner(uuid, uuid) TO monytix_finance;
GRANT EXECUTE ON FUNCTION ops.default_owner_for_actor(uuid) TO monytix_finance;
GRANT EXECUTE ON FUNCTION ops.ensure_personal_owner(uuid, text) TO monytix_finance;
GRANT EXECUTE ON FUNCTION ops.current_owner_id() TO monytix_finance;
GRANT EXECUTE ON FUNCTION ops.current_actor_id() TO monytix_finance;
GRANT EXECUTE ON FUNCTION ops.uuid_v7() TO monytix_finance;

GRANT USAGE ON SCHEMA finance TO monytix_api;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA finance TO monytix_api;
GRANT SELECT ON ref.taxonomy_category, ref.taxonomy_subcategory, ref.taxonomy_version TO monytix_api;

REVOKE ALL ON SCHEMA finance FROM monytix_intelligence;
REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM monytix_intelligence;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'FINANCE-NORMALIZED',
    'Separate finance domains written by the Fastify service',
    'finance-v0.1',
    'finance-schema-rls',
    'Mongo is the raw lake. FastAPI classifies. Fastify writes one domain table per record.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
