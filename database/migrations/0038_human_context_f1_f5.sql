-- F1-F5 human context: eligibility, weights, feedback, mode, and reflections.
-- Decision cards and missions are not in this migration.

BEGIN;

ALTER TABLE finance.ledger_transactions DROP CONSTRAINT ck_ledger_channel;
ALTER TABLE finance.ledger_transactions
    ADD CONSTRAINT ck_ledger_channel CHECK (
        channel IN (
            'UPI', 'UPI_P2P', 'UPI_P2M', 'UPI_P2M_DEFERRED', 'UPI_MANDATE',
            'IMPS', 'NEFT', 'RTGS', 'CARD_POS', 'CARD_ECOMMERCE',
            'ATM', 'ACH', 'ACH_NACH', 'CHEQUE', 'CARD', 'FT', 'OTHER',
            'OWN_ACCOUNT_TRANSFER'
        )
    );

ALTER TABLE finance.ledger_transactions
    ADD COLUMN payment_network varchar(16),
    ADD COLUMN gateway varchar(32),
    ADD COLUMN legal_entity varchar(128),
    ADD COLUMN operating_country varchar(16),
    ADD CONSTRAINT ck_ledger_network CHECK (
        payment_network IS NULL OR payment_network IN ('VISA', 'MASTERCARD', 'RUPAY', 'AMEX')
    ),
    ADD CONSTRAINT ck_ledger_country CHECK (
        operating_country IS NULL OR operating_country IN ('IN', 'OVERSEAS')
    );

CREATE SCHEMA IF NOT EXISTS human_context;

