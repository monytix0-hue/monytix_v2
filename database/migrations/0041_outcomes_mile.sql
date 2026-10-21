-- Outcomes, financial impact, and M.I.L.E. Adapted from D10-7 without milestones / weight defs.

BEGIN;

ALTER TABLE action.mission
  ADD COLUMN IF NOT EXISTS current_progress_inr numeric(14, 2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ref.outcome_family (
    outcome_family_code text PRIMARY KEY,
    display_name        text NOT NULL,
    definition          text NOT NULL,
    calibration_base    numeric(12, 4) NOT NULL CHECK (calibration_base >= 0),
    status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'DEPRECATED')),
    created_at          timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO ref.outcome_family (outcome_family_code, display_name, definition, calibration_base) VALUES
    ('MP', 'Money Protected', 'Reserves, protection and verified shortfall avoidance.', 12),
    ('MS', 'Money Saved', 'Verified avoided/reduced expenditure or incremental saving.', 10),
    ('DR', 'Debt Reduced', 'Principal and attributable interest burden reduced.', 15),
    ('WB', 'Wealth Built', 'Deliberate contributions/corpus building; passive market movement excluded.', 12),
    ('GF', 'Goals Funded', 'Verified progress toward a defined target.', 12),
    ('FC', 'Financial Capacity Created', 'More usable flexibility, runway or future choice.', 15)
ON CONFLICT (outcome_family_code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    definition = EXCLUDED.definition,
    calibration_base = EXCLUDED.calibration_base;

CREATE TABLE IF NOT EXISTS ref.mile_calibration_policy (
    mile_calibration_policy_version_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    policy_id               text NOT NULL,
    policy_version          text NOT NULL,
    status                  text NOT NULL DEFAULT 'ACTIVE',
    outcome_base_contract   jsonb NOT NULL,
    magnitude_contract      jsonb NOT NULL,
    significance_contract   jsonb NOT NULL,
    attribution_contract    jsonb NOT NULL,
    carry_through_contract  jsonb NOT NULL DEFAULT '{}'::jsonb,
    milestone_contract      jsonb NOT NULL DEFAULT '{}'::jsonb,
    completion_contract     jsonb NOT NULL DEFAULT '{}'::jsonb,
    persistence_contract    jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_mile_calibration_policy UNIQUE (policy_id, policy_version),
    CONSTRAINT ck_mile_calibration_status CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'DEPRECATED'))
);

INSERT INTO ref.mile_calibration_policy (
    policy_id, policy_version, status,
    outcome_base_contract, magnitude_contract, significance_contract, attribution_contract
) VALUES (
    'MILE_V1',
    '1.0',
    'ACTIVE',
    '{"MP": 12, "MS": 10, "DR": 15, "WB": 12, "GF": 12, "FC": 15}'::jsonb,
    '{"sqrt_divisor": 100.0, "max_magnitude_factor": 5.0}'::jsonb,
    '{"amount_gte": 10000, "boost": 1.2, "default": 1.0}'::jsonb,
    '{"A1": 1.0, "A2": 0.9, "A3": 0.5, "A4": 0.0}'::jsonb
)
ON CONFLICT (policy_id, policy_version) DO NOTHING;

CREATE TABLE IF NOT EXISTS ref.mile_finalization_policy (
    mile_finalization_policy_version_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    policy_id              text NOT NULL,
    policy_version         text NOT NULL,
    outcome_family_code    text REFERENCES ref.outcome_family(outcome_family_code) ON DELETE RESTRICT,
    status                 text NOT NULL DEFAULT 'ACTIVE',
    finalization_contract  jsonb NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_mile_finalization_policy UNIQUE (policy_id, policy_version),
    CONSTRAINT ck_mile_finalization_status CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'DEPRECATED'))
);

INSERT INTO ref.mile_finalization_policy (policy_id, policy_version, outcome_family_code, status, finalization_contract)
VALUES (
    'MILE_FINAL_V1',
    '1.0',
    NULL,
    'ACTIVE',
    '{"mode": "IMMEDIATE", "note": "Provisional windows deferred in this slice"}'::jsonb
)
ON CONFLICT (policy_id, policy_version) DO NOTHING;

