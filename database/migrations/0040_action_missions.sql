-- Decision actions + Mission spawn. Adapted from D10-6 without custom missions / D10-7.

BEGIN;

ALTER TABLE action.decision
  ADD COLUMN IF NOT EXISTS selected_option jsonb,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS selected_at timestamptz;

CREATE TABLE IF NOT EXISTS ref.mission_definition (
    mission_definition_version_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    canonical_mission_code       text NOT NULL,
    definition_version           text NOT NULL DEFAULT '1.0',
    category                     text NOT NULL,
    display_name                 text NOT NULL,
    primary_weight_codes         text[] NOT NULL,
    secondary_weight_codes       text[] NOT NULL DEFAULT '{}'::text[],
    allowed_outcome_families     text[] NOT NULL DEFAULT '{}'::text[],
    product_need_class           text,
    measurement_basis            text NOT NULL,
    attribution_requirement      text NOT NULL DEFAULT 'VERIFIED',
    target_definition            jsonb NOT NULL DEFAULT '{}'::jsonb,
    measurement_contract         jsonb NOT NULL DEFAULT '{}'::jsonb,
    completion_contract          jsonb NOT NULL DEFAULT '{}'::jsonb,
    status                       text NOT NULL DEFAULT 'ACTIVE',
    created_at                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_mission_definition_version UNIQUE (canonical_mission_code, definition_version),
    CONSTRAINT ck_mission_code CHECK (canonical_mission_code ~ '^M(0[1-9]|[1-3][0-9]|4[0-8])$'),
    CONSTRAINT ck_mission_category CHECK (category IN (
        'Build Safety','Reduce Debt','Save for Something','Build Wealth',
        'Improve Spending','Improve Cash Flow','Support Life & Family','Create Freedom'
    )),
    CONSTRAINT ck_mission_primary_weights CHECK (cardinality(primary_weight_codes) >= 1),
    CONSTRAINT ck_mission_attribution CHECK (attribution_requirement IN ('VERIFIED','VERIFIED_OR_CONFIRMED')),
    CONSTRAINT ck_mission_definition_status CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','DEPRECATED'))
);

CREATE TABLE IF NOT EXISTS ref.mission_decision_orbit (
    mission_decision_orbit_id     uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    mission_definition_version_id uuid NOT NULL REFERENCES ref.mission_definition(mission_definition_version_id) ON DELETE RESTRICT,
    decision_family_version_id    uuid NOT NULL REFERENCES ref.decision_family(decision_family_version_id) ON DELETE RESTRICT,
    orbit_role                    text NOT NULL DEFAULT 'PRIMARY',
    created_at                    timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_mission_decision_orbit UNIQUE (mission_definition_version_id, decision_family_version_id),
    CONSTRAINT ck_mission_decision_orbit_role CHECK (orbit_role IN ('PRIMARY','SUPPORTING','OVERLAY'))
);

CREATE TABLE IF NOT EXISTS action.mission (
    mission_id                    uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id                      uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    canonical_mission_definition_version_id uuid NOT NULL REFERENCES ref.mission_definition(mission_definition_version_id) ON DELETE RESTRICT,
    origin_type                   text NOT NULL DEFAULT 'DECISION_CREATED',
    state                         text NOT NULL DEFAULT 'ACTIVE',
    title                         text NOT NULL,
    intent                        text,
    target_definition             jsonb NOT NULL DEFAULT '{}'::jsonb,
    measurement_contract          jsonb NOT NULL,
    completion_contract           jsonb NOT NULL,
    start_at                      timestamptz NOT NULL DEFAULT clock_timestamp(),
    target_at                     timestamptz,
    activated_at                  timestamptz DEFAULT clock_timestamp(),
    completed_at                  timestamptz,
    cancelled_at                  timestamptz,
    expired_at                    timestamptz,
    completion_verification_status text NOT NULL DEFAULT 'UNVERIFIED',
    idempotency_key               text NOT NULL,
    created_at                    timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at                    timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_mission_idempotency UNIQUE (owner_id, idempotency_key),
    CONSTRAINT ck_mission_origin CHECK (origin_type IN ('DECISION_CREATED','USER_CREATED','AI_CONTEXTUAL','MIGRATED')),
    CONSTRAINT ck_mission_state CHECK (state IN ('DRAFT','ACTIVE','PAUSED','COMPLETED','CANCELLED','EXPIRED')),
    CONSTRAINT ck_mission_title_nonblank CHECK (btrim(title) <> ''),
    CONSTRAINT ck_mission_contract_nonempty CHECK (measurement_contract <> '{}'::jsonb AND completion_contract <> '{}'::jsonb),
    CONSTRAINT ck_mission_completion_status CHECK (
        completion_verification_status IN ('UNVERIFIED','ASSOCIATED','CONFIRMED','VERIFIED','NOT_APPLICABLE')
    )
);