DO $$ BEGIN
  CREATE TYPE human_context.weight_code AS ENUM (
    'W01_TIME',
    'W02_COMFORT',
    'W03_RISK',
    'W04_OBLIGATIONS',
    'W05_IDENTITY',
    'W06_RELATIONSHIPS',
    'W07_OPPORTUNITY',
    'W08_ATTENTION',
    'W09_RESILIENCE',
    'W10_LEGACY'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE human_context.eligibility_state AS ENUM (
    'IGNORE',
    'OBSERVE',
    'WEIGHT',
    'PROMOTE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE human_context.decision_mode AS ENUM (
    'CONSCIOUS',
    'AUTOMATIC',
    'AVOIDED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE human_context.feedback_action AS ENUM (
    'CONFIRMED',
    'REJECTED',
    'USER_ADDED',
    'REMOVED',
    'REPLACED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE human_context.context_target_type AS ENUM (
    'TRANSACTION',
    'DECISION',
    'MISSION'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS human_context.weight_master (
  code human_context.weight_code PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  short_phrase VARCHAR(128) NOT NULL,
  description TEXT NOT NULL,
  core_thesis TEXT NOT NULL,
  display_order SMALLINT NOT NULL UNIQUE,
  ontology_version VARCHAR(16) DEFAULT 'v1.2' NOT NULL,
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

INSERT INTO human_context.weight_master (code, name, short_phrase, description, core_thesis, display_order)
VALUES
  ('W01_TIME', 'Time', 'The time gained, spent, delayed or committed', 'The future cost of today''s choice. Locking tomorrow''s freedom to service current consumption.', 'Time cannot be bought back, but it is routinely traded away in increments.', 1),
  ('W02_COMFORT', 'Comfort', 'Convenience, ease, lifestyle or immediate relief', 'The premium paid to buy back convenience or bypass immediate friction.', 'Comfort rarely demands attention; it simply asks you to repeat yesterday.', 2),
  ('W03_RISK', 'Risk', 'Exposure to uncertainty, downside, or volatility', 'The level of future uncertainty or volatility you intentionally absorb or hedge against.', 'Risk unseen is vulnerability; risk acknowledged is insurance.', 3),
  ('W04_OBLIGATIONS', 'Obligations', 'Existing commitments, responsibilities and recurring duties', 'Fixed mandatory charges and dependencies that narrow future discretion.', 'An obligation accepted without clarity becomes a quiet constraint on future choices.', 4),
  ('W05_IDENTITY', 'Identity', 'Who you believe you are or want to become', 'How the choice relates to personal values, aspiration, mastery, and true self.', 'Money spent on identity either builds who you are becoming or pays rent on who you used to be.', 5),
  ('W06_RELATIONSHIPS', 'Relationships', 'Effects on family, partners, dependants or friends', 'The interpersonal social capital, mutual aid, and care obligations carried.', 'Financial decisions rarely stay inside personal boundaries; they spill over into relationships.', 6),
  ('W07_OPPORTUNITY', 'Opportunity', 'What becomes possible or forgone elsewhere', 'Liquid options and capital preserved to deploy toward future potential.', 'Every commitment of resource is simultaneously a rejection of all alternative futures.', 7),
  ('W08_ATTENTION', 'Attention', 'The mental effort, monitoring and cognitive load demanded', 'The ongoing bandwidth and psychic overhead required to manage the decision.', 'A choice that demands constant monitoring is never free, regardless of financial cost.', 8),
  ('W09_RESILIENCE', 'Resilience', 'The effect on buffers, safety nets and shock absorption', 'Buffers that absorb emergencies and insulate you against downside surprises.', 'Resilience is the buffer between an unexpected surprise and personal crisis.', 9),
  ('W10_LEGACY', 'Legacy', 'The long-term consequence the decision leaves behind', 'Multi-year impact, wealth preservation, generational transfer, and lasting footprint.', 'Legacy is built sentence by sentence in today''s trade-offs.', 10)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  short_phrase = EXCLUDED.short_phrase,
  description = EXCLUDED.description,
  core_thesis = EXCLUDED.core_thesis,
  display_order = EXCLUDED.display_order;

CREATE TABLE IF NOT EXISTS human_context.weight_eligibility_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES finance.ledger_transactions(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  state human_context.eligibility_state NOT NULL,
  reason_code VARCHAR(64) NOT NULL,
  evidence_summary JSONB DEFAULT '{}'::jsonb NOT NULL,
  evaluated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT uq_eligibility_txn UNIQUE (transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_hc_eligibility_owner_state
ON human_context.weight_eligibility_results (owner_id, state);

CREATE TABLE IF NOT EXISTS human_context.weight_inference_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES finance.ledger_transactions(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  primary_inferred_weight human_context.weight_code NOT NULL REFERENCES human_context.weight_master(code),
  secondary_inferred_weight human_context.weight_code REFERENCES human_context.weight_master(code),
  confidence_score NUMERIC(5, 4) NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 1.0),
  rule_id VARCHAR(64),
  model_version VARCHAR(32) NOT NULL DEFAULT 'rulebook_v1.2',
  scoring_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  inferred_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hc_inference_txn
ON human_context.weight_inference_runs (transaction_id);

CREATE TABLE IF NOT EXISTS human_context.weight_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  target_type human_context.context_target_type NOT NULL,
  target_id UUID NOT NULL,
  weight_code human_context.weight_code NOT NULL REFERENCES human_context.weight_master(code),
  is_primary BOOLEAN DEFAULT FALSE NOT NULL,
  intensity NUMERIC(4, 2) DEFAULT 1.0 NOT NULL CHECK (intensity > 0),
  effective_source VARCHAR(16) NOT NULL CHECK (effective_source IN ('SYSTEM_INFERENCE', 'USER_FEEDBACK', 'RULE_OVERRIDE')),
  is_effective BOOLEAN DEFAULT TRUE NOT NULL,
  version INT DEFAULT 1 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  superseded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hc_effective_weight
ON human_context.weight_associations (target_type, target_id, weight_code)
WHERE is_effective;

CREATE INDEX IF NOT EXISTS idx_hc_associations_effective
ON human_context.weight_associations (owner_id, target_type, target_id)
WHERE is_effective = TRUE;

CREATE TABLE IF NOT EXISTS human_context.weight_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  target_type human_context.context_target_type NOT NULL,
  target_id UUID NOT NULL,
  weight_code human_context.weight_code NOT NULL REFERENCES human_context.weight_master(code),
  action human_context.feedback_action NOT NULL,
  replaced_weight_code human_context.weight_code REFERENCES human_context.weight_master(code),
  client_idempotency_key VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT uq_weight_feedback_idempotency UNIQUE (owner_id, client_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_hc_feedback_target
ON human_context.weight_feedback (target_type, target_id);

CREATE TABLE IF NOT EXISTS human_context.decision_mode_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES finance.ledger_transactions(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  mode human_context.decision_mode NOT NULL,
  annotated_via VARCHAR(32) DEFAULT 'SCREEN_QUICK_TAG' NOT NULL,
  version INT DEFAULT 1 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT uq_decision_mode_txn UNIQUE (transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_hc_mode_owner_mode
ON human_context.decision_mode_annotations (owner_id, mode);

CREATE TABLE IF NOT EXISTS human_context.reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  target_type human_context.context_target_type NOT NULL,
  target_id UUID NOT NULL,
  reflection_text TEXT,
  weight_feeling VARCHAR(32),
  dominant_felt_weight human_context.weight_code REFERENCES human_context.weight_master(code),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hc_reflections_target
ON human_context.reflections (target_type, target_id);

CREATE OR REPLACE VIEW human_context.v_effective_transaction_context
WITH (security_invoker = true) AS
SELECT
  lt.id AS transaction_id,
  lt.owner_id,
  lt.posted_at,
  lt.amount,
  lt.flow,
  lt.clean_merchant,
  lt.category_id,
  lt.subcategory_id,
  el.state AS eligibility_state,
  dma.mode AS decision_mode,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'code', wa.weight_code,
        'name', wm.name,
        'is_primary', wa.is_primary,
        'source', wa.effective_source,
        'intensity', wa.intensity
      ) ORDER BY wa.is_primary DESC, wm.display_order ASC
    ) FILTER (WHERE wa.weight_code IS NOT NULL),
    '[]'::jsonb
  ) AS effective_weights,
  latest.reflection_text,
  latest.weight_feeling
FROM finance.ledger_transactions lt
LEFT JOIN human_context.weight_eligibility_results el
  ON el.transaction_id = lt.id
LEFT JOIN human_context.decision_mode_annotations dma
  ON dma.transaction_id = lt.id
LEFT JOIN human_context.weight_associations wa
  ON wa.target_id = lt.id
 AND wa.target_type = 'TRANSACTION'
 AND wa.is_effective = TRUE
LEFT JOIN human_context.weight_master wm
  ON wm.code = wa.weight_code
LEFT JOIN LATERAL (
  SELECT r.reflection_text, r.weight_feeling
  FROM human_context.reflections r
  WHERE r.target_id = lt.id
    AND r.target_type = 'TRANSACTION'
  ORDER BY r.created_at DESC
  LIMIT 1
) latest ON true
GROUP BY
  lt.id, el.state, dma.mode, latest.reflection_text, latest.weight_feeling;

ALTER TABLE human_context.weight_eligibility_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE human_context.weight_inference_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE human_context.weight_associations ENABLE ROW LEVEL SECURITY;
ALTER TABLE human_context.weight_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE human_context.decision_mode_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE human_context.reflections ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_hc_eligibility ON human_context.weight_eligibility_results
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_hc_inference ON human_context.weight_inference_runs
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_hc_association ON human_context.weight_associations
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_hc_feedback ON human_context.weight_feedback
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_hc_mode ON human_context.decision_mode_annotations
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());
CREATE POLICY pol_hc_reflection ON human_context.reflections
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());

GRANT USAGE ON SCHEMA human_context TO monytix_finance, monytix_api;
GRANT SELECT ON human_context.weight_master TO monytix_finance, monytix_api;
GRANT SELECT, INSERT, UPDATE ON
    human_context.weight_eligibility_results,
    human_context.weight_inference_runs,
    human_context.weight_associations,
    human_context.weight_feedback,
    human_context.decision_mode_annotations,
    human_context.reflections
TO monytix_finance, monytix_api;
GRANT SELECT ON human_context.v_effective_transaction_context TO monytix_finance, monytix_api;

REVOKE ALL ON SCHEMA human_context FROM monytix_intelligence;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'HUMAN-CONTEXT',
    'Eligibility, canonical weights, and non-destructive feedback',
    'finance-v0.1',
    'human-context-f1-f5',
    'Ledger evidence is step 1. This schema stores F2 eligibility and F1/F5 weights without decision cards.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
