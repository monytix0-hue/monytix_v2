-- Reviewed copy of the supplied D10-2 source intake and canonical ledger pack.
-- Follows README_D10_2.md in the same pack.
-- Source: frs/Monytix_Personal_Deployment_Bundle.zip
--   API:Technicals/D10_2_Source_Intake_Canonical_Ledger_Implementation_Pack.zip
--   D10_2_source_intake_canonical_ledger.sql
-- Does not alter 0001 stub tables, D10-1 objects, or B10Q. Does not create txn_fact.

-- ============================================================================
-- MONYTIX D10-2 - Source Intake & Canonical Ledger
-- Version: 1.0 implementation pack aligned to D10 v1.2 FINAL FREEZE
-- Functional authority: F10A Transaction Source, Intake & Canonical Normalization
-- Prerequisite: D10-1 Foundation & Identity
--
-- Scope:
--   * Source connections, batches, documents and multipart sets
--   * Statement context and statement relationships
--   * Adapter registry, extraction runs and source records
--   * Account balance observations and temporal coverage
--   * Stable logical transaction identity
--   * Immutable/versioned canonical transaction representations
--   * Cross-source transaction evidence links
--   * Atomic current-canonical activation and current-state read views
--
-- Non-goals:
--   * No payment-rail / structural interpretation (D10-3 / F10B)
--   * No entity/event/category semantics (D10-3 / F10C-F10F)
--   * No evidence/signals, Weights, Decisions, Missions or M.I.L.E.
--   * No legacy backfill/cutover (later D10 waves)
--
-- Execution model:
--   Run as the vNext schema owner/migration role. This migration is idempotent.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 0. Prerequisite guard: D10-1 must already exist.
-- --------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('ops.schema_migration') IS NULL
       OR to_regclass('core.owner') IS NULL
       OR to_regclass('core.financial_account') IS NULL
       OR to_regprocedure('ops.uuid_v7()') IS NULL THEN
        RAISE EXCEPTION 'D10-2 requires D10-1 Foundation & Identity to be applied first';
    END IF;
END $$;

-- --------------------------------------------------------------------------
-- 1. Adapter registry used by versioned extraction runs.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ref.adapter_registry (
    adapter_version_id   uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    adapter_id           text NOT NULL,
    adapter_version      text NOT NULL,
    institution_id       uuid REFERENCES ref.institution(institution_id) ON DELETE RESTRICT,
    source_type          text NOT NULL,
    layout_code          text,
    status               text NOT NULL DEFAULT 'ACTIVE',
    effective_from       timestamptz,
    effective_to         timestamptz,
    implementation_ref   text,
    configuration        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_adapter_registry_version UNIQUE (adapter_id, adapter_version),
    CONSTRAINT ck_adapter_registry_id_nonblank CHECK (btrim(adapter_id) <> ''),
    CONSTRAINT ck_adapter_registry_version_nonblank CHECK (btrim(adapter_version) <> ''),
    CONSTRAINT ck_adapter_registry_source_type CHECK (source_type IN (
        'BANK_STATEMENT_PDF','BANK_STATEMENT_XLSX','BANK_STATEMENT_XLS','BANK_STATEMENT_CSV',
        'CREDIT_CARD_STATEMENT','AA','BANK_API','EMAIL_ALERT','SMS_ALERT','MANUAL','LEGACY_IMPORT'
    )),
    CONSTRAINT ck_adapter_registry_status CHECK (status IN ('ACTIVE','INACTIVE','DEPRECATED','TESTING')),
    CONSTRAINT ck_adapter_registry_dates CHECK (
        effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from
    )
);

CREATE INDEX IF NOT EXISTS ix_adapter_registry_lookup
    ON ref.adapter_registry (institution_id, source_type, layout_code, status);

COMMENT ON TABLE ref.adapter_registry IS
'Versioned source/institution/layout adapter registry. Extraction runs bind to an exact adapter_version_id.';

