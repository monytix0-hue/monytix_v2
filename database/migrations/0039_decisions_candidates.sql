-- Decision candidates for PROMOTE rows. Adapted from D10-6 without D10-5 weight snapshots.

BEGIN;

CREATE SCHEMA IF NOT EXISTS action;
CREATE SCHEMA IF NOT EXISTS ref;

CREATE TABLE IF NOT EXISTS ref.decision_family (
    decision_family_version_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    decision_family_code       text NOT NULL,
    definition_version         text NOT NULL DEFAULT '1.0',
    display_name               text NOT NULL,
    decision_group             text NOT NULL,
    decision_mode              text NOT NULL DEFAULT 'STANDARD',
    primary_weight_codes       text[] NOT NULL,
    status                     text NOT NULL DEFAULT 'ACTIVE',
    created_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_decision_family_version UNIQUE (decision_family_code, definition_version),
    CONSTRAINT ck_decision_family_code CHECK (decision_family_code ~ '^D([1-9]|[12][0-9]|30)$'),
    CONSTRAINT ck_decision_family_group CHECK (decision_group IN ('SAFETY', 'CASHFLOW', 'SAVINGS', 'INVESTMENT', 'SPENDING', 'OPPORTUNITY')),
    CONSTRAINT ck_decision_family_mode CHECK (decision_mode IN ('STANDARD', 'OVERLAY')),
    CONSTRAINT ck_decision_family_weights CHECK (cardinality(primary_weight_codes) >= 1),
    CONSTRAINT ck_decision_family_status CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'DEPRECATED'))
);

CREATE TABLE IF NOT EXISTS ref.decision_ranking_policy (
    decision_ranking_policy_version_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    policy_id                  text NOT NULL,
    policy_version             text NOT NULL,
    status                     text NOT NULL DEFAULT 'ACTIVE',
    ranking_formula_contract   jsonb NOT NULL,
    created_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_decision_ranking_policy UNIQUE (policy_id, policy_version),
    CONSTRAINT ck_decision_ranking_status CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'DEPRECATED'))
);

