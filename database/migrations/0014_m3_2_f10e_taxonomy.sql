-- M3.2 F10E eligibility gate.
-- Assigns no spend category. Merchant-use classification stays blocked
-- until F10C party evidence and an F10D MERCHANT_PURCHASE resolution exist.
-- Does not edit migrations 0001-0013 and does not change canonical money.

BEGIN;

CREATE TABLE IF NOT EXISTS ref.taxonomy_version (
    taxonomy_version_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    taxonomy_version    text NOT NULL,
    status              text NOT NULL DEFAULT 'ACTIVE',
    created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_taxonomy_version UNIQUE (taxonomy_version),
    CONSTRAINT ck_taxonomy_version_nonblank CHECK (btrim(taxonomy_version) <> ''),
    CONSTRAINT ck_taxonomy_version_status CHECK (status IN ('ACTIVE', 'RETIRED'))
);

CREATE TABLE IF NOT EXISTS ref.taxonomy_category (
    taxonomy_category_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    taxonomy_version     text NOT NULL REFERENCES ref.taxonomy_version(taxonomy_version),
    category_code        text NOT NULL,
    display_name         text NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_taxonomy_category UNIQUE (taxonomy_version, category_code),
    CONSTRAINT ck_taxonomy_category_code CHECK (btrim(category_code) <> '')
);

CREATE TABLE IF NOT EXISTS ref.taxonomy_subcategory (
    taxonomy_subcategory_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    taxonomy_version        text NOT NULL,
    category_code           text NOT NULL,
    subcategory_code        text NOT NULL,
    display_name            text NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_taxonomy_subcategory UNIQUE (taxonomy_version, subcategory_code),
    CONSTRAINT fk_taxonomy_subcategory_category FOREIGN KEY (taxonomy_version, category_code)
        REFERENCES ref.taxonomy_category(taxonomy_version, category_code),
    CONSTRAINT ck_taxonomy_subcategory_code CHECK (btrim(subcategory_code) <> '')
);

CREATE TABLE IF NOT EXISTS ref.taxonomy_purpose (
    taxonomy_purpose_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    taxonomy_version    text NOT NULL REFERENCES ref.taxonomy_version(taxonomy_version),
    purpose_code        text NOT NULL,
    display_name        text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_taxonomy_purpose UNIQUE (taxonomy_version, purpose_code),
    CONSTRAINT ck_taxonomy_purpose_code CHECK (btrim(purpose_code) <> '')
);

COMMENT ON TABLE ref.taxonomy_subcategory IS
'Child codes. F10E v1.2 names representative English labels and does not publish stable subcategory codes, so this slice seeds none.';