CREATE TABLE IF NOT EXISTS action.decision_mission_link (
    decision_mission_link_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id                 uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    decision_id              uuid NOT NULL REFERENCES action.decision(decision_id) ON DELETE RESTRICT,
    mission_id               uuid NOT NULL REFERENCES action.mission(mission_id) ON DELETE RESTRICT,
    link_role                text NOT NULL,
    source                   text NOT NULL,
    created_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_decision_mission_link UNIQUE (decision_id, mission_id, link_role),
    CONSTRAINT ck_decision_mission_role CHECK (link_role IN ('ORIGIN','PRIMARY','SUPPORTING','OVERLAY','CONTEXT_REVEALED')),
    CONSTRAINT ck_decision_mission_source CHECK (source IN ('CANONICAL_ORBIT','SYSTEM_MATCH','USER_LINK','AI_CONTEXTUAL','MIGRATION'))
);

CREATE TABLE IF NOT EXISTS action.decision_state_transition (
    decision_transition_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id               uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    decision_id            uuid NOT NULL REFERENCES action.decision(decision_id) ON DELETE RESTRICT,
    from_state             text,
    to_state               text NOT NULL,
    trigger_type           text NOT NULL,
    action_name            text,
    actor_id               uuid REFERENCES core.authenticated_actor(actor_id) ON DELETE RESTRICT,
    reason_code            text,
    evidence_references    jsonb NOT NULL DEFAULT '[]'::jsonb,
    idempotency_key        text NOT NULL,
    transitioned_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_decision_transition_dedupe UNIQUE (owner_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_action_mission_owner_state ON action.mission (owner_id, state);
CREATE INDEX IF NOT EXISTS ix_decision_mission_link_decision ON action.decision_mission_link (decision_id);

INSERT INTO ref.mission_definition (
    canonical_mission_code, definition_version, category, display_name,
    primary_weight_codes, secondary_weight_codes, allowed_outcome_families,
    product_need_class, measurement_basis, attribution_requirement,
    target_definition, measurement_contract, completion_contract
) VALUES
    ('M01','1.0','Build Safety','Build an Emergency Buffer',ARRAY['W09_RESILIENCE', 'W03_RISK'],ARRAY['W02_COMFORT', 'W01_TIME'],ARRAY['MP'],'Savings / sweep / liquid reserve','Contribution + safety days','VERIFIED',jsonb_build_object('metric_basis','Contribution + safety days'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M02','1.0','Build Safety','Build an Income-Loss Buffer',ARRAY['W09_RESILIENCE', 'W03_RISK'],ARRAY['W01_TIME', 'W04_OBLIGATIONS'],ARRAY['MP'],'Savings / deposit / liquid reserve','Runway months gained','VERIFIED',jsonb_build_object('metric_basis','Runway months gained'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M03','1.0','Build Safety','Build a Medical Reserve',ARRAY['W03_RISK', 'W09_RESILIENCE'],ARRAY['W06_RELATIONSHIPS', 'W04_OBLIGATIONS'],ARRAY['MP'],'Savings + health protection','Reserve / target','VERIFIED',jsonb_build_object('metric_basis','Reserve / target'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M04','1.0','Build Safety','Strengthen Insurance Protection',ARRAY['W03_RISK', 'W06_RELATIONSHIPS'],ARRAY['W04_OBLIGATIONS', 'W09_RESILIENCE'],ARRAY['MP'],'Health / term / accident / relevant cover','Coverage-gap reduction','VERIFIED',jsonb_build_object('metric_basis','Coverage-gap reduction'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M05','1.0','Build Safety','Prepare for an Unexpected Expense',ARRAY['W09_RESILIENCE', 'W03_RISK'],ARRAY['W02_COMFORT', 'W08_ATTENTION'],ARRAY['FC'],'Liquid savings / reserve','Contingency capacity','VERIFIED',jsonb_build_object('metric_basis','Contingency capacity'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M06','1.0','Build Safety','Build 6-12 Months of Security',ARRAY['W09_RESILIENCE', 'W03_RISK'],ARRAY['W01_TIME', 'W02_COMFORT'],ARRAY['MP'],'Savings / deposits / liquid reserve','Months expenses protected','VERIFIED',jsonb_build_object('metric_basis','Months expenses protected'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M07','1.0','Reduce Debt','Clear Credit-Card Debt',ARRAY['W04_OBLIGATIONS', 'W03_RISK'],ARRAY['W02_COMFORT', 'W08_ATTENTION'],ARRAY['DR'],'Repayment / balance transfer / refinance','Principal reduction','VERIFIED',jsonb_build_object('metric_basis','Principal reduction'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M08','1.0','Reduce Debt','Pay Off a Personal Loan Faster',ARRAY['W04_OBLIGATIONS', 'W03_RISK'],ARRAY['W02_COMFORT', 'W01_TIME'],ARRAY['DR'],'Prepayment / refinance','Principal + tenure reduction','VERIFIED',jsonb_build_object('metric_basis','Principal + tenure reduction'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M09','1.0','Reduce Debt','Reduce Home-Loan Burden',ARRAY['W04_OBLIGATIONS', 'W03_RISK'],ARRAY['W10_LEGACY', 'W02_COMFORT'],ARRAY['DR'],'Prepayment / refinance','Principal/tenure/interest impact','VERIFIED',jsonb_build_object('metric_basis','Principal/tenure/interest impact'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M10','1.0','Reduce Debt','Reduce EMI Pressure',ARRAY['W04_OBLIGATIONS', 'W09_RESILIENCE'],ARRAY['W02_COMFORT', 'W03_RISK'],ARRAY['FC'],'Restructure / refinance / reserve','EMI/inflow burden reduction','VERIFIED',jsonb_build_object('metric_basis','EMI/inflow burden reduction'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M11','1.0','Reduce Debt','Cut Recurring Commitments',ARRAY['W04_OBLIGATIONS', 'W08_ATTENTION'],ARRAY['W02_COMFORT'],ARRAY['MS'],'Cancellation / downgrade','Recurring monthly reduction','VERIFIED_OR_CONFIRMED',jsonb_build_object('metric_basis','Recurring monthly reduction'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED_OR_CONFIRMED')),
    ('M12','1.0','Reduce Debt','Become Debt-Free',ARRAY['W04_OBLIGATIONS', 'W09_RESILIENCE'],ARRAY['W03_RISK', 'W10_LEGACY'],ARRAY['DR'],'Repayment / refinance','Total qualifying debt reduction','VERIFIED',jsonb_build_object('metric_basis','Total qualifying debt reduction'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M13','1.0','Save for Something','Build a Home Fund',ARRAY['W10_LEGACY', 'W07_OPPORTUNITY'],ARRAY['W01_TIME', 'W09_RESILIENCE'],ARRAY['GF'],'Savings / deposits / investment / home finance later','Fund / target','VERIFIED',jsonb_build_object('metric_basis','Fund / target'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M14','1.0','Save for Something','Save for a Vehicle',ARRAY['W07_OPPORTUNITY', 'W02_COMFORT'],ARRAY['W01_TIME', 'W04_OBLIGATIONS'],ARRAY['GF'],'Savings / deposit / vehicle finance later','Fund / target','VERIFIED',jsonb_build_object('metric_basis','Fund / target'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M15','1.0','Save for Something','Build an Education Fund',ARRAY['W10_LEGACY', 'W06_RELATIONSHIPS'],ARRAY['W01_TIME', 'W07_OPPORTUNITY'],ARRAY['GF'],'Savings / investment','Corpus / target','VERIFIED',jsonb_build_object('metric_basis','Corpus / target'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M16','1.0','Save for Something','Save for a Wedding',ARRAY['W06_RELATIONSHIPS', 'W01_TIME'],ARRAY['W02_COMFORT', 'W04_OBLIGATIONS'],ARRAY['GF'],'Savings / deposit / investment','Fund / target','VERIFIED',jsonb_build_object('metric_basis','Fund / target'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M17','1.0','Save for Something','Build a Travel Fund',ARRAY['W07_OPPORTUNITY', 'W02_COMFORT'],ARRAY['W01_TIME', 'W06_RELATIONSHIPS'],ARRAY['GF'],'Savings / travel fund','Fund / planned need','VERIFIED',jsonb_build_object('metric_basis','Fund / planned need'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M18','1.0','Save for Something','Fund a Major Purchase',ARRAY['W02_COMFORT', 'W07_OPPORTUNITY'],ARRAY['W01_TIME', 'W03_RISK'],ARRAY['GF'],'Savings / appropriate finance later','Fund / expected cost','VERIFIED',jsonb_build_object('metric_basis','Fund / expected cost'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M19','1.0','Build Wealth','Start Investing Regularly',ARRAY['W07_OPPORTUNITY', 'W10_LEGACY'],ARRAY['W03_RISK', 'W01_TIME'],ARRAY['WB'],'Mutual fund SIP / recurring investment','Contribution frequency','VERIFIED',jsonb_build_object('metric_basis','Contribution frequency'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M20','1.0','Build Wealth','Increase My SIP',ARRAY['W07_OPPORTUNITY', 'W10_LEGACY'],ARRAY['W02_COMFORT', 'W03_RISK'],ARRAY['WB'],'Mutual fund SIP','Incremental contribution rate','VERIFIED',jsonb_build_object('metric_basis','Incremental contribution rate'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M21','1.0','Build Wealth','Put Idle Cash to Work',ARRAY['W07_OPPORTUNITY', 'W09_RESILIENCE'],ARRAY['W03_RISK', 'W02_COMFORT'],ARRAY['WB'],'Deposit / liquid fund / investment','Eligible idle cash deployed','VERIFIED',jsonb_build_object('metric_basis','Eligible idle cash deployed'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M22','1.0','Build Wealth','Build a Long-Term Corpus',ARRAY['W10_LEGACY', 'W07_OPPORTUNITY'],ARRAY['W01_TIME', 'W03_RISK'],ARRAY['WB'],'Investment / deposits','Contributions/corpus vs target','VERIFIED',jsonb_build_object('metric_basis','Contributions/corpus vs target'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M23','1.0','Build Wealth','Keep My Portfolio Balanced',ARRAY['W03_RISK', 'W07_OPPORTUNITY'],ARRAY['W10_LEGACY', 'W08_ATTENTION'],ARRAY['WB'],'Portfolio rebalance','Drift restored','VERIFIED',jsonb_build_object('metric_basis','Drift restored'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M24','1.0','Build Wealth','Build My Retirement Corpus',ARRAY['W10_LEGACY', 'W01_TIME'],ARRAY['W07_OPPORTUNITY', 'W09_RESILIENCE'],ARRAY['WB'],'Retirement / pension / investment','Funding trajectory','VERIFIED',jsonb_build_object('metric_basis','Funding trajectory'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M25','1.0','Improve Spending','Reduce Dining Spend',ARRAY['W02_COMFORT', 'W08_ATTENTION'],ARRAY['W05_IDENTITY', 'W07_OPPORTUNITY'],ARRAY['MS'],'None normally','Contextual spend reduction','VERIFIED_OR_CONFIRMED',jsonb_build_object('metric_basis','Contextual spend reduction'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED_OR_CONFIRMED')),
    ('M26','1.0','Improve Spending','Control Shopping Spend',ARRAY['W02_COMFORT', 'W05_IDENTITY'],ARRAY['W08_ATTENTION', 'W07_OPPORTUNITY'],ARRAY['MS'],'None normally','Spend vs baseline/limit','VERIFIED_OR_CONFIRMED',jsonb_build_object('metric_basis','Spend vs baseline/limit'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED_OR_CONFIRMED')),
    ('M27','1.0','Improve Spending','Reduce Entertainment Spend',ARRAY['W02_COMFORT', 'W08_ATTENTION'],ARRAY['W07_OPPORTUNITY'],ARRAY['MS'],'None normally','Spend vs baseline','VERIFIED_OR_CONFIRMED',jsonb_build_object('metric_basis','Spend vs baseline'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED_OR_CONFIRMED')),
    ('M28','1.0','Improve Spending','Keep Travel Spending Under Control',ARRAY['W02_COMFORT', 'W08_ATTENTION'],ARRAY['W01_TIME', 'W07_OPPORTUNITY'],ARRAY['MS'],'Travel fund / payment solution later','Actual vs contextual plan','VERIFIED_OR_CONFIRMED',jsonb_build_object('metric_basis','Actual vs contextual plan'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED_OR_CONFIRMED')),
    ('M29','1.0','Improve Spending','Reduce Discretionary Spending',ARRAY['W02_COMFORT', 'W08_ATTENTION'],ARRAY['W09_RESILIENCE', 'W07_OPPORTUNITY'],ARRAY['MS', 'FC'],'None; redirect released cash','Discretionary/flexible-income ratio','VERIFIED_OR_CONFIRMED',jsonb_build_object('metric_basis','Discretionary/flexible-income ratio'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED_OR_CONFIRMED')),
    ('M30','1.0','Improve Spending','Stop Financial Leakage',ARRAY['W08_ATTENTION', 'W04_OBLIGATIONS'],ARRAY['W02_COMFORT', 'W09_RESILIENCE'],ARRAY['MS'],'Cancellation / cheaper plan','Identified leakage eliminated','VERIFIED',jsonb_build_object('metric_basis','Identified leakage eliminated'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M31','1.0','Improve Cash Flow','Allocate My Salary Better',ARRAY['W08_ATTENTION', 'W07_OPPORTUNITY'],ARRAY['W04_OBLIGATIONS', 'W02_COMFORT'],ARRAY['FC'],'Savings / debt / SIP / goal allocation','Productive allocation ratio','VERIFIED',jsonb_build_object('metric_basis','Productive allocation ratio'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M32','1.0','Improve Cash Flow','Put Monthly Surplus to Work',ARRAY['W07_OPPORTUNITY', 'W02_COMFORT'],ARRAY['W09_RESILIENCE', 'W10_LEGACY'],ARRAY['FC'],'Savings / debt / deposit / investment','Percent surplus allocated','VERIFIED',jsonb_build_object('metric_basis','Percent surplus allocated'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M33','1.0','Improve Cash Flow','Avoid a Cash Crunch',ARRAY['W09_RESILIENCE', 'W03_RISK'],ARRAY['W01_TIME', 'W04_OBLIGATIONS'],ARRAY['MP'],'Reserve / short-term liquidity','Forecast shortfalls avoided','VERIFIED',jsonb_build_object('metric_basis','Forecast shortfalls avoided'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M34','1.0','Improve Cash Flow','Prepare for a Large Upcoming Expense',ARRAY['W01_TIME', 'W03_RISK'],ARRAY['W02_COMFORT', 'W09_RESILIENCE'],ARRAY['FC'],'Savings / deposit / goal funding','Pre-funded / requirement','VERIFIED',jsonb_build_object('metric_basis','Pre-funded / requirement'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M35','1.0','Improve Cash Flow','Use a Bonus or Windfall Better',ARRAY['W07_OPPORTUNITY', 'W10_LEGACY'],ARRAY['W09_RESILIENCE', 'W02_COMFORT'],ARRAY['FC'],'Debt / reserve / deposit / investment','Productive allocation percent','VERIFIED',jsonb_build_object('metric_basis','Productive allocation percent'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M36','1.0','Improve Cash Flow','Increase My Savings Rate',ARRAY['W09_RESILIENCE', 'W07_OPPORTUNITY'],ARRAY['W02_COMFORT', 'W08_ATTENTION'],ARRAY['MS', 'FC'],'Savings / deposit / investment','Savings-rate improvement','VERIFIED',jsonb_build_object('metric_basis','Savings-rate improvement'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M37','1.0','Support Life & Family','Build a Fund for My Children',ARRAY['W06_RELATIONSHIPS', 'W10_LEGACY'],ARRAY['W01_TIME', 'W07_OPPORTUNITY'],ARRAY['GF'],'Savings / investment','Corpus / target','VERIFIED',jsonb_build_object('metric_basis','Corpus / target'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M38','1.0','Support Life & Family','Support My Parents',ARRAY['W06_RELATIONSHIPS', 'W04_OBLIGATIONS'],ARRAY['W09_RESILIENCE', 'W01_TIME'],ARRAY['GF', 'FC'],'Savings / protection','Planned support capacity','VERIFIED',jsonb_build_object('metric_basis','Planned support capacity'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M39','1.0','Support Life & Family','Prepare for Family Healthcare',ARRAY['W06_RELATIONSHIPS', 'W03_RISK'],ARRAY['W09_RESILIENCE', 'W04_OBLIGATIONS'],ARRAY['MP'],'Health insurance / reserve','Reserve + protection gap','VERIFIED',jsonb_build_object('metric_basis','Reserve + protection gap'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M40','1.0','Support Life & Family','Prepare for Family Education',ARRAY['W06_RELATIONSHIPS', 'W10_LEGACY'],ARRAY['W01_TIME', 'W07_OPPORTUNITY'],ARRAY['GF'],'Savings / investment','Corpus / requirement','VERIFIED',jsonb_build_object('metric_basis','Corpus / requirement'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M41','1.0','Support Life & Family','Build a Family Safety Net',ARRAY['W06_RELATIONSHIPS', 'W09_RESILIENCE'],ARRAY['W03_RISK', 'W10_LEGACY'],ARRAY['MP'],'Insurance + liquid reserve','Protection months/coverage','VERIFIED',jsonb_build_object('metric_basis','Protection months/coverage'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M42','1.0','Support Life & Family','Prepare for a Family Milestone',ARRAY['W06_RELATIONSHIPS', 'W01_TIME'],ARRAY['W02_COMFORT', 'W10_LEGACY'],ARRAY['GF'],'Savings / investment','Funded amount / requirement','VERIFIED',jsonb_build_object('metric_basis','Funded amount / requirement'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M43','1.0','Create Freedom','Prepare for a Career Break',ARRAY['W01_TIME', 'W09_RESILIENCE'],ARRAY['W07_OPPORTUNITY', 'W02_COMFORT'],ARRAY['FC'],'Liquid reserve / investment corpus','Funded runway months','VERIFIED',jsonb_build_object('metric_basis','Funded runway months'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M44','1.0','Create Freedom','Prepare to Start a Business',ARRAY['W07_OPPORTUNITY', 'W09_RESILIENCE'],ARRAY['W03_RISK', 'W05_IDENTITY'],ARRAY['GF', 'FC'],'Savings / investment / business finance later','Runway target','VERIFIED',jsonb_build_object('metric_basis','Runway target'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M45','1.0','Create Freedom','Prepare to Relocate',ARRAY['W07_OPPORTUNITY', 'W01_TIME'],ARRAY['W09_RESILIENCE', 'W06_RELATIONSHIPS'],ARRAY['GF'],'Savings / liquidity','Fund / transition cost','VERIFIED',jsonb_build_object('metric_basis','Fund / transition cost'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M46','1.0','Create Freedom','Work Toward Financial Independence',ARRAY['W10_LEGACY', 'W07_OPPORTUNITY'],ARRAY['W01_TIME', 'W09_RESILIENCE'],ARRAY['FC', 'WB'],'Investment / retirement solutions','Sustainable capacity trajectory','VERIFIED',jsonb_build_object('metric_basis','Sustainable capacity trajectory'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M47','1.0','Create Freedom','Retire Earlier',ARRAY['W01_TIME', 'W10_LEGACY'],ARRAY['W07_OPPORTUNITY', 'W09_RESILIENCE'],ARRAY['WB'],'Retirement / pension / investment','Time-to-goal reduction','VERIFIED',jsonb_build_object('metric_basis','Time-to-goal reduction'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED')),
    ('M48','1.0','Create Freedom','Build More Financial Flexibility',ARRAY['W07_OPPORTUNITY', 'W09_RESILIENCE'],ARRAY['W02_COMFORT', 'W04_OBLIGATIONS'],ARRAY['FC'],'Savings / investment','Flexible resources vs obligations','VERIFIED',jsonb_build_object('metric_basis','Flexible resources vs obligations'),jsonb_build_object('requires_evidence',true),jsonb_build_object('manual_done_insufficient',true,'attribution_requirement','VERIFIED'))
ON CONFLICT (canonical_mission_code, definition_version) DO NOTHING;

WITH x(mission_code, decision_code, orbit_role) AS (VALUES
    ('M01','D1','PRIMARY'),
    ('M01','D17','PRIMARY'),
    ('M02','D1','PRIMARY'),
    ('M02','D2','PRIMARY'),
    ('M03','D1','PRIMARY'),
    ('M03','D2','PRIMARY'),
    ('M04','D5','PRIMARY'),
    ('M04','D6','PRIMARY'),
    ('M05','D2','PRIMARY'),
    ('M05','D12','PRIMARY'),
    ('M06','D1','PRIMARY'),
    ('M06','D13','PRIMARY'),
    ('M06','D17','PRIMARY'),
    ('M07','D3','PRIMARY'),
    ('M08','D4','PRIMARY'),
    ('M09','D4','PRIMARY'),
    ('M10','D4','PRIMARY'),
    ('M10','D12','PRIMARY'),
    ('M11','D9','PRIMARY'),
    ('M12','D3','PRIMARY'),
    ('M12','D4','PRIMARY'),
    ('M13','D14','PRIMARY'),
    ('M13','D22','PRIMARY'),
    ('M14','D11','PRIMARY'),
    ('M14','D14','PRIMARY'),
    ('M15','D14','PRIMARY'),
    ('M15','D22','PRIMARY'),
    ('M16','D11','PRIMARY'),
    ('M16','D14','PRIMARY'),
    ('M17','D14','PRIMARY'),
    ('M17','D26','PRIMARY'),
    ('M18','D11','PRIMARY'),
    ('M18','D14','PRIMARY'),
    ('M19','D18','PRIMARY'),
    ('M19','D19','PRIMARY'),
    ('M20','D18','PRIMARY'),
    ('M21','D7','PRIMARY'),
    ('M21','D19','PRIMARY'),
    ('M22','D18','PRIMARY'),
    ('M22','D22','PRIMARY'),
    ('M23','D20','PRIMARY'),
    ('M24','D21','PRIMARY'),
    ('M24','D22','PRIMARY'),
    ('M25','D23','PRIMARY'),
    ('M26','D24','PRIMARY'),
    ('M27','D25','PRIMARY'),
    ('M28','D26','PRIMARY'),
    ('M29','D27','PRIMARY'),
    ('M30','D9','PRIMARY'),
    ('M30','D10','PRIMARY'),
    ('M31','D15','PRIMARY'),
    ('M32','D8','PRIMARY'),
    ('M33','D12','PRIMARY'),
    ('M34','D11','PRIMARY'),
    ('M35','D16','PRIMARY'),
    ('M36','D13','PRIMARY'),
    ('M37','D14','PRIMARY'),
    ('M37','D22','PRIMARY'),
    ('M38','D11','PRIMARY'),
    ('M38','D14','PRIMARY'),
    ('M39','D6','PRIMARY'),
    ('M39','D11','PRIMARY'),
    ('M40','D14','PRIMARY'),
    ('M40','D22','PRIMARY'),
    ('M41','D1','PRIMARY'),
    ('M41','D6','PRIMARY'),
    ('M42','D11','PRIMARY'),
    ('M42','D14','PRIMARY'),
    ('M43','D14','PRIMARY'),
    ('M43','D21','PRIMARY'),
    ('M44','D14','PRIMARY'),
    ('M44','D22','PRIMARY'),
    ('M45','D11','PRIMARY'),
    ('M45','D14','PRIMARY'),
    ('M46','D21','PRIMARY'),
    ('M47','D21','PRIMARY'),
    ('M47','D22','PRIMARY'),
    ('M48','D2','PRIMARY'),
    ('M48','D8','PRIMARY'),
    ('M48','D13','PRIMARY')
)
INSERT INTO ref.mission_decision_orbit (mission_definition_version_id, decision_family_version_id, orbit_role)
SELECT m.mission_definition_version_id, d.decision_family_version_id, x.orbit_role
FROM x
JOIN ref.mission_definition m ON m.canonical_mission_code = x.mission_code AND m.definition_version = '1.0'
JOIN ref.decision_family d ON d.decision_family_code = x.decision_code AND d.definition_version = '1.0'
ON CONFLICT (mission_definition_version_id, decision_family_version_id) DO NOTHING;


ALTER TABLE action.mission ENABLE ROW LEVEL SECURITY;
ALTER TABLE action.decision_mission_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE action.decision_state_transition ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_action_mission ON action.mission
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_action_decision_mission_link ON action.decision_mission_link
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_action_decision_state_transition ON action.decision_state_transition
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());

GRANT SELECT ON ref.mission_definition, ref.mission_decision_orbit TO monytix_finance, monytix_api;
GRANT SELECT, INSERT, UPDATE ON action.mission, action.decision_mission_link, action.decision_state_transition TO monytix_finance, monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'ACTION-MISSIONS',
    'Mission registry M01-M48, orbits, decision actions lifecycle',
    'finance-v0.1',
    'action-missions',
    'ACCEPT spawns primary orbit mission. No custom missions or D10-7.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