INSERT INTO ref.decision_family (
    decision_family_code, definition_version, display_name, decision_group, decision_mode, primary_weight_codes
) VALUES
    ('D1',  '1.0', 'Emergency Fund Allocation',       'SAFETY',     'STANDARD', ARRAY['W09_RESILIENCE', 'W03_RISK']),
    ('D2',  '1.0', 'Cash Buffer Top-Up',               'SAFETY',     'STANDARD', ARRAY['W09_RESILIENCE', 'W02_COMFORT']),
    ('D3',  '1.0', 'Credit Card Payment',              'SAFETY',     'STANDARD', ARRAY['W04_OBLIGATIONS', 'W03_RISK']),
    ('D4',  '1.0', 'Loan EMI Protection',              'SAFETY',     'STANDARD', ARRAY['W04_OBLIGATIONS', 'W09_RESILIENCE']),
    ('D5',  '1.0', 'Insurance Renewal',                'SAFETY',     'STANDARD', ARRAY['W03_RISK', 'W04_OBLIGATIONS']),
    ('D6',  '1.0', 'Insurance Coverage Gap',           'SAFETY',     'STANDARD', ARRAY['W03_RISK', 'W06_RELATIONSHIPS']),
    ('D7',  '1.0', 'Idle Cash Deployment',             'CASHFLOW',   'STANDARD', ARRAY['W07_OPPORTUNITY', 'W09_RESILIENCE']),
    ('D8',  '1.0', 'Income Surplus Allocation',        'CASHFLOW',   'STANDARD', ARRAY['W07_OPPORTUNITY', 'W02_COMFORT']),
    ('D9',  '1.0', 'Recurring Review',                 'CASHFLOW',   'STANDARD', ARRAY['W04_OBLIGATIONS', 'W08_ATTENTION']),
    ('D10', '1.0', 'Expense Spike Review',             'CASHFLOW',   'STANDARD', ARRAY['W08_ATTENTION', 'W02_COMFORT']),
    ('D11', '1.0', 'Large Expense Warning',            'CASHFLOW',   'STANDARD', ARRAY['W01_TIME', 'W03_RISK']),
    ('D12', '1.0', 'Cash Crunch Forecast',             'CASHFLOW',   'STANDARD', ARRAY['W09_RESILIENCE', 'W03_RISK', 'W01_TIME']),
    ('D13', '1.0', 'Savings Rate Lift',                'SAVINGS',    'STANDARD', ARRAY['W09_RESILIENCE', 'W07_OPPORTUNITY']),
    ('D14', '1.0', 'Goal Contribution Catch-Up',       'SAVINGS',    'STANDARD', ARRAY['W01_TIME', 'W10_LEGACY']),
    ('D15', '1.0', 'Salary Day Allocation',            'SAVINGS',    'STANDARD', ARRAY['W08_ATTENTION', 'W07_OPPORTUNITY']),
    ('D16', '1.0', 'Bonus Allocation',                 'SAVINGS',    'STANDARD', ARRAY['W07_OPPORTUNITY', 'W10_LEGACY']),
    ('D17', '1.0', 'Emergency Fund Milestone Push',    'SAVINGS',    'STANDARD', ARRAY['W09_RESILIENCE', 'W03_RISK']),
    ('D18', '1.0', 'SIP Continuity',                   'INVESTMENT', 'STANDARD', ARRAY['W10_LEGACY', 'W07_OPPORTUNITY']),
    ('D19', '1.0', 'Idle Cash to SIP',                 'INVESTMENT', 'STANDARD', ARRAY['W07_OPPORTUNITY', 'W10_LEGACY']),
    ('D20', '1.0', 'Asset Drift Rebalance',            'INVESTMENT', 'STANDARD', ARRAY['W03_RISK', 'W07_OPPORTUNITY']),
    ('D21', '1.0', 'Retirement Funding Gap',           'INVESTMENT', 'STANDARD', ARRAY['W10_LEGACY', 'W01_TIME']),
    ('D22', '1.0', 'Goal-Linked Investing',            'INVESTMENT', 'STANDARD', ARRAY['W10_LEGACY', 'W07_OPPORTUNITY', 'W01_TIME']),
    ('D23', '1.0', 'Dining Optimization',              'SPENDING',   'STANDARD', ARRAY['W02_COMFORT', 'W08_ATTENTION']),
    ('D24', '1.0', 'Shopping Control',                 'SPENDING',   'STANDARD', ARRAY['W02_COMFORT', 'W05_IDENTITY', 'W08_ATTENTION']),
    ('D25', '1.0', 'Entertainment Cap',                'SPENDING',   'STANDARD', ARRAY['W02_COMFORT', 'W08_ATTENTION']),
    ('D26', '1.0', 'Travel Spend Review',              'SPENDING',   'STANDARD', ARRAY['W02_COMFORT', 'W01_TIME']),
    ('D27', '1.0', 'Discretionary Squeeze',            'SPENDING',   'STANDARD', ARRAY['W02_COMFORT', 'W09_RESILIENCE']),
    ('D28', '1.0', 'Mission Acceleration',             'OPPORTUNITY','OVERLAY',  ARRAY['W07_OPPORTUNITY', 'W01_TIME']),
    ('D29', '1.0', 'Confidence Growth Opportunity',    'OPPORTUNITY','OVERLAY',  ARRAY['W07_OPPORTUNITY', 'W09_RESILIENCE']),
    ('D30', '1.0', 'Milestone Unlock',                 'OPPORTUNITY','OVERLAY',  ARRAY['W10_LEGACY', 'W07_OPPORTUNITY'])
ON CONFLICT (decision_family_code, definition_version) DO NOTHING;

INSERT INTO ref.decision_ranking_policy (policy_id, policy_version, status, ranking_formula_contract)
VALUES (
    'FPS_V1',
    '1.0',
    'ACTIVE',
    jsonb_build_object(
        'form', 'BaseWeightFit * Urgency * Confidence * ContextModifier',
        'base_weight_fit', 'SUM(NormalizedWeight_w * Relevance_iw)'
    )
)
ON CONFLICT (policy_id, policy_version) DO NOTHING;