CREATE TABLE IF NOT EXISTS ref.category_event_constraint (
    category_event_constraint_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    taxonomy_version             text NOT NULL REFERENCES ref.taxonomy_version(taxonomy_version),
    event_family                 text,
    event_outcome                text NOT NULL,
    category_behavior            text NOT NULL,
    purpose_behavior             text NOT NULL,
    contract_ref                 text NOT NULL,
    created_at                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_category_event_outcome CHECK (event_outcome IN ('RESOLVED', 'UNKNOWN', 'AMBIGUOUS')),
    CONSTRAINT ck_category_event_category_behavior CHECK (category_behavior IN (
        'NOT_APPLICABLE', 'DO_NOT_FORCE', 'INHERIT_OR_UNKNOWN', 'MERCHANT_BLOCKED'
    )),
    CONSTRAINT ck_category_event_purpose_behavior CHECK (purpose_behavior IN (
        'NOT_APPLICABLE', 'UNKNOWN_WITHOUT_EVIDENCE', 'DO_NOT_FORCE', 'INHERIT_OR_UNKNOWN'
    )),
    CONSTRAINT ck_category_event_family CHECK (
        event_family IS NULL OR event_family IN (
            'INCOME', 'BORROWING', 'LOAN_REPAYMENT', 'CREDIT_CARD_PAYMENT',
            'INVESTMENT', 'INVESTMENT_PROCEEDS', 'INVESTMENT_INCOME',
            'INSURANCE', 'INSURANCE_PAYOUT', 'TAX_GOVERNMENT',
            'INTERNAL_TRANSFER', 'PERSON_TRANSFER', 'MERCHANT_PURCHASE',
            'CASH_MOVEMENT', 'FEE_CHARGE', 'REFUND_REVERSAL', 'OTHER_FINANCIAL_EVENT'
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_category_event_constraint
    ON ref.category_event_constraint (taxonomy_version, event_outcome, COALESCE(event_family, ''));

INSERT INTO ref.taxonomy_version (taxonomy_version)
VALUES ('F10E-v1.2')
ON CONFLICT (taxonomy_version) DO NOTHING;

INSERT INTO ref.taxonomy_category (taxonomy_version, category_code, display_name) VALUES
    ('F10E-v1.2', 'FOOD_DINING', 'Food & Dining'),
    ('F10E-v1.2', 'GROCERIES_HOUSEHOLD', 'Groceries & Household'),
    ('F10E-v1.2', 'HOUSING_HOME', 'Housing & Home'),
    ('F10E-v1.2', 'UTILITIES_COMMUNICATION', 'Utilities & Communication'),
    ('F10E-v1.2', 'MOBILITY_TRANSPORT', 'Mobility & Transport'),
    ('F10E-v1.2', 'TRAVEL', 'Travel'),
    ('F10E-v1.2', 'HEALTH_MEDICAL', 'Health & Medical'),
    ('F10E-v1.2', 'EDUCATION_LEARNING', 'Education & Learning'),
    ('F10E-v1.2', 'SHOPPING_RETAIL', 'Shopping & Retail'),
    ('F10E-v1.2', 'PERSONAL_CARE', 'Personal Care'),
    ('F10E-v1.2', 'FITNESS_WELLNESS', 'Fitness & Wellness'),
    ('F10E-v1.2', 'ENTERTAINMENT_MEDIA', 'Entertainment & Media'),
    ('F10E-v1.2', 'FAMILY_CHILDCARE', 'Family & Childcare'),
    ('F10E-v1.2', 'PETS', 'Pets'),
    ('F10E-v1.2', 'GIFTS_CELEBRATIONS', 'Gifts & Celebrations'),
    ('F10E-v1.2', 'CHARITY_GIVING', 'Charity & Giving'),
    ('F10E-v1.2', 'PROFESSIONAL_BUSINESS', 'Professional & Business Use'),
    ('F10E-v1.2', 'GOVERNMENT_CIVIC', 'Government & Civic Services'),
    ('F10E-v1.2', 'FINANCIAL_SERVICES', 'Financial Services'),
    ('F10E-v1.2', 'OTHER_MERCHANT', 'Other Merchant Spend')
ON CONFLICT (taxonomy_version, category_code) DO NOTHING;

INSERT INTO ref.taxonomy_purpose (taxonomy_version, purpose_code, display_name) VALUES
    ('F10E-v1.2', 'HOME_CONSUMPTION', 'Routine household consumption'),
    ('F10E-v1.2', 'COMMUTE', 'Routine local travel'),
    ('F10E-v1.2', 'TRAVEL_LEISURE', 'Trip or vacation'),
    ('F10E-v1.2', 'WORK_BUSINESS_USE', 'Work or business context'),
    ('F10E-v1.2', 'EDUCATION', 'Learning context'),
    ('F10E-v1.2', 'HEALTH_CARE', 'Treatment or medical care'),
    ('F10E-v1.2', 'FAMILY_SUPPORT', 'Support for family'),
    ('F10E-v1.2', 'CHILD_RELATED', 'Child-specific use'),
    ('F10E-v1.2', 'GIFT', 'Gift to another person'),
    ('F10E-v1.2', 'CELEBRATION_EVENT', 'Celebration or occasion'),
    ('F10E-v1.2', 'CHARITY_SUPPORT', 'Donation or social support'),
    ('F10E-v1.2', 'SHARED_EXPENSE', 'Shared expenditure'),
    ('F10E-v1.2', 'REIMBURSEMENT', 'Repayment or reimbursement'),
    ('F10E-v1.2', 'ASSET_UPKEEP', 'Maintenance of an owned asset'),
    ('F10E-v1.2', 'SUBSCRIPTION_SERVICE', 'Ongoing service access'),
    ('F10E-v1.2', 'OTHER_DECLARED', 'User-declared residual purpose'),
    ('F10E-v1.2', 'UNKNOWN', 'No defensible purpose evidence')
ON CONFLICT (taxonomy_version, purpose_code) DO NOTHING;

INSERT INTO ref.category_event_constraint (
    taxonomy_version, event_family, event_outcome, category_behavior, purpose_behavior, contract_ref
) VALUES
    ('F10E-v1.2', 'INCOME', 'RESOLVED', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 'F10E v1.2 section 8'),
    ('F10E-v1.2', 'INVESTMENT_INCOME', 'RESOLVED', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 'F10E v1.2 section 8'),
    ('F10E-v1.2', 'BORROWING', 'RESOLVED', 'NOT_APPLICABLE', 'UNKNOWN_WITHOUT_EVIDENCE', 'F10E v1.2 section 8'),
    ('F10E-v1.2', 'LOAN_REPAYMENT', 'RESOLVED', 'NOT_APPLICABLE', 'UNKNOWN_WITHOUT_EVIDENCE', 'F10E v1.2 section 8'),
    ('F10E-v1.2', 'CREDIT_CARD_PAYMENT', 'RESOLVED', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 'F10E v1.2 section 8 AC-07'),
    ('F10E-v1.2', 'INVESTMENT', 'RESOLVED', 'NOT_APPLICABLE', 'UNKNOWN_WITHOUT_EVIDENCE', 'F10E v1.2 section 8'),
    ('F10E-v1.2', 'INVESTMENT_PROCEEDS', 'RESOLVED', 'NOT_APPLICABLE', 'UNKNOWN_WITHOUT_EVIDENCE', 'F10E v1.2 section 8'),
    ('F10E-v1.2', 'INSURANCE', 'RESOLVED', 'NOT_APPLICABLE', 'UNKNOWN_WITHOUT_EVIDENCE', 'F10E v1.2 section 8'),
    ('F10E-v1.2', 'INSURANCE_PAYOUT', 'RESOLVED', 'NOT_APPLICABLE', 'UNKNOWN_WITHOUT_EVIDENCE', 'F10E v1.2 section 8'),
    ('F10E-v1.2', 'INTERNAL_TRANSFER', 'RESOLVED', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 'F10E v1.2 section 8 AC-08'),
    ('F10E-v1.2', 'CASH_MOVEMENT', 'RESOLVED', 'DO_NOT_FORCE', 'UNKNOWN_WITHOUT_EVIDENCE', 'F10E v1.2 section 8 AC-09 AC-33'),
    ('F10E-v1.2', 'REFUND_REVERSAL', 'RESOLVED', 'INHERIT_OR_UNKNOWN', 'INHERIT_OR_UNKNOWN', 'F10E v1.2 section 18'),
    ('F10E-v1.2', 'FEE_CHARGE', 'RESOLVED', 'MERCHANT_BLOCKED', 'NOT_APPLICABLE', 'F10E v1.2 section 8'),
    ('F10E-v1.2', 'TAX_GOVERNMENT', 'RESOLVED', 'MERCHANT_BLOCKED', 'UNKNOWN_WITHOUT_EVIDENCE', 'F10E v1.2 section 8'),
    ('F10E-v1.2', 'PERSON_TRANSFER', 'RESOLVED', 'NOT_APPLICABLE', 'UNKNOWN_WITHOUT_EVIDENCE', 'F10E v1.2 section 8'),
    ('F10E-v1.2', 'MERCHANT_PURCHASE', 'RESOLVED', 'MERCHANT_BLOCKED', 'UNKNOWN_WITHOUT_EVIDENCE', 'F10E v1.2 section 8 AC-06'),
    ('F10E-v1.2', 'OTHER_FINANCIAL_EVENT', 'RESOLVED', 'DO_NOT_FORCE', 'DO_NOT_FORCE', 'F10E v1.2 section 8'),
    ('F10E-v1.2', NULL, 'UNKNOWN', 'DO_NOT_FORCE', 'DO_NOT_FORCE', 'F10E v1.2 section 8 AC-10'),
    ('F10E-v1.2', NULL, 'AMBIGUOUS', 'DO_NOT_FORCE', 'DO_NOT_FORCE', 'F10E v1.2 section 8 AC-10')
ON CONFLICT DO NOTHING;

DO $check$
BEGIN
    IF (SELECT count(*) FROM ref.taxonomy_category WHERE taxonomy_version = 'F10E-v1.2') <> 20 THEN
        RAISE EXCEPTION 'F10E section 7 publishes 20 category codes';
    END IF;
    IF EXISTS (
        SELECT 1 FROM ref.taxonomy_category
         WHERE taxonomy_version = 'F10E-v1.2'
           AND category_code IN ('INCOME', 'TRANSFER', 'LOAN', 'INVESTMENT', 'INSURANCE', 'CASH', 'CREDIT_CARD_PAYMENT', 'EXPENSE')
    ) THEN
        RAISE EXCEPTION 'retired event names are not F10E category codes';
    END IF;
    IF (SELECT count(*) FROM ref.taxonomy_subcategory WHERE taxonomy_version = 'F10E-v1.2') <> 0 THEN
        RAISE EXCEPTION 'stable subcategory codes were not published';
    END IF;
END;
$check$;

CREATE TABLE IF NOT EXISTS intel.category_resolution (
    category_resolution_id           uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    logical_transaction_id           uuid NOT NULL REFERENCES core.logical_transaction(logical_transaction_id) ON DELETE RESTRICT,
    financial_event_resolution_id    uuid NOT NULL REFERENCES intel.financial_event_resolution(financial_event_resolution_id) ON DELETE RESTRICT,
    canonical_transaction_version_id uuid NOT NULL REFERENCES core.canonical_transaction_version(canonical_transaction_version_id) ON DELETE RESTRICT,
    taxonomy_version                 text NOT NULL,
    category_event_constraint_id     uuid REFERENCES ref.category_event_constraint(category_event_constraint_id),
    category_code                    text,
    subcategory_code                 text,
    category_status                  text NOT NULL,
    category_confidence              numeric(5,4),
    classification_scope             text NOT NULL DEFAULT 'TRANSACTION',
    reason_codes                     text[] NOT NULL DEFAULT '{}'::text[],
    evidence_references              jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_current                       boolean NOT NULL DEFAULT true,
    created_at                       timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_category_resolution_attempt UNIQUE (financial_event_resolution_id, taxonomy_version),
    CONSTRAINT ck_category_resolution_status CHECK (category_status IN (
        'RESOLVED', 'PROVISIONAL', 'AMBIGUOUS', 'UNKNOWN', 'NOT_APPLICABLE', 'INVALIDATED'
    )),
    CONSTRAINT ck_category_resolution_scope CHECK (classification_scope = 'TRANSACTION'),
    CONSTRAINT ck_category_resolution_confidence CHECK (
        category_confidence IS NULL OR (category_confidence >= 0 AND category_confidence <= 1)
    ),
    CONSTRAINT ck_category_resolution_evidence CHECK (jsonb_typeof(evidence_references) = 'array'),
    CONSTRAINT ck_category_resolution_shape CHECK (
        (
            category_status = 'RESOLVED'
            AND category_code IS NOT NULL
        )
        OR (
            category_status IN ('PROVISIONAL', 'AMBIGUOUS', 'UNKNOWN', 'NOT_APPLICABLE', 'INVALIDATED')
            AND category_code IS NULL
            AND subcategory_code IS NULL
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_category_resolution_current
    ON intel.category_resolution (logical_transaction_id)
    WHERE is_current;

CREATE TABLE IF NOT EXISTS intel.purpose_resolution (
    purpose_resolution_id            uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    logical_transaction_id           uuid NOT NULL REFERENCES core.logical_transaction(logical_transaction_id) ON DELETE RESTRICT,
    financial_event_resolution_id    uuid NOT NULL REFERENCES intel.financial_event_resolution(financial_event_resolution_id) ON DELETE RESTRICT,
    canonical_transaction_version_id uuid NOT NULL REFERENCES core.canonical_transaction_version(canonical_transaction_version_id) ON DELETE RESTRICT,
    taxonomy_version                 text NOT NULL,
    category_event_constraint_id     uuid REFERENCES ref.category_event_constraint(category_event_constraint_id),
    purpose_code                     text,
    purpose_status                   text NOT NULL,
    purpose_confidence               numeric(5,4),
    purpose_source                   text NOT NULL,
    classification_scope             text NOT NULL DEFAULT 'TRANSACTION',
    reason_codes                     text[] NOT NULL DEFAULT '{}'::text[],
    evidence_references              jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_current                       boolean NOT NULL DEFAULT true,
    created_at                       timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_purpose_resolution_attempt UNIQUE (financial_event_resolution_id, taxonomy_version),
    CONSTRAINT ck_purpose_resolution_status CHECK (purpose_status IN (
        'RESOLVED', 'PROVISIONAL', 'AMBIGUOUS', 'UNKNOWN', 'NOT_APPLICABLE', 'INVALIDATED'
    )),
    CONSTRAINT ck_purpose_resolution_source CHECK (purpose_source IN (
        'STRUCTURED_SOURCE', 'USER_DECLARED', 'MERCHANT_CONTEXT', 'RULE', 'MODEL', 'REVIEWER', 'INFERRED_CONTEXT'
    )),
    CONSTRAINT ck_purpose_resolution_scope CHECK (classification_scope = 'TRANSACTION'),
    CONSTRAINT ck_purpose_resolution_confidence CHECK (
        purpose_confidence IS NULL OR (purpose_confidence >= 0 AND purpose_confidence <= 1)
    ),
    CONSTRAINT ck_purpose_resolution_evidence CHECK (jsonb_typeof(evidence_references) = 'array'),
    CONSTRAINT ck_purpose_resolution_shape CHECK (
        (
            purpose_status = 'RESOLVED'
            AND purpose_code IS NOT NULL
        )
        OR (
            purpose_status IN ('PROVISIONAL', 'AMBIGUOUS', 'UNKNOWN', 'NOT_APPLICABLE', 'INVALIDATED')
            AND purpose_code IS NULL
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purpose_resolution_current
    ON intel.purpose_resolution (logical_transaction_id)
    WHERE is_current;

COMMENT ON TABLE intel.category_resolution IS
'F10E category attempt for one F10D resolution and one taxonomy version. Does not change the event or the canonical amount.';
COMMENT ON TABLE intel.purpose_resolution IS
'F10E purpose attempt. Independent of the category row. A null purpose code with status UNKNOWN is not the purpose node UNKNOWN.';

ALTER TABLE intel.category_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.category_resolution FORCE ROW LEVEL SECURITY;
ALTER TABLE intel.purpose_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.purpose_resolution FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_category_resolution_owner_read ON intel.category_resolution;
CREATE POLICY pol_category_resolution_owner_read
ON intel.category_resolution
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM core.logical_transaction lt
        JOIN core.account_ownership ao ON ao.financial_account_id = lt.financial_account_id
        WHERE lt.logical_transaction_id = category_resolution.logical_transaction_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

DROP POLICY IF EXISTS pol_purpose_resolution_owner_read ON intel.purpose_resolution;
CREATE POLICY pol_purpose_resolution_owner_read
ON intel.purpose_resolution
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM core.logical_transaction lt
        JOIN core.account_ownership ao ON ao.financial_account_id = lt.financial_account_id
        WHERE lt.logical_transaction_id = purpose_resolution.logical_transaction_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

CREATE OR REPLACE FUNCTION ops.resolve_financial_use(
    p_actor uuid,
    p_owner uuid,
    p_logical uuid,
    p_taxonomy_version text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ref, intel, core, ops, pg_temp
AS $use$
DECLARE
    v_default constant text := 'F10E-v1.2';
    v_version text;
    v_owner_type text;
    v_account uuid;
    v_event uuid;
    v_canonical uuid;
    v_event_outcome text;
    v_family text;
    v_evidence jsonb;
    v_constraint uuid;
    v_category_behavior text;
    v_purpose_behavior text;
    v_category_status text;
    v_purpose_status text;
    v_category_reasons text[];
    v_purpose_reasons text[];
    v_existing_category uuid;
    v_existing_purpose uuid;
    v_existing_category_status text;
    v_existing_purpose_status text;
    v_existing_current boolean;
BEGIN
    IF p_actor IS NULL OR p_owner IS NULL OR p_logical IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    SELECT owner_type INTO v_owner_type FROM core.owner WHERE owner_id = p_owner;
    IF v_owner_type IS NULL THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF v_owner_type <> 'PERSON' THEN
        RETURN jsonb_build_object('outcome', 'business_isolated');
    END IF;
    SELECT financial_account_id INTO v_account
      FROM core.logical_transaction
     WHERE logical_transaction_id = p_logical;
    IF v_account IS NULL THEN
        RETURN jsonb_build_object('outcome', 'ineligible');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM core.account_ownership
         WHERE owner_id = p_owner
           AND financial_account_id = v_account
           AND relationship_status = 'ACTIVE'
           AND effective_to IS NULL
    ) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    v_version := COALESCE(NULLIF(btrim(COALESCE(p_taxonomy_version, '')), ''), v_default);
    IF NOT EXISTS (SELECT 1 FROM ref.taxonomy_version WHERE taxonomy_version = v_version AND status = 'ACTIVE') THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('monytix-financial-use:' || p_logical::text, 0));

    SELECT financial_event_resolution_id, canonical_transaction_version_id,
           resolution_outcome, event_family, evidence_references
      INTO v_event, v_canonical, v_event_outcome, v_family, v_evidence
      FROM intel.financial_event_resolution
     WHERE logical_transaction_id = p_logical
       AND is_current = true;
    IF v_event IS NULL THEN
        RETURN jsonb_build_object('outcome', 'ineligible');
    END IF;

    SELECT category_resolution_id, category_status, is_current
      INTO v_existing_category, v_existing_category_status, v_existing_current
      FROM intel.category_resolution
     WHERE financial_event_resolution_id = v_event
       AND taxonomy_version = v_version
     FOR UPDATE;
    SELECT purpose_resolution_id, purpose_status
      INTO v_existing_purpose, v_existing_purpose_status
      FROM intel.purpose_resolution
     WHERE financial_event_resolution_id = v_event
       AND taxonomy_version = v_version
     FOR UPDATE;
    IF v_existing_category IS NOT NULL AND v_existing_purpose IS NOT NULL THEN
        RETURN jsonb_build_object(
            'outcome', 'replay',
            'category_status', v_existing_category_status,
            'purpose_status', v_existing_purpose_status,
            'taxonomy_version', v_version,
            'financial_event_resolution_id', v_event,
            'logical_transaction_id', p_logical,
            'is_current', v_existing_current
        );
    END IF;

    IF v_event_outcome IN ('UNKNOWN', 'AMBIGUOUS') THEN
        SELECT category_event_constraint_id, category_behavior, purpose_behavior
          INTO v_constraint, v_category_behavior, v_purpose_behavior
          FROM ref.category_event_constraint
         WHERE taxonomy_version = v_version
           AND event_outcome = v_event_outcome
           AND event_family IS NULL;
    ELSE
        SELECT category_event_constraint_id, category_behavior, purpose_behavior
          INTO v_constraint, v_category_behavior, v_purpose_behavior
          FROM ref.category_event_constraint
         WHERE taxonomy_version = v_version
           AND event_outcome = 'RESOLVED'
           AND event_family = v_family;
    END IF;
    IF v_constraint IS NULL THEN
        v_category_behavior := 'DO_NOT_FORCE';
        v_purpose_behavior := 'DO_NOT_FORCE';
    END IF;

    v_category_status := CASE v_category_behavior
        WHEN 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'
        ELSE 'UNKNOWN'
    END;
    v_category_reasons := CASE v_category_behavior
        WHEN 'NOT_APPLICABLE' THEN ARRAY['CATEGORY_NOT_APPLICABLE']
        ELSE ARRAY['NO_CATEGORY_CANDIDATE']
    END;
    v_purpose_status := CASE v_purpose_behavior
        WHEN 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'
        ELSE 'UNKNOWN'
    END;
    v_purpose_reasons := CASE v_purpose_behavior
        WHEN 'NOT_APPLICABLE' THEN ARRAY['CATEGORY_NOT_APPLICABLE']
        WHEN 'UNKNOWN_WITHOUT_EVIDENCE' THEN ARRAY['PURPOSE_NOT_EVIDENCED']
        ELSE ARRAY['PURPOSE_NOT_EVIDENCED']
    END;

    UPDATE intel.category_resolution
       SET is_current = false
     WHERE logical_transaction_id = p_logical
       AND is_current = true;
    UPDATE intel.purpose_resolution
       SET is_current = false
     WHERE logical_transaction_id = p_logical
       AND is_current = true;

    INSERT INTO intel.category_resolution (
        logical_transaction_id, financial_event_resolution_id, canonical_transaction_version_id,
        taxonomy_version, category_event_constraint_id, category_code, subcategory_code,
        category_status, category_confidence, classification_scope, reason_codes, evidence_references, is_current
    ) VALUES (
        p_logical, v_event, v_canonical,
        v_version, v_constraint, NULL, NULL,
        v_category_status, NULL, 'TRANSACTION', v_category_reasons, COALESCE(v_evidence, '[]'::jsonb), true
    ) RETURNING category_resolution_id INTO v_existing_category;

    INSERT INTO intel.purpose_resolution (
        logical_transaction_id, financial_event_resolution_id, canonical_transaction_version_id,
        taxonomy_version, category_event_constraint_id, purpose_code, purpose_status,
        purpose_confidence, purpose_source, classification_scope, reason_codes, evidence_references, is_current
    ) VALUES (
        p_logical, v_event, v_canonical,
        v_version, v_constraint, NULL, v_purpose_status,
        NULL, 'RULE', 'TRANSACTION', v_purpose_reasons, COALESCE(v_evidence, '[]'::jsonb), true
    ) RETURNING purpose_resolution_id INTO v_existing_purpose;

    INSERT INTO ops.outbox_event (
        owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
    ) VALUES (
        p_owner, 'CATEGORY_RESOLUTION_AVAILABLE', 'logical_transaction', p_logical,
        jsonb_build_object(
            'logical_transaction_id', p_logical,
            'financial_event_resolution_id', v_event,
            'category_resolution_id', v_existing_category,
            'taxonomy_version', v_version,
            'category_status', v_category_status
        ),
        'category-resolve:' || p_logical::text || ':' || v_event::text || ':' || v_version
    );
    INSERT INTO ops.outbox_event (
        owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
    ) VALUES (
        p_owner, 'PURPOSE_RESOLUTION_AVAILABLE', 'logical_transaction', p_logical,
        jsonb_build_object(
            'logical_transaction_id', p_logical,
            'financial_event_resolution_id', v_event,
            'purpose_resolution_id', v_existing_purpose,
            'taxonomy_version', v_version,
            'purpose_status', v_purpose_status
        ),
        'purpose-resolve:' || p_logical::text || ':' || v_event::text || ':' || v_version
    );

    RETURN jsonb_build_object(
        'outcome', 'created',
        'category_status', v_category_status,
        'purpose_status', v_purpose_status,
        'taxonomy_version', v_version,
        'financial_event_resolution_id', v_event,
        'category_resolution_id', v_existing_category,
        'purpose_resolution_id', v_existing_purpose,
        'logical_transaction_id', p_logical,
        'is_current', true
    );
END;
$use$;

COMMENT ON FUNCTION ops.resolve_financial_use(uuid, uuid, uuid, text) IS
'Writes one F10E category attempt and one purpose attempt from the current F10D resolution. Does not assign a spend category and does not change canonical money or the event family.';

CREATE OR REPLACE FUNCTION ops.resolve_extraction_run(p_run uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $batch$
DECLARE
    v_owner uuid;
    v_actor uuid;
    v_logical uuid;
    v_results jsonb := '[]'::jsonb;
    v_one jsonb;
BEGIN
    SELECT sd.owner_id, sd.uploaded_by_actor_id
      INTO v_owner, v_actor
      FROM core.extraction_run er
      JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
     WHERE er.extraction_run_id = p_run;
    IF v_owner IS NULL THEN
        RETURN jsonb_build_object('outcome', 'missing');
    END IF;
    IF v_actor IS NULL THEN
        RETURN jsonb_build_object('outcome', 'skipped');
    END IF;
    FOR v_logical IN
        SELECT DISTINCT d.logical_transaction_id
          FROM core.source_record_disposition d
          JOIN core.source_record sr ON sr.source_record_id = d.source_record_id
         WHERE sr.extraction_run_id = p_run
           AND d.logical_transaction_id IS NOT NULL
           AND d.outcome IN ('MAPPED', 'LINKED_EXISTING')
    LOOP
        v_one := ops.resolve_financial_use(v_actor, v_owner, v_logical, NULL);
        v_results := v_results || jsonb_build_array(v_one);
    END LOOP;
    RETURN jsonb_build_object('outcome', 'completed', 'results', v_results);
END;
$batch$;

REVOKE ALL ON FUNCTION ops.resolve_financial_use(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.resolve_extraction_run(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.resolve_financial_use(uuid, uuid, uuid, text) FROM monytix_intelligence;
REVOKE ALL ON FUNCTION ops.resolve_extraction_run(uuid) FROM monytix_intelligence;
GRANT EXECUTE ON FUNCTION ops.resolve_financial_use(uuid, uuid, uuid, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.resolve_extraction_run(uuid) TO monytix_api;

GRANT SELECT ON
    ref.taxonomy_version,
    ref.taxonomy_category,
    ref.taxonomy_subcategory,
    ref.taxonomy_purpose,
    ref.category_event_constraint,
    intel.category_resolution,
    intel.purpose_resolution
TO monytix_api;
REVOKE INSERT, UPDATE, DELETE ON
    ref.taxonomy_version,
    ref.taxonomy_category,
    ref.taxonomy_subcategory,
    ref.taxonomy_purpose,
    ref.category_event_constraint,
    intel.category_resolution,
    intel.purpose_resolution
FROM monytix_api;
REVOKE ALL ON intel.category_resolution, intel.purpose_resolution FROM monytix_intelligence;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M3-2-F10E-TAXONOMY',
    'F10E taxonomy eligibility',
    'F10E v1.2 FINAL FREEZE',
    'F10E-v1.2',
    'Event-constraint category and purpose attempts. No spend category is assigned. Merchant classification remains blocked on F10C.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