-- --------------------------------------------------------------------------
-- 2. Source connection - acquisition mechanism/consent/link, not ownership.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.source_connection (
    source_connection_id           uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id                       uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    institution_id                 uuid REFERENCES ref.institution(institution_id) ON DELETE RESTRICT,
    connection_type                text NOT NULL,
    provider_code                  text,
    provider_connection_reference  text,
    consent_reference              text,
    consent_scope                  jsonb NOT NULL DEFAULT '{}'::jsonb,
    consent_expires_at             timestamptz,
    status                         text NOT NULL DEFAULT 'ACTIVE',
    last_successful_sync_at        timestamptz,
    last_attempted_sync_at         timestamptz,
    metadata                       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at                     timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at                     timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_source_connection_owner_pair UNIQUE (source_connection_id, owner_id),
    CONSTRAINT ck_source_connection_type CHECK (connection_type IN (
        'AA','BANK_API','UPLOAD','EMAIL','SMS','MANUAL','LEGACY_IMPORT'
    )),
    CONSTRAINT ck_source_connection_status CHECK (status IN (
        'ACTIVE','PENDING','EXPIRED','REVOKED','FAILED','DISABLED'
    )),
    CONSTRAINT ck_source_connection_consent_expiry CHECK (
        consent_expires_at IS NULL OR consent_expires_at >= created_at
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_connection_provider_ref
    ON core.source_connection (owner_id, provider_code, provider_connection_reference)
    WHERE provider_code IS NOT NULL AND provider_connection_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_source_connection_owner_status
    ON core.source_connection (owner_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_source_connection_touch_updated_at ON core.source_connection;
CREATE TRIGGER trg_source_connection_touch_updated_at
BEFORE UPDATE ON core.source_connection
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

COMMENT ON TABLE core.source_connection IS
'Owner-scoped acquisition/consent/link context. It is not account ownership and does not contain credentials.';

-- --------------------------------------------------------------------------
-- 3. Source batch - one acquisition attempt/fetch/upload.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.source_batch (
    source_batch_id        uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id               uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    uploaded_by_actor_id   uuid REFERENCES core.authenticated_actor(actor_id) ON DELETE RESTRICT,
    source_connection_id   uuid,
    source_type            text NOT NULL,
    provider_batch_id      text,
    content_hash           text,
    ingestion_mode         text NOT NULL DEFAULT 'PUSH',
    received_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    status                 text NOT NULL DEFAULT 'REGISTERED',
    reason_codes           text[] NOT NULL DEFAULT '{}'::text[],
    metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_source_batch_owner_pair UNIQUE (source_batch_id, owner_id),
    CONSTRAINT fk_source_batch_connection_owner FOREIGN KEY (source_connection_id, owner_id)
        REFERENCES core.source_connection(source_connection_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT ck_source_batch_type CHECK (source_type IN (
        'BANK_STATEMENT_PDF','BANK_STATEMENT_XLSX','BANK_STATEMENT_XLS','BANK_STATEMENT_CSV',
        'CREDIT_CARD_STATEMENT','AA','BANK_API','EMAIL_ALERT','SMS_ALERT','MANUAL','LEGACY_IMPORT'
    )),
    CONSTRAINT ck_source_batch_mode CHECK (ingestion_mode IN ('PUSH','PULL','SYSTEM','MIGRATION')),
    CONSTRAINT ck_source_batch_status CHECK (status IN (
        'REGISTERED','PROCESSING','COMPLETED','PARTIAL','FAILED'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_batch_provider_batch
    ON core.source_batch (owner_id, source_connection_id, provider_batch_id)
    WHERE provider_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_source_batch_owner_received
    ON core.source_batch (owner_id, received_at DESC);
CREATE INDEX IF NOT EXISTS ix_source_batch_hash
    ON core.source_batch (owner_id, content_hash)
    WHERE content_hash IS NOT NULL;

DROP TRIGGER IF EXISTS trg_source_batch_touch_updated_at ON core.source_batch;
CREATE TRIGGER trg_source_batch_touch_updated_at
BEFORE UPDATE ON core.source_batch
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

-- --------------------------------------------------------------------------
-- 4. Source document - immutable evidence metadata/object pointer while retained.
--    Passwords are deliberately absent from this schema.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.source_document (
    source_document_id     uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    source_batch_id        uuid NOT NULL,
    owner_id               uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    uploaded_by_actor_id   uuid REFERENCES core.authenticated_actor(actor_id) ON DELETE RESTRICT,
    content_hash           text,
    original_filename      text,
    declared_mime_type     text,
    observed_mime_type     text,
    object_reference       text,
    size_bytes             bigint,
    received_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    status                 text NOT NULL DEFAULT 'RECEIVED',
    reason_codes           text[] NOT NULL DEFAULT '{}'::text[],
    metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_source_document_owner_pair UNIQUE (source_document_id, owner_id),
    CONSTRAINT fk_source_document_batch_owner FOREIGN KEY (source_batch_id, owner_id)
        REFERENCES core.source_batch(source_batch_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT ck_source_document_size CHECK (size_bytes IS NULL OR size_bytes >= 0),
    CONSTRAINT ck_source_document_status CHECK (status IN (
        'RECEIVED','PASSWORD_REQUIRED','PROCESSING','AVAILABLE','PARTIAL','FAILED',
        'UNSUPPORTED','ERASED_REFERENCE_ONLY'
    ))
);

CREATE INDEX IF NOT EXISTS ix_source_document_batch
    ON core.source_document (source_batch_id, received_at);
CREATE INDEX IF NOT EXISTS ix_source_document_owner_hash
    ON core.source_document (owner_id, content_hash)
    WHERE content_hash IS NOT NULL;

DROP TRIGGER IF EXISTS trg_source_document_touch_updated_at ON core.source_document;
CREATE TRIGGER trg_source_document_touch_updated_at
BEFORE UPDATE ON core.source_document
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

COMMENT ON TABLE core.source_document IS
'Immutable source evidence metadata/object pointer while retained. Ephemeral statement passwords must never be stored here.';

-- --------------------------------------------------------------------------
-- 5. Multipart / split evidence grouping.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.document_set (
    document_set_id      uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id             uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    expected_part_count  integer,
    known_part_count     integer NOT NULL DEFAULT 0,
    set_status           text NOT NULL DEFAULT 'PENDING',
    metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_document_set_owner_pair UNIQUE (document_set_id, owner_id),
    CONSTRAINT ck_document_set_expected CHECK (expected_part_count IS NULL OR expected_part_count > 0),
    CONSTRAINT ck_document_set_known CHECK (known_part_count >= 0),
    CONSTRAINT ck_document_set_counts CHECK (
        expected_part_count IS NULL OR known_part_count <= expected_part_count
    ),
    CONSTRAINT ck_document_set_status CHECK (set_status IN (
        'PENDING','COMPLETE','DISCONTINUOUS','UNKNOWN','CANCELLED'
    ))
);

DROP TRIGGER IF EXISTS trg_document_set_touch_updated_at ON core.document_set;
CREATE TRIGGER trg_document_set_touch_updated_at
BEFORE UPDATE ON core.document_set
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

CREATE TABLE IF NOT EXISTS core.document_set_member (
    document_set_id      uuid NOT NULL,
    source_document_id   uuid NOT NULL,
    owner_id             uuid NOT NULL,
    part_hint            text,
    observed_order       integer,
    created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (document_set_id, source_document_id),
    CONSTRAINT fk_document_set_member_set_owner FOREIGN KEY (document_set_id, owner_id)
        REFERENCES core.document_set(document_set_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_set_member_document_owner FOREIGN KEY (source_document_id, owner_id)
        REFERENCES core.source_document(source_document_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT ck_document_set_member_order CHECK (observed_order IS NULL OR observed_order > 0)
);

CREATE INDEX IF NOT EXISTS ix_document_set_member_document
    ON core.document_set_member (source_document_id);

-- --------------------------------------------------------------------------
-- 6. Statement instance and statement relationships.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.statement_instance (
    statement_instance_id   uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    source_document_id      uuid NOT NULL REFERENCES core.source_document(source_document_id) ON DELETE RESTRICT,
    financial_account_id    uuid REFERENCES core.financial_account(financial_account_id) ON DELETE RESTRICT,
    statement_date          date,
    period_start            date,
    period_end              date,
    billing_period_start    date,
    billing_period_end      date,
    payment_due_date        date,
    opening_balance         numeric(20,4),
    closing_balance         numeric(20,4),
    total_amount_due        numeric(20,4),
    minimum_amount_due      numeric(20,4),
    credit_limit            numeric(20,4),
    available_credit        numeric(20,4),
    currency_code           char(3),
    continuity_status       text NOT NULL DEFAULT 'UNKNOWN',
    account_resolution_status text NOT NULL DEFAULT 'UNRESOLVED',
    statement_status        text NOT NULL DEFAULT 'PARTIAL',
    reason_codes            text[] NOT NULL DEFAULT '{}'::text[],
    metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_statement_instance_period CHECK (
        period_end IS NULL OR period_start IS NULL OR period_end >= period_start
    ),
    CONSTRAINT ck_statement_instance_billing_period CHECK (
        billing_period_end IS NULL OR billing_period_start IS NULL OR billing_period_end >= billing_period_start
    ),
    CONSTRAINT ck_statement_instance_currency CHECK (
        currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT ck_statement_instance_nonnegative_due CHECK (
        (total_amount_due IS NULL OR total_amount_due >= 0)
        AND (minimum_amount_due IS NULL OR minimum_amount_due >= 0)
        AND (credit_limit IS NULL OR credit_limit >= 0)
        AND (available_credit IS NULL OR available_credit >= 0)
    ),
    CONSTRAINT ck_statement_instance_continuity CHECK (continuity_status IN (
        'COMPLETE','PENDING_ADJACENT_PARTS','DISCONTINUOUS_GAPS_DETECTED','UNKNOWN'
    )),
    CONSTRAINT ck_statement_instance_account_resolution CHECK (account_resolution_status IN (
        'RESOLVED','UNRESOLVED','REVIEW_REQUIRED'
    )),
    CONSTRAINT ck_statement_instance_status CHECK (statement_status IN (
        'READY','PARTIAL','REJECTED'
    )),
    CONSTRAINT ck_statement_instance_ready_account CHECK (
        statement_status <> 'READY' OR (financial_account_id IS NOT NULL AND account_resolution_status = 'RESOLVED')
    )
);

CREATE INDEX IF NOT EXISTS ix_statement_instance_document
    ON core.statement_instance (source_document_id, statement_date);
CREATE INDEX IF NOT EXISTS ix_statement_instance_account_period
    ON core.statement_instance (financial_account_id, period_start, period_end)
    WHERE financial_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_statement_instance_due_date
    ON core.statement_instance (financial_account_id, payment_due_date)
    WHERE payment_due_date IS NOT NULL;

DROP TRIGGER IF EXISTS trg_statement_instance_touch_updated_at ON core.statement_instance;
CREATE TRIGGER trg_statement_instance_touch_updated_at
BEFORE UPDATE ON core.statement_instance
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

CREATE TABLE IF NOT EXISTS core.statement_link (
    statement_link_id       uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    from_statement_id       uuid NOT NULL REFERENCES core.statement_instance(statement_instance_id) ON DELETE RESTRICT,
    to_statement_id         uuid NOT NULL REFERENCES core.statement_instance(statement_instance_id) ON DELETE RESTRICT,
    link_type               text NOT NULL,
    confidence              numeric(5,4),
    reason_codes            text[] NOT NULL DEFAULT '{}'::text[],
    created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_statement_link UNIQUE (from_statement_id, to_statement_id, link_type),
    CONSTRAINT ck_statement_link_not_self CHECK (from_statement_id <> to_statement_id),
    CONSTRAINT ck_statement_link_type CHECK (link_type IN (
        'ADJACENT','OVERLAPPING','GAP','REPLACEMENT','SUPERSEDES','RELATED'
    )),
    CONSTRAINT ck_statement_link_confidence CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS ix_statement_link_to
    ON core.statement_link (to_statement_id, link_type);

-- --------------------------------------------------------------------------
-- 7. Extraction run and extractor-produced source records.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.extraction_run (
    extraction_run_id      uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    source_document_id     uuid NOT NULL REFERENCES core.source_document(source_document_id) ON DELETE RESTRICT,
    adapter_version_id     uuid NOT NULL REFERENCES ref.adapter_registry(adapter_version_id) ON DELETE RESTRICT,
    run_no                 integer NOT NULL,
    started_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at           timestamptz,
    status                 text NOT NULL DEFAULT 'STARTED',
    run_reason             text NOT NULL DEFAULT 'INITIAL',
    worker_metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    reason_codes           text[] NOT NULL DEFAULT '{}'::text[],
    created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_extraction_run_document_no UNIQUE (source_document_id, run_no),
    CONSTRAINT ck_extraction_run_no CHECK (run_no > 0),
    CONSTRAINT ck_extraction_run_status CHECK (status IN ('STARTED','COMPLETED','PARTIAL','FAILED')),
    CONSTRAINT ck_extraction_run_reason CHECK (run_reason IN (
        'INITIAL','RETRY','ADAPTER_UPGRADE','MANUAL_REVIEW','MIGRATION'
    )),
    CONSTRAINT ck_extraction_run_dates CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS ix_extraction_run_document
    ON core.extraction_run (source_document_id, run_no DESC);
CREATE INDEX IF NOT EXISTS ix_extraction_run_adapter
    ON core.extraction_run (adapter_version_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS core.source_record (
    source_record_id          uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    extraction_run_id         uuid NOT NULL REFERENCES core.extraction_run(extraction_run_id) ON DELETE RESTRICT,
    source_locator            text,
    extraction_sequence       integer NOT NULL,
    source_sequence           text,
    raw_record_payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw_description           text,
    raw_transaction_date      text,
    raw_transaction_timestamp text,
    raw_value_date            text,
    raw_debit                 text,
    raw_credit                text,
    raw_amount                text,
    raw_balance               text,
    raw_reference             text,
    record_status             text NOT NULL,
    reason_codes              text[] NOT NULL DEFAULT '{}'::text[],
    created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_source_record_run_sequence UNIQUE (extraction_run_id, extraction_sequence),
    CONSTRAINT ck_source_record_sequence CHECK (extraction_sequence > 0),
    CONSTRAINT ck_source_record_status CHECK (record_status IN (
        'TRANSACTION_CANDIDATE','NON_TRANSACTION','EXTRACTION_PARTIAL','EXTRACTION_REJECTED'
    ))
);

CREATE INDEX IF NOT EXISTS ix_source_record_run
    ON core.source_record (extraction_run_id, extraction_sequence);
CREATE INDEX IF NOT EXISTS ix_source_record_reference
    ON core.source_record (raw_reference)
    WHERE raw_reference IS NOT NULL;

COMMENT ON TABLE core.source_record IS
'Extractor-produced observation for one extraction run. source_document remains the immutable replay root.';

-- --------------------------------------------------------------------------
-- 8. Balance observations and account temporal coverage.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.balance_snapshot (
    balance_snapshot_id        uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    financial_account_id       uuid NOT NULL REFERENCES core.financial_account(financial_account_id) ON DELETE RESTRICT,
    account_currency_bucket_id uuid REFERENCES core.account_currency_bucket(account_currency_bucket_id) ON DELETE RESTRICT,
    source_document_id         uuid REFERENCES core.source_document(source_document_id) ON DELETE RESTRICT,
    statement_instance_id      uuid REFERENCES core.statement_instance(statement_instance_id) ON DELETE RESTRICT,
    source_record_id           uuid REFERENCES core.source_record(source_record_id) ON DELETE RESTRICT,
    observed_at                timestamptz NOT NULL,
    balance_type               text NOT NULL DEFAULT 'LEDGER',
    balance_amount             numeric(20,4) NOT NULL,
    currency_code              char(3) NOT NULL,
    source_quality             text NOT NULL DEFAULT 'OBSERVED',
    created_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_balance_snapshot_type CHECK (balance_type IN (
        'LEDGER','AVAILABLE','OPENING','CLOSING','CREDIT_LIMIT','AVAILABLE_CREDIT','OTHER'
    )),
    CONSTRAINT ck_balance_snapshot_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_balance_snapshot_quality CHECK (source_quality IN ('OBSERVED','PROVIDER'))
);

CREATE INDEX IF NOT EXISTS ix_balance_snapshot_account_time
    ON core.balance_snapshot (financial_account_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS core.account_data_coverage (
    coverage_id            uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    financial_account_id   uuid NOT NULL REFERENCES core.financial_account(financial_account_id) ON DELETE RESTRICT,
    period_start           date NOT NULL,
    period_end             date NOT NULL,
    coverage_status        text NOT NULL,
    source_statement_id    uuid REFERENCES core.statement_instance(statement_instance_id) ON DELETE RESTRICT,
    gap_reason             text,
    coverage_basis         jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_account_data_coverage_period CHECK (period_end >= period_start),
    CONSTRAINT ck_account_data_coverage_status CHECK (coverage_status IN (
        'COMPLETE','PARTIAL','GAP_PRESENT','UNKNOWN'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_data_coverage_interval
    ON core.account_data_coverage (
        financial_account_id, period_start, period_end, COALESCE(source_statement_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );
CREATE INDEX IF NOT EXISTS ix_account_data_coverage_account_period
    ON core.account_data_coverage (financial_account_id, period_start, period_end, coverage_status);

DROP TRIGGER IF EXISTS trg_account_data_coverage_touch_updated_at ON core.account_data_coverage;
CREATE TRIGGER trg_account_data_coverage_touch_updated_at
BEFORE UPDATE ON core.account_data_coverage
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

-- --------------------------------------------------------------------------
-- 9. Stable logical transaction identity.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.logical_transaction (
    logical_transaction_id        uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    financial_account_id          uuid NOT NULL REFERENCES core.financial_account(financial_account_id) ON DELETE RESTRICT,
    identity_status               text NOT NULL DEFAULT 'ACTIVE',
    current_canonical_version_id  uuid,
    identity_metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at                    timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at                    timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_logical_transaction_status CHECK (identity_status IN (
        'ACTIVE','MERGED','SPLIT','VOIDED','ERASED_REFERENCE_ONLY'
    ))
);

CREATE INDEX IF NOT EXISTS ix_logical_transaction_account_status
    ON core.logical_transaction (financial_account_id, identity_status, created_at DESC);

DROP TRIGGER IF EXISTS trg_logical_transaction_touch_updated_at ON core.logical_transaction;
CREATE TRIGGER trg_logical_transaction_touch_updated_at
BEFORE UPDATE ON core.logical_transaction
FOR EACH ROW EXECUTE FUNCTION ops.touch_updated_at();

COMMENT ON TABLE core.logical_transaction IS
'Stable economic/ledger transaction identity. Parser/normalizer replay creates new representations rather than replacing this ID.';

-- --------------------------------------------------------------------------
-- 10. Immutable canonical transaction versions.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.canonical_transaction_version (
    canonical_transaction_version_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    logical_transaction_id            uuid NOT NULL REFERENCES core.logical_transaction(logical_transaction_id) ON DELETE RESTRICT,
    version_no                        integer NOT NULL,
    is_current                        boolean NOT NULL DEFAULT false,
    supersedes_version_id             uuid REFERENCES core.canonical_transaction_version(canonical_transaction_version_id) ON DELETE RESTRICT,
    source_record_id                  uuid REFERENCES core.source_record(source_record_id) ON DELETE RESTRICT,
    extraction_run_id                 uuid REFERENCES core.extraction_run(extraction_run_id) ON DELETE RESTRICT,
    source_batch_id                   uuid REFERENCES core.source_batch(source_batch_id) ON DELETE RESTRICT,
    financial_account_id              uuid NOT NULL REFERENCES core.financial_account(financial_account_id) ON DELETE RESTRICT,
    instrument_id                     uuid REFERENCES core.financial_account_instrument(instrument_id) ON DELETE RESTRICT,
    account_currency_bucket_id        uuid REFERENCES core.account_currency_bucket(account_currency_bucket_id) ON DELETE RESTRICT,
    transaction_date                  date,
    transaction_timestamp             timestamptz,
    transaction_timezone_source       text,
    value_date                        date,
    amount                            numeric(20,4),
    direction                         text NOT NULL DEFAULT 'UNKNOWN',
    posting_status                    text NOT NULL DEFAULT 'UNKNOWN',
    reversal_indicator                boolean NOT NULL DEFAULT false,
    reversal_reference                text,
    currency_code                     char(3),
    original_amount                   numeric(20,4),
    original_currency_code            char(3),
    source_fx_rate                    numeric(24,10),
    derived_fx_rate                   numeric(24,10),
    raw_description                   text,
    normalized_description            text,
    source_reference                  text,
    running_balance                   numeric(20,4),
    source_sequence                   text,
    extraction_sequence               integer,
    normalization_status              text NOT NULL,
    normalization_confidence          numeric(5,4) NOT NULL DEFAULT 0,
    normalization_reason_codes        text[] NOT NULL DEFAULT '{}'::text[],
    normalization_version             text NOT NULL,
    change_provenance                 text NOT NULL DEFAULT 'INITIAL',
    duplicate_outcome                 text NOT NULL DEFAULT 'DISTINCT',
    legacy_limitation_flags           text[] NOT NULL DEFAULT '{}'::text[],
    created_at                        timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_canonical_transaction_version_no UNIQUE (logical_transaction_id, version_no),
    CONSTRAINT ck_canonical_version_no CHECK (version_no > 0),
    CONSTRAINT ck_canonical_amount CHECK (amount IS NULL OR amount > 0),
    CONSTRAINT ck_canonical_original_amount CHECK (original_amount IS NULL OR original_amount >= 0),
    CONSTRAINT ck_canonical_direction CHECK (direction IN ('IN','OUT','UNKNOWN')),
    CONSTRAINT ck_canonical_posting_status CHECK (posting_status IN (
        'POSTED','SETTLED','PENDING','AUTHORIZED','HOLD','UNKNOWN'
    )),
    CONSTRAINT ck_canonical_currency CHECK (
        currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT ck_canonical_original_currency CHECK (
        original_currency_code IS NULL OR original_currency_code ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT ck_canonical_fx_rates CHECK (
        (source_fx_rate IS NULL OR source_fx_rate > 0)
        AND (derived_fx_rate IS NULL OR derived_fx_rate > 0)
    ),
    CONSTRAINT ck_canonical_extraction_sequence CHECK (
        extraction_sequence IS NULL OR extraction_sequence > 0
    ),
    CONSTRAINT ck_canonical_status CHECK (normalization_status IN ('READY','PARTIAL','REJECTED')),
    CONSTRAINT ck_canonical_confidence CHECK (normalization_confidence >= 0 AND normalization_confidence <= 1),
    CONSTRAINT ck_canonical_change_provenance CHECK (change_provenance IN (
        'INITIAL','SYSTEM_REPROCESS','USER_CORRECTION','REVIEWER_CORRECTION','MIGRATION_CORRECTION'
    )),
    CONSTRAINT ck_canonical_duplicate_outcome CHECK (duplicate_outcome IN (
        'DISTINCT','EQUIVALENT_ACTIVE','EQUIVALENT_SUPERSEDED','REVIEW_REQUIRED'
    )),
    CONSTRAINT ck_canonical_normalization_version_nonblank CHECK (btrim(normalization_version) <> ''),
    CONSTRAINT ck_canonical_current_ready CHECK (
        is_current = false OR normalization_status = 'READY'
    ),
    CONSTRAINT ck_canonical_ready_minimum_truth CHECK (
        normalization_status <> 'READY'
        OR (
            transaction_date IS NOT NULL
            AND amount IS NOT NULL AND amount > 0
            AND direction IN ('IN','OUT')
            AND currency_code IS NOT NULL
            AND financial_account_id IS NOT NULL
            AND extraction_sequence IS NOT NULL
        )
    ),
    CONSTRAINT ck_canonical_legacy_lineage CHECK (
        change_provenance = 'MIGRATION_CORRECTION'
        OR source_record_id IS NOT NULL
        OR cardinality(legacy_limitation_flags) > 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_transaction_current
    ON core.canonical_transaction_version (logical_transaction_id)
    WHERE is_current = true;
CREATE INDEX IF NOT EXISTS ix_canonical_transaction_account_date
    ON core.canonical_transaction_version (financial_account_id, transaction_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_canonical_transaction_status
    ON core.canonical_transaction_version (normalization_status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_canonical_transaction_source_ref
    ON core.canonical_transaction_version (financial_account_id, source_reference)
    WHERE source_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_canonical_transaction_timestamp
    ON core.canonical_transaction_version (financial_account_id, transaction_timestamp DESC)
    WHERE transaction_timestamp IS NOT NULL;

COMMENT ON TABLE core.canonical_transaction_version IS
'Immutable normalized primitive version for one stable logical transaction. Semantic interpretation begins downstream in F10B.';

-- Guard semantic content: only is_current may change after insert.
CREATE OR REPLACE FUNCTION core.guard_canonical_transaction_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current') THEN
        RAISE EXCEPTION 'canonical_transaction_version rows are immutable except is_current; insert a new version instead';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_canonical_transaction_version_update ON core.canonical_transaction_version;
CREATE TRIGGER trg_guard_canonical_transaction_version_update
BEFORE UPDATE ON core.canonical_transaction_version
FOR EACH ROW EXECUTE FUNCTION core.guard_canonical_transaction_version_update();

-- Add the cyclic current pointer FK only after canonical table exists.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'core.logical_transaction'::regclass
          AND conname = 'fk_logical_transaction_current_canonical'
    ) THEN
        ALTER TABLE core.logical_transaction
        ADD CONSTRAINT fk_logical_transaction_current_canonical
        FOREIGN KEY (current_canonical_version_id)
        REFERENCES core.canonical_transaction_version(canonical_transaction_version_id)
        ON DELETE RESTRICT
        DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

-- Ensure a canonical version cannot silently point at a different account than
-- the stable logical transaction. Also validates instrument/bucket parentage.
CREATE OR REPLACE FUNCTION core.validate_canonical_transaction_version_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    logical_account uuid;
    instrument_account uuid;
    bucket_account uuid;
    record_run uuid;
    record_sequence integer;
    run_document uuid;
    document_batch uuid;
    supersedes_logical uuid;
    supersedes_version_no integer;
BEGIN
    SELECT financial_account_id
      INTO logical_account
      FROM core.logical_transaction
     WHERE logical_transaction_id = NEW.logical_transaction_id;

    IF logical_account IS NULL THEN
        RAISE EXCEPTION 'logical_transaction % does not exist', NEW.logical_transaction_id;
    END IF;

    IF NEW.financial_account_id <> logical_account THEN
        RAISE EXCEPTION 'canonical account % differs from logical transaction account %', NEW.financial_account_id, logical_account;
    END IF;

    IF NEW.instrument_id IS NOT NULL THEN
        SELECT financial_account_id INTO instrument_account
        FROM core.financial_account_instrument
        WHERE instrument_id = NEW.instrument_id;
        IF instrument_account IS DISTINCT FROM NEW.financial_account_id THEN
            RAISE EXCEPTION 'instrument % does not belong to canonical account %', NEW.instrument_id, NEW.financial_account_id;
        END IF;
    END IF;

    IF NEW.account_currency_bucket_id IS NOT NULL THEN
        SELECT financial_account_id INTO bucket_account
        FROM core.account_currency_bucket
        WHERE account_currency_bucket_id = NEW.account_currency_bucket_id;
        IF bucket_account IS DISTINCT FROM NEW.financial_account_id THEN
            RAISE EXCEPTION 'currency bucket % does not belong to canonical account %', NEW.account_currency_bucket_id, NEW.financial_account_id;
        END IF;
    END IF;

    IF NEW.source_record_id IS NOT NULL THEN
        SELECT extraction_run_id, extraction_sequence
          INTO record_run, record_sequence
          FROM core.source_record
         WHERE source_record_id = NEW.source_record_id;

        IF NEW.extraction_run_id IS NULL THEN
            RAISE EXCEPTION 'canonical version with source_record % must retain extraction_run_id', NEW.source_record_id;
        END IF;
        IF record_run IS DISTINCT FROM NEW.extraction_run_id THEN
            RAISE EXCEPTION 'source_record % belongs to extraction run %, not %', NEW.source_record_id, record_run, NEW.extraction_run_id;
        END IF;
        IF NEW.extraction_sequence IS NOT NULL AND record_sequence IS DISTINCT FROM NEW.extraction_sequence THEN
            RAISE EXCEPTION 'canonical extraction_sequence % differs from source record sequence %', NEW.extraction_sequence, record_sequence;
        END IF;
    END IF;

    IF NEW.extraction_run_id IS NOT NULL THEN
        SELECT source_document_id INTO run_document
        FROM core.extraction_run
        WHERE extraction_run_id = NEW.extraction_run_id;

        SELECT source_batch_id INTO document_batch
        FROM core.source_document
        WHERE source_document_id = run_document;

        IF NEW.source_batch_id IS NOT NULL AND document_batch IS DISTINCT FROM NEW.source_batch_id THEN
            RAISE EXCEPTION 'canonical source_batch % differs from extraction lineage batch %', NEW.source_batch_id, document_batch;
        END IF;
    END IF;

    IF NEW.supersedes_version_id IS NOT NULL THEN
        SELECT logical_transaction_id, version_no
          INTO supersedes_logical, supersedes_version_no
          FROM core.canonical_transaction_version
         WHERE canonical_transaction_version_id = NEW.supersedes_version_id;

        IF supersedes_logical IS DISTINCT FROM NEW.logical_transaction_id THEN
            RAISE EXCEPTION 'supersedes_version % belongs to another logical transaction', NEW.supersedes_version_id;
        END IF;
        IF supersedes_version_no >= NEW.version_no THEN
            RAISE EXCEPTION 'superseded version_no % must be lower than new version_no %', supersedes_version_no, NEW.version_no;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_canonical_transaction_version_insert ON core.canonical_transaction_version;
CREATE TRIGGER trg_validate_canonical_transaction_version_insert
BEFORE INSERT ON core.canonical_transaction_version
FOR EACH ROW EXECUTE FUNCTION core.validate_canonical_transaction_version_insert();

-- Atomic activation: version row + stable current pointer change together.
CREATE OR REPLACE FUNCTION core.activate_canonical_transaction_version(
    p_canonical_transaction_version_id uuid,
    p_expected_current_version_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_logical_id uuid;
    v_status text;
    v_current uuid;
    v_source_type text;
BEGIN
    SELECT cv.logical_transaction_id, cv.normalization_status, sb.source_type
      INTO v_logical_id, v_status, v_source_type
      FROM core.canonical_transaction_version cv
      LEFT JOIN core.source_batch sb ON sb.source_batch_id = cv.source_batch_id
     WHERE cv.canonical_transaction_version_id = p_canonical_transaction_version_id
     FOR UPDATE OF cv;

    IF v_logical_id IS NULL THEN
        RAISE EXCEPTION 'canonical version % not found', p_canonical_transaction_version_id;
    END IF;

    IF v_status <> 'READY' THEN
        RAISE EXCEPTION 'only READY canonical versions may become current; got %', v_status;
    END IF;

    IF v_source_type IN ('EMAIL_ALERT','SMS_ALERT') THEN
        RAISE EXCEPTION 'supplemental alert evidence (%) cannot independently become current ledger truth', v_source_type;
    END IF;

    SELECT current_canonical_version_id
      INTO v_current
      FROM core.logical_transaction
     WHERE logical_transaction_id = v_logical_id
     FOR UPDATE;

    IF p_expected_current_version_id IS NOT NULL
       AND v_current IS DISTINCT FROM p_expected_current_version_id THEN
        RAISE EXCEPTION 'current canonical version changed concurrently: expected %, actual %',
            p_expected_current_version_id, v_current;
    END IF;

    UPDATE core.canonical_transaction_version
       SET is_current = false
     WHERE logical_transaction_id = v_logical_id
       AND is_current = true
       AND canonical_transaction_version_id <> p_canonical_transaction_version_id;

    UPDATE core.canonical_transaction_version
       SET is_current = true
     WHERE canonical_transaction_version_id = p_canonical_transaction_version_id;

    UPDATE core.logical_transaction
       SET current_canonical_version_id = p_canonical_transaction_version_id
     WHERE logical_transaction_id = v_logical_id;
END;
$$;

COMMENT ON FUNCTION core.activate_canonical_transaction_version(uuid, uuid) IS
'Atomically activates one READY canonical version and updates the owning logical transaction current pointer. Expected-current supports optimistic concurrency.';

-- Deferred consistency check between logical current pointer and is_current flag.
CREATE OR REPLACE FUNCTION core.check_canonical_current_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_logical_id uuid;
    v_pointer uuid;
    v_current_count integer;
BEGIN
    v_logical_id := COALESCE(NEW.logical_transaction_id, OLD.logical_transaction_id);

    SELECT current_canonical_version_id
      INTO v_pointer
      FROM core.logical_transaction
     WHERE logical_transaction_id = v_logical_id;

    SELECT count(*)
      INTO v_current_count
      FROM core.canonical_transaction_version
     WHERE logical_transaction_id = v_logical_id
       AND is_current = true;

    IF v_pointer IS NULL AND v_current_count <> 0 THEN
        RAISE EXCEPTION 'logical transaction % has current canonical row but NULL current pointer', v_logical_id;
    END IF;

    IF v_pointer IS NOT NULL THEN
        IF v_current_count <> 1 THEN
            RAISE EXCEPTION 'logical transaction % current pointer requires exactly one is_current row; found %', v_logical_id, v_current_count;
        END IF;
        IF NOT EXISTS (
            SELECT 1
            FROM core.canonical_transaction_version
            WHERE canonical_transaction_version_id = v_pointer
              AND logical_transaction_id = v_logical_id
              AND is_current = true
              AND normalization_status = 'READY'
        ) THEN
            RAISE EXCEPTION 'logical transaction % current pointer does not reference its READY is_current canonical version', v_logical_id;
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_canonical_current_from_version ON core.canonical_transaction_version;
CREATE CONSTRAINT TRIGGER trg_check_canonical_current_from_version
AFTER INSERT OR UPDATE OR DELETE ON core.canonical_transaction_version
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION core.check_canonical_current_consistency();

CREATE OR REPLACE FUNCTION core.check_logical_current_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_count integer;
BEGIN
    SELECT count(*)
      INTO v_current_count
      FROM core.canonical_transaction_version
     WHERE logical_transaction_id = NEW.logical_transaction_id
       AND is_current = true;

    IF NEW.current_canonical_version_id IS NULL THEN
        IF v_current_count <> 0 THEN
            RAISE EXCEPTION 'logical transaction % has is_current canonical row but NULL pointer', NEW.logical_transaction_id;
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1
            FROM core.canonical_transaction_version
            WHERE canonical_transaction_version_id = NEW.current_canonical_version_id
              AND logical_transaction_id = NEW.logical_transaction_id
              AND is_current = true
              AND normalization_status = 'READY'
        ) THEN
            RAISE EXCEPTION 'logical transaction % pointer % is not its READY current canonical version',
                NEW.logical_transaction_id, NEW.current_canonical_version_id;
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_logical_current_consistency ON core.logical_transaction;
CREATE CONSTRAINT TRIGGER trg_check_logical_current_consistency
AFTER INSERT OR UPDATE OF current_canonical_version_id ON core.logical_transaction
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION core.check_logical_current_consistency();

-- --------------------------------------------------------------------------
-- 11. Transaction evidence links / cross-source equivalence.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.transaction_evidence_link (
    evidence_link_id                 uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    logical_transaction_id           uuid NOT NULL REFERENCES core.logical_transaction(logical_transaction_id) ON DELETE RESTRICT,
    source_record_id                 uuid REFERENCES core.source_record(source_record_id) ON DELETE RESTRICT,
    canonical_transaction_version_id uuid REFERENCES core.canonical_transaction_version(canonical_transaction_version_id) ON DELETE RESTRICT,
    relationship_type                text NOT NULL,
    identity_confidence              numeric(5,4) NOT NULL DEFAULT 0,
    identity_reason_codes            text[] NOT NULL DEFAULT '{}'::text[],
    is_primary_observation           boolean NOT NULL DEFAULT false,
    created_at                       timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_transaction_evidence_link_target CHECK (
        source_record_id IS NOT NULL OR canonical_transaction_version_id IS NOT NULL
    ),
    CONSTRAINT ck_transaction_evidence_relationship CHECK (relationship_type IN (
        'PRIMARY_VERSION_SOURCE','CORROBORATING_SOURCE','EQUIVALENT_OBSERVATION',
        'ALERT_PRECURSOR','LEGACY_PROVENANCE'
    )),
    CONSTRAINT ck_transaction_evidence_confidence CHECK (
        identity_confidence >= 0 AND identity_confidence <= 1
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_evidence_source_relationship
    ON core.transaction_evidence_link (
        logical_transaction_id,
        COALESCE(source_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(canonical_transaction_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
        relationship_type
    );
CREATE INDEX IF NOT EXISTS ix_transaction_evidence_source_record
    ON core.transaction_evidence_link (source_record_id)
    WHERE source_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_transaction_evidence_logical
    ON core.transaction_evidence_link (logical_transaction_id, created_at DESC);

-- --------------------------------------------------------------------------
-- 12. RLS - raw source evidence remains owner-scoped; canonical ledger access
--     follows account ownership. Policies are SELECT defense-in-depth only.
-- --------------------------------------------------------------------------
ALTER TABLE core.source_connection             ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.source_batch                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.source_document               ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.document_set                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.document_set_member           ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.statement_instance            ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.statement_link                ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.extraction_run                ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.source_record                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.balance_snapshot              ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.account_data_coverage         ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.logical_transaction           ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.canonical_transaction_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.transaction_evidence_link     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_source_connection_owner_read ON core.source_connection;
CREATE POLICY pol_source_connection_owner_read ON core.source_connection
FOR SELECT USING (owner_id = ops.current_owner_id());

DROP POLICY IF EXISTS pol_source_batch_owner_read ON core.source_batch;
CREATE POLICY pol_source_batch_owner_read ON core.source_batch
FOR SELECT USING (owner_id = ops.current_owner_id());

DROP POLICY IF EXISTS pol_source_document_owner_read ON core.source_document;
CREATE POLICY pol_source_document_owner_read ON core.source_document
FOR SELECT USING (owner_id = ops.current_owner_id());

DROP POLICY IF EXISTS pol_document_set_owner_read ON core.document_set;
CREATE POLICY pol_document_set_owner_read ON core.document_set
FOR SELECT USING (owner_id = ops.current_owner_id());

DROP POLICY IF EXISTS pol_document_set_member_owner_read ON core.document_set_member;
CREATE POLICY pol_document_set_member_owner_read ON core.document_set_member
FOR SELECT USING (owner_id = ops.current_owner_id());

DROP POLICY IF EXISTS pol_statement_instance_owner_read ON core.statement_instance;
CREATE POLICY pol_statement_instance_owner_read ON core.statement_instance
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM core.source_document sd
        WHERE sd.source_document_id = statement_instance.source_document_id
          AND sd.owner_id = ops.current_owner_id()
    )
);

DROP POLICY IF EXISTS pol_statement_link_owner_read ON core.statement_link;
CREATE POLICY pol_statement_link_owner_read ON core.statement_link
FOR SELECT USING (
    EXISTS (
        SELECT 1
        FROM core.statement_instance si
        JOIN core.source_document sd ON sd.source_document_id = si.source_document_id
        WHERE si.statement_instance_id = statement_link.from_statement_id
          AND sd.owner_id = ops.current_owner_id()
    )
);

DROP POLICY IF EXISTS pol_extraction_run_owner_read ON core.extraction_run;
CREATE POLICY pol_extraction_run_owner_read ON core.extraction_run
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM core.source_document sd
        WHERE sd.source_document_id = extraction_run.source_document_id
          AND sd.owner_id = ops.current_owner_id()
    )
);

DROP POLICY IF EXISTS pol_source_record_owner_read ON core.source_record;
CREATE POLICY pol_source_record_owner_read ON core.source_record
FOR SELECT USING (
    EXISTS (
        SELECT 1
        FROM core.extraction_run er
        JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
        WHERE er.extraction_run_id = source_record.extraction_run_id
          AND sd.owner_id = ops.current_owner_id()
    )
);

DROP POLICY IF EXISTS pol_balance_snapshot_owner_read ON core.balance_snapshot;
CREATE POLICY pol_balance_snapshot_owner_read ON core.balance_snapshot
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM core.account_ownership ao
        WHERE ao.financial_account_id = balance_snapshot.financial_account_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

DROP POLICY IF EXISTS pol_account_data_coverage_owner_read ON core.account_data_coverage;
CREATE POLICY pol_account_data_coverage_owner_read ON core.account_data_coverage
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM core.account_ownership ao
        WHERE ao.financial_account_id = account_data_coverage.financial_account_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

DROP POLICY IF EXISTS pol_logical_transaction_owner_read ON core.logical_transaction;
CREATE POLICY pol_logical_transaction_owner_read ON core.logical_transaction
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM core.account_ownership ao
        WHERE ao.financial_account_id = logical_transaction.financial_account_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

DROP POLICY IF EXISTS pol_canonical_transaction_owner_read ON core.canonical_transaction_version;
CREATE POLICY pol_canonical_transaction_owner_read ON core.canonical_transaction_version
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM core.account_ownership ao
        WHERE ao.financial_account_id = canonical_transaction_version.financial_account_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

DROP POLICY IF EXISTS pol_transaction_evidence_owner_read ON core.transaction_evidence_link;
CREATE POLICY pol_transaction_evidence_owner_read ON core.transaction_evidence_link
FOR SELECT USING (
    EXISTS (
        SELECT 1
        FROM core.logical_transaction lt
        JOIN core.account_ownership ao ON ao.financial_account_id = lt.financial_account_id
        WHERE lt.logical_transaction_id = transaction_evidence_link.logical_transaction_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

-- --------------------------------------------------------------------------
-- 13. Read views for current canonical truth and F10B handoff.
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW core.v_current_canonical_transaction
WITH (security_invoker = true) AS
SELECT
    lt.logical_transaction_id,
    lt.financial_account_id,
    lt.identity_status,
    cv.canonical_transaction_version_id,
    cv.version_no,
    cv.instrument_id,
    cv.account_currency_bucket_id,
    cv.transaction_date,
    cv.transaction_timestamp,
    cv.transaction_timezone_source,
    cv.value_date,
    cv.amount,
    cv.direction,
    cv.posting_status,
    cv.reversal_indicator,
    cv.reversal_reference,
    cv.currency_code,
    cv.original_amount,
    cv.original_currency_code,
    cv.source_fx_rate,
    cv.derived_fx_rate,
    cv.raw_description,
    cv.normalized_description,
    cv.source_reference,
    cv.running_balance,
    cv.source_sequence,
    cv.extraction_sequence,
    cv.normalization_confidence,
    cv.normalization_reason_codes,
    cv.normalization_version,
    cv.change_provenance,
    cv.duplicate_outcome,
    cv.legacy_limitation_flags,
    cv.created_at AS canonical_created_at
FROM core.logical_transaction lt
JOIN core.canonical_transaction_version cv
  ON cv.canonical_transaction_version_id = lt.current_canonical_version_id
 AND cv.logical_transaction_id = lt.logical_transaction_id
 AND cv.is_current = true
 AND cv.normalization_status = 'READY';

COMMENT ON VIEW core.v_current_canonical_transaction IS
'Current READY canonical primitive for F10B reads. Stable logical identity remains separate from immutable version history.';

CREATE OR REPLACE VIEW core.v_source_document_processing_state
WITH (security_invoker = true) AS
SELECT
    sd.source_document_id,
    sd.owner_id,
    sd.source_batch_id,
    sb.source_type,
    sd.original_filename,
    sd.status AS document_status,
    sb.status AS batch_status,
    sd.reason_codes AS document_reason_codes,
    sd.received_at,
    max(er.created_at) AS latest_extraction_created_at,
    max(er.completed_at) AS latest_extraction_completed_at
FROM core.source_document sd
JOIN core.source_batch sb ON sb.source_batch_id = sd.source_batch_id
LEFT JOIN core.extraction_run er ON er.source_document_id = sd.source_document_id
GROUP BY sd.source_document_id, sd.owner_id, sd.source_batch_id, sb.source_type,
         sd.original_filename, sd.status, sb.status, sd.reason_codes, sd.received_at;

-- --------------------------------------------------------------------------
-- 14. Migration registration.
-- --------------------------------------------------------------------------
INSERT INTO ops.schema_migration (
    migration_code,
    migration_name,
    architecture_version,
    checksum_hint,
    notes
)
VALUES (
    'D10-2',
    'Source Intake & Canonical Ledger',
    'D10 v1.2 FINAL FREEZE',
    'd10-2-source-intake-canonical-ledger-v1',
    'F10A persistence: source evidence, statement/extraction lineage, coverage, stable logical transactions, canonical versions and evidence links. No legacy mutation.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