CREATE TABLE IF NOT EXISTS action.decision_evaluation (
    decision_evaluation_id       uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id                     uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    decision_family_version_id   uuid NOT NULL REFERENCES ref.decision_family(decision_family_version_id) ON DELETE RESTRICT,
    decision_ranking_policy_version_id uuid REFERENCES ref.decision_ranking_policy(decision_ranking_policy_version_id) ON DELETE RESTRICT,
    eligibility_status           text NOT NULL,
    eligibility_reason_codes     text[] NOT NULL DEFAULT '{}'::text[],
    base_weight_fit              numeric(18, 8),
    urgency_multiplier           numeric(12, 8),
    confidence_multiplier        numeric(12, 8),
    context_modifier             numeric(12, 8),
    decision_score               numeric(30, 10),
    priority_band                text NOT NULL DEFAULT 'UNKNOWN',
    trigger_type                 text NOT NULL,
    trigger_reference_type       text,
    trigger_reference_id         uuid REFERENCES finance.ledger_transactions(id) ON DELETE SET NULL,
    option_set                   jsonb NOT NULL DEFAULT '[]'::jsonb,
    idempotency_key              text NOT NULL,
    evaluated_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_decision_eval_owner_idempotency UNIQUE (owner_id, idempotency_key),
    CONSTRAINT ck_decision_eval_eligibility CHECK (
        eligibility_status IN ('ELIGIBLE', 'LIMITED', 'INELIGIBLE', 'CONTEXT_REQUIRED', 'BLOCKED')
    ),
    CONSTRAINT ck_decision_eval_priority CHECK (
        priority_band IN ('NONE', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL', 'UNKNOWN')
    )
);

CREATE TABLE IF NOT EXISTS action.decision (
    decision_id                  uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id                     uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    decision_family_version_id   uuid NOT NULL REFERENCES ref.decision_family(decision_family_version_id) ON DELETE RESTRICT,
    source_evaluation_id         uuid REFERENCES action.decision_evaluation(decision_evaluation_id) ON DELETE RESTRICT,
    origin_type                  text NOT NULL DEFAULT 'SYSTEM_EVALUATED',
    state                        text NOT NULL DEFAULT 'CANDIDATE',
    title                        text,
    trigger_summary              jsonb NOT NULL DEFAULT '{}'::jsonb,
    option_set                   jsonb NOT NULL DEFAULT '[]'::jsonb,
    current_rank                 integer,
    current_priority_band        text NOT NULL DEFAULT 'UNKNOWN',
    idempotency_key              text NOT NULL,
    created_at                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_decision_idempotency UNIQUE (owner_id, idempotency_key),
    CONSTRAINT ck_decision_origin CHECK (origin_type IN ('SYSTEM_EVALUATED', 'USER_INITIATED', 'AI_CONTEXTUAL_CHILD', 'MIGRATED')),
    CONSTRAINT ck_decision_state CHECK (
        state IN ('CANDIDATE', 'PRESENTED', 'CONSIDERING', 'SELECTED', 'DECLINED', 'EXPIRED', 'EXECUTED', 'SUPERSEDED')
    ),
    CONSTRAINT ck_decision_priority CHECK (
        current_priority_band IN ('NONE', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL', 'UNKNOWN')
    ),
    CONSTRAINT ck_decision_rank CHECK (current_rank IS NULL OR current_rank > 0)
);

CREATE INDEX IF NOT EXISTS ix_decision_owner_state ON action.decision (owner_id, state);
CREATE INDEX IF NOT EXISTS ix_decision_eval_trigger ON action.decision_evaluation (trigger_reference_id)
    WHERE trigger_reference_id IS NOT NULL;

ALTER TABLE action.decision_evaluation ENABLE ROW LEVEL SECURITY;
ALTER TABLE action.decision ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_action_decision_eval ON action.decision_evaluation
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_action_decision ON action.decision
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());

GRANT USAGE ON SCHEMA action, ref TO monytix_finance, monytix_api;
GRANT SELECT ON ref.decision_family, ref.decision_ranking_policy TO monytix_finance, monytix_api;
GRANT SELECT, INSERT, UPDATE ON action.decision_evaluation, action.decision TO monytix_finance, monytix_api;

REVOKE ALL ON SCHEMA action FROM monytix_intelligence;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'DECISIONS-CANDIDATES',
    'D1-D30 decision candidates for PROMOTE ledger rows',
    'finance-v0.1',
    'decisions-candidates',
    'PROMOTE eligibility enqueues ranking. Missions and D10-7 stay out.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