CREATE TABLE IF NOT EXISTS action.financial_outcome (
    financial_outcome_id   uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id               uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    outcome_family_code    text NOT NULL REFERENCES ref.outcome_family(outcome_family_code) ON DELETE RESTRICT,
    outcome_type           text NOT NULL,
    decision_id            uuid REFERENCES action.decision(decision_id) ON DELETE RESTRICT,
    mission_id             uuid REFERENCES action.mission(mission_id) ON DELETE RESTRICT,
    source_reference_type  text,
    source_reference_id    uuid REFERENCES finance.ledger_transactions(id) ON DELETE SET NULL,
    economic_event_key     text NOT NULL,
    observed_amount        numeric(20, 4),
    currency               char(3) DEFAULT 'INR',
    verification_status    text NOT NULL,
    outcome_status         text NOT NULL DEFAULT 'FINALIZED',
    evidence_references    jsonb NOT NULL DEFAULT '[]'::jsonb,
    reason_codes           text[] NOT NULL DEFAULT '{}'::text[],
    observed_at            timestamptz NOT NULL,
    verified_at            timestamptz,
    idempotency_key        text NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_outcome_owner_idempotency UNIQUE (owner_id, idempotency_key),
    CONSTRAINT uq_outcome_economic_family UNIQUE (owner_id, economic_event_key, outcome_family_code),
    CONSTRAINT ck_outcome_type CHECK (outcome_type IN (
        'ECONOMIC_OUTCOME', 'DECISION_CARRY_THROUGH', 'MISSION_MILESTONE', 'MISSION_COMPLETION', 'PERSISTENCE'
    )),
    CONSTRAINT ck_outcome_verification CHECK (verification_status IN (
        'A1_VERIFIED', 'A2_CONFIRMED', 'A3_ASSOCIATED', 'A4_OBSERVED'
    )),
    CONSTRAINT ck_outcome_status CHECK (outcome_status IN (
        'PROVISIONAL', 'VERIFIED', 'FINALIZED', 'INVALIDATED', 'SUPERSEDED'
    )),
    CONSTRAINT ck_outcome_amount CHECK (observed_amount IS NULL OR observed_amount >= 0)
);

CREATE TABLE IF NOT EXISTS action.outcome_attribution (
    outcome_attribution_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id               uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    financial_outcome_id   uuid NOT NULL REFERENCES action.financial_outcome(financial_outcome_id) ON DELETE RESTRICT,
    attribution_level      text NOT NULL,
    attribution_factor     numeric(8, 6) NOT NULL,
    decision_id            uuid REFERENCES action.decision(decision_id) ON DELETE RESTRICT,
    mission_id             uuid REFERENCES action.mission(mission_id) ON DELETE RESTRICT,
    source_reference_type  text,
    source_reference_id    uuid,
    reason_codes           text[] NOT NULL DEFAULT '{}'::text[],
    created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_attribution_level CHECK (attribution_level IN ('A1', 'A2', 'A3', 'A4')),
    CONSTRAINT ck_attribution_factor CHECK (
        (attribution_level = 'A1' AND attribution_factor = 1.0) OR
        (attribution_level = 'A2' AND attribution_factor = 0.9) OR
        (attribution_level = 'A3' AND attribution_factor = 0.5) OR
        (attribution_level = 'A4' AND attribution_factor = 0.0)
    )
);

CREATE TABLE IF NOT EXISTS action.financial_impact_event (
    financial_impact_event_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id                  uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    financial_outcome_id      uuid NOT NULL REFERENCES action.financial_outcome(financial_outcome_id) ON DELETE RESTRICT,
    outcome_family_code       text NOT NULL REFERENCES ref.outcome_family(outcome_family_code) ON DELETE RESTRICT,
    impact_type               text NOT NULL,
    impact_basis              text NOT NULL DEFAULT 'ACTUAL',
    amount                    numeric(20, 4) NOT NULL CHECK (amount >= 0),
    currency                  char(3) NOT NULL DEFAULT 'INR',
    attribution_level         text NOT NULL,
    attribution_factor        numeric(8, 6) NOT NULL,
    calculation_method        text NOT NULL DEFAULT 'LEDGER_MATCH_V1',
    calculation_inputs        jsonb NOT NULL DEFAULT '{}'::jsonb,
    status                    text NOT NULL DEFAULT 'FINALIZED',
    economic_impact_key       text NOT NULL,
    finalized_at              timestamptz DEFAULT clock_timestamp(),
    created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_impact_owner_key UNIQUE (owner_id, economic_impact_key),
    CONSTRAINT ck_impact_type CHECK (impact_type IN (
        'PROTECTED', 'SAVED', 'DEBT_PRINCIPAL_REDUCED', 'INTEREST_BURDEN_REDUCED',
        'WEALTH_CONTRIBUTION', 'GOAL_FUNDED', 'CAPACITY_CREATED'
    )),
    CONSTRAINT ck_impact_basis CHECK (impact_basis IN ('ACTUAL', 'ESTIMATED', 'AVOIDED')),
    CONSTRAINT ck_impact_status CHECK (status IN ('PROVISIONAL', 'FINALIZED', 'VOIDED', 'ADJUSTED')),
    CONSTRAINT ck_impact_attr CHECK (attribution_level IN ('A1', 'A2', 'A3', 'A4'))
);

CREATE TABLE IF NOT EXISTS action.mile_event (
    mile_event_id                       uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id                            uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    financial_outcome_id                uuid REFERENCES action.financial_outcome(financial_outcome_id) ON DELETE RESTRICT,
    decision_id                         uuid REFERENCES action.decision(decision_id) ON DELETE RESTRICT,
    mission_id                          uuid REFERENCES action.mission(mission_id) ON DELETE RESTRICT,
    event_type                          text NOT NULL,
    outcome_family_code                 text REFERENCES ref.outcome_family(outcome_family_code) ON DELETE RESTRICT,
    mile_calibration_policy_version_id  uuid REFERENCES ref.mile_calibration_policy(mile_calibration_policy_version_id) ON DELETE RESTRICT,
    mile_finalization_policy_version_id uuid REFERENCES ref.mile_finalization_policy(mile_finalization_policy_version_id) ON DELETE RESTRICT,
    attribution_level                   text NOT NULL,
    base_value                          numeric(12, 4) NOT NULL DEFAULT 0,
    magnitude_factor                    numeric(12, 6) NOT NULL DEFAULT 0,
    significance_factor                 numeric(12, 6) NOT NULL DEFAULT 0,
    confidence_factor                   numeric(12, 6) NOT NULL DEFAULT 0,
    mile_awarded                        numeric(20, 4) NOT NULL DEFAULT 0 CHECK (mile_awarded >= 0),
    status                              text NOT NULL DEFAULT 'FINALIZED',
    economic_event_key                  text,
    dedupe_key                          text NOT NULL,
    evidence_references                 jsonb NOT NULL DEFAULT '[]'::jsonb,
    reason_codes                        text[] NOT NULL DEFAULT '{}'::text[],
    occurred_at                         timestamptz NOT NULL,
    finalized_at                        timestamptz DEFAULT clock_timestamp(),
    created_at                          timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_mile_event_owner_dedupe UNIQUE (owner_id, dedupe_key),
    CONSTRAINT ck_mile_event_type CHECK (event_type IN (
        'OUTCOME', 'DECISION_CARRY_THROUGH', 'MISSION_MILESTONE', 'MISSION_COMPLETION', 'PERSISTENCE'
    )),
    CONSTRAINT ck_mile_event_status CHECK (status IN ('PROVISIONAL', 'FINALIZED', 'VOIDED')),
    CONSTRAINT ck_mile_attr CHECK (attribution_level IN ('A1', 'A2', 'A3', 'A4')),
    CONSTRAINT ck_mile_outcome_link CHECK (event_type <> 'OUTCOME' OR financial_outcome_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_financial_outcome_mission ON action.financial_outcome (owner_id, mission_id);
CREATE INDEX IF NOT EXISTS ix_mile_event_owner_status ON action.mile_event (owner_id, status);

CREATE OR REPLACE VIEW action.v_lifetime_mile_summary AS
SELECT
    owner_id,
    COALESCE(SUM(mile_awarded) FILTER (WHERE status = 'FINALIZED'), 0) AS total_mile_points,
    COUNT(mile_event_id) FILTER (WHERE status = 'FINALIZED') AS total_clarity_moments,
    COUNT(DISTINCT mission_id) FILTER (WHERE mission_id IS NOT NULL AND status = 'FINALIZED') AS missions_supported
FROM action.mile_event
GROUP BY owner_id;

CREATE OR REPLACE VIEW action.v_financial_impact_summary AS
SELECT
    owner_id,
    COALESCE(SUM(amount) FILTER (WHERE impact_type = 'SAVED'), 0) AS total_saved_inr,
    COALESCE(SUM(amount) FILTER (WHERE impact_type = 'WEALTH_CONTRIBUTION'), 0) AS total_invested_inr,
    COALESCE(SUM(amount) FILTER (WHERE impact_type = 'DEBT_PRINCIPAL_REDUCED'), 0) AS total_debt_reduced_inr,
    COALESCE(SUM(amount) FILTER (WHERE impact_type = 'GOAL_FUNDED'), 0) AS total_reserve_funded_inr,
    COALESCE(SUM(amount) FILTER (WHERE impact_type = 'PROTECTED'), 0) AS total_protected_inr
FROM action.financial_impact_event
WHERE status = 'FINALIZED'
GROUP BY owner_id;

ALTER TABLE action.financial_outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE action.outcome_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE action.financial_impact_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE action.mile_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_action_financial_outcome ON action.financial_outcome
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_action_outcome_attribution ON action.outcome_attribution
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_action_financial_impact ON action.financial_impact_event
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_action_mile_event ON action.mile_event
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());

GRANT SELECT ON ref.outcome_family, ref.mile_calibration_policy, ref.mile_finalization_policy TO monytix_finance, monytix_api;
GRANT SELECT, INSERT, UPDATE ON action.financial_outcome, action.outcome_attribution,
    action.financial_impact_event, action.mile_event TO monytix_finance, monytix_api;
GRANT SELECT ON action.v_lifetime_mile_summary, action.v_financial_impact_summary TO monytix_finance, monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'OUTCOMES-MILE',
    'D10-7 outcomes, dual impact/MILE ledgers, rewards views',
    'finance-v0.1',
    'outcomes-mile',
    'A3 auto-match for ACTIVE missions. Activity alone earns 0 MILE.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
