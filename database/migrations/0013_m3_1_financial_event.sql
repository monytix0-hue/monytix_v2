-- M3.1 financial-event interpretation.
-- Reads the frozen F10D families from canonical rows and same-owner evidence.
-- Does not create a second ledger, assign a category, or expose a classify route.
-- Does not execute the legacy rulebook SQL engine.

BEGIN;

CREATE TABLE IF NOT EXISTS ref.financial_event_rule (
    financial_event_rule_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    rulebook_version        text NOT NULL,
    rule_code               text NOT NULL,
    clause_no               integer NOT NULL,
    precedence_band         text NOT NULL,
    event_family            text NOT NULL,
    direction_code          text,
    evidence_source         text NOT NULL,
    match_value             text NOT NULL,
    exclusion_regex         text,
    catalogue_note          text NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_financial_event_rule UNIQUE (rulebook_version, rule_code, clause_no),
    CONSTRAINT ck_financial_event_rule_version CHECK (btrim(rulebook_version) <> ''),
    CONSTRAINT ck_financial_event_rule_code CHECK (btrim(rule_code) <> ''),
    CONSTRAINT ck_financial_event_rule_clause CHECK (clause_no > 0),
    CONSTRAINT ck_financial_event_rule_band CHECK (precedence_band ~ '^P[0-9]$'),
    CONSTRAINT ck_financial_event_rule_direction CHECK (direction_code IS NULL OR direction_code IN ('IN', 'OUT')),
    CONSTRAINT ck_financial_event_rule_source CHECK (evidence_source IN (
        'description', 'parser_channel', 'parser_sub_type', 'parser_format', 'reversal_and_description'
    )),
    CONSTRAINT ck_financial_event_rule_family CHECK (event_family IN (
        'INCOME', 'BORROWING', 'LOAN_REPAYMENT', 'CREDIT_CARD_PAYMENT',
        'INVESTMENT', 'INVESTMENT_PROCEEDS', 'INVESTMENT_INCOME',
        'INSURANCE', 'INSURANCE_PAYOUT', 'TAX_GOVERNMENT',
        'INTERNAL_TRANSFER', 'PERSON_TRANSFER', 'MERCHANT_PURCHASE',
        'CASH_MOVEMENT', 'FEE_CHARGE', 'REFUND_REVERSAL', 'OTHER_FINANCIAL_EVENT'
    ))
);

COMMENT ON TABLE ref.financial_event_rule IS
'F10D v1.2 predicates copied from the rulebook catalogue. A rule matches when any clause matches. This is not the legacy SQL engine.';

INSERT INTO ref.financial_event_rule (
    rulebook_version, rule_code, clause_no, precedence_band, event_family,
    direction_code, evidence_source, match_value, exclusion_regex, catalogue_note
) VALUES
    (
        'F10D-v1.2', 'EMI_001', 1, 'P1', 'LOAN_REPAYMENT', 'OUT', 'parser_sub_type', 'EMI',
        'sip|mutual fund|insurance|premium',
        'F10D LOAN_REPAYMENT P1. Catalogue EMI_001. Parser v4 sub_type EMI. Catalogue word boundary is stored as PostgreSQL \y.'
    ),
    (
        'F10D-v1.2', 'EMI_001', 2, 'P1', 'LOAN_REPAYMENT', 'OUT', 'description',
        $re$\yemi\y$re$,
        'sip|mutual fund|insurance|premium',
        'F10D explicit EMI. Catalogue EMI_001 token, excluding sip, mutual fund, insurance, and premium.'
    ),
    (
        'F10D-v1.2', 'EMI_002', 1, 'P1', 'LOAN_REPAYMENT', 'OUT', 'description',
        $re$\m(loan repayment|loan payment|loan installment)\M$re$,
        'sip|mutual fund|insurance|premium',
        'F10D explicit loan repayment. Catalogue EMI_002 phrases. Loan disbursement is not this rule.'
    ),
    (
        'F10D-v1.2', 'CC_001', 1, 'P1', 'CREDIT_CARD_PAYMENT', 'OUT', 'parser_sub_type', 'CC_PAYMENT',
        $re$\yloan\y$re$,
        'F10D CREDIT_CARD_PAYMENT P1. Parser v4 sub_type CC_PAYMENT. Generic CRED and masked digits are not clauses.'
    ),
    (
        'F10D-v1.2', 'CC_001', 2, 'P1', 'CREDIT_CARD_PAYMENT', 'OUT', 'parser_channel', 'CARD_BILLPAY',
        $re$\yloan\y$re$,
        'F10D credit-card bill payment. Parser v4 channel CARD_BILLPAY.'
    ),
    (
        'F10D-v1.2', 'CC_001', 3, 'P1', 'CREDIT_CARD_PAYMENT', 'OUT', 'description',
        $re$\m(credit card|cc payment|card payment|cc bill)\M$re$,
        $re$\yloan\y$re$,
        'Catalogue CC_001 explicit credit-card phrases, excluding loan.'
    ),
    (
        'F10D-v1.2', 'INC_040', 1, 'P3', 'INCOME', 'IN', 'parser_sub_type', 'INTEREST_CREDIT',
        NULL,
        'F10D INCOME P3 when interest evidence is present. Parser v4 sub_type INTEREST_CREDIT. Salary keywords are not this rule.'
    ),
    (
        'F10D-v1.2', 'INC_040', 2, 'P3', 'INCOME', 'IN', 'description',
        $re$\m(interest credit|savings interest|fd interest|rd interest|sbint|int\.pd)\M$re$,
        NULL,
        'Catalogue INC_040 interest-credit phrases. A salary keyword does not match.'
    ),
    (
        'F10D-v1.2', 'CASH_001', 1, 'P4', 'CASH_MOVEMENT', 'OUT', 'parser_channel', 'ATM',
        NULL,
        'F10D CASH_MOVEMENT P4. Catalogue CASH_001 requires channel ATM. The word atm alone is not a clause.'
    ),
    (
        'F10D-v1.2', 'CASH_001', 2, 'P4', 'CASH_MOVEMENT', 'OUT', 'parser_format', 'ATM_WDL_DASH',
        NULL,
        'Parser v4 format ATM_WDL_DASH, the structural ATM withdrawal already stored on the source record.'
    ),
    (
        'F10D-v1.2', 'INC_050', 1, 'P0', 'REFUND_REVERSAL', 'IN', 'reversal_and_description',
        $re$\m(refund|reversal|chargeback)\M$re$,
        'cashback',
        'F10D REFUND_REVERSAL P0. Catalogue INC_050 narrowed to refund, reversal, or chargeback, and only when canonical reversal_indicator is true. Cashback is not a refund.'
    )
ON CONFLICT (rulebook_version, rule_code, clause_no) DO NOTHING;

DO $check$
DECLARE
    v_emi text;
    v_loan text;
    v_cc text;
BEGIN
    SELECT match_value INTO v_emi
      FROM ref.financial_event_rule
     WHERE rulebook_version = 'F10D-v1.2' AND rule_code = 'EMI_001' AND evidence_source = 'description';
    SELECT match_value INTO v_loan
      FROM ref.financial_event_rule
     WHERE rulebook_version = 'F10D-v1.2' AND rule_code = 'EMI_002' AND evidence_source = 'description';
    SELECT match_value INTO v_cc
      FROM ref.financial_event_rule
     WHERE rulebook_version = 'F10D-v1.2' AND rule_code = 'CC_001' AND evidence_source = 'description';
    IF v_emi IS NULL OR 'monthly EMI debit' !~* v_emi OR 'chemistry' ~* v_emi THEN
        RAISE EXCEPTION 'EMI description predicate is not the catalogue word boundary';
    END IF;
    IF v_loan IS NULL OR 'loan repayment' !~* v_loan OR 'loan disbursement' ~* v_loan THEN
        RAISE EXCEPTION 'loan repayment predicate must not match disbursement';
    END IF;
    IF v_cc IS NULL OR ('EMI credit card payment' !~* v_emi) OR ('EMI credit card payment' !~* v_cc) THEN
        RAISE EXCEPTION 'contradictory P1 fixture does not hit both seeded rules';
    END IF;
    IF EXISTS (
        SELECT 1 FROM ref.financial_event_rule
         WHERE rule_code IN ('TRF_999', 'INC_999', 'TRF_001')
            OR event_family = 'EXPENSE'
    ) THEN
        RAISE EXCEPTION 'catch-all transfer rules and EXPENSE are not part of this rulebook';
    END IF;
END;
$check$;

CREATE TABLE IF NOT EXISTS intel.financial_event_resolution (
    financial_event_resolution_id    uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    logical_transaction_id           uuid NOT NULL REFERENCES core.logical_transaction(logical_transaction_id) ON DELETE RESTRICT,
    canonical_transaction_version_id uuid NOT NULL REFERENCES core.canonical_transaction_version(canonical_transaction_version_id) ON DELETE RESTRICT,
    rulebook_version                 text NOT NULL,
    matched_rule_code                text,
    precedence_band                  text,
    resolution_outcome               text NOT NULL,
    event_family                     text,
    evidence_references              jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_current                       boolean NOT NULL DEFAULT true,
    interpreted_at                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_financial_event_resolution_version UNIQUE (
        logical_transaction_id, canonical_transaction_version_id, rulebook_version
    ),
    CONSTRAINT ck_financial_event_resolution_version CHECK (btrim(rulebook_version) <> ''),
    CONSTRAINT ck_financial_event_resolution_outcome CHECK (resolution_outcome IN ('RESOLVED', 'UNKNOWN', 'AMBIGUOUS')),
    CONSTRAINT ck_financial_event_resolution_band CHECK (precedence_band IS NULL OR precedence_band ~ '^P[0-9]$'),
    CONSTRAINT ck_financial_event_resolution_evidence CHECK (jsonb_typeof(evidence_references) = 'array'),
    CONSTRAINT ck_financial_event_resolution_family CHECK (
        event_family IS NULL OR event_family IN (
            'INCOME', 'BORROWING', 'LOAN_REPAYMENT', 'CREDIT_CARD_PAYMENT',
            'INVESTMENT', 'INVESTMENT_PROCEEDS', 'INVESTMENT_INCOME',
            'INSURANCE', 'INSURANCE_PAYOUT', 'TAX_GOVERNMENT',
            'INTERNAL_TRANSFER', 'PERSON_TRANSFER', 'MERCHANT_PURCHASE',
            'CASH_MOVEMENT', 'FEE_CHARGE', 'REFUND_REVERSAL', 'OTHER_FINANCIAL_EVENT'
        )
    ),
    CONSTRAINT ck_financial_event_resolution_shape CHECK (
        (
            resolution_outcome = 'RESOLVED'
            AND event_family IS NOT NULL
            AND matched_rule_code IS NOT NULL
            AND precedence_band IS NOT NULL
        )
        OR (
            resolution_outcome = 'AMBIGUOUS'
            AND event_family IS NULL
            AND matched_rule_code IS NULL
            AND precedence_band IS NOT NULL
        )
        OR (
            resolution_outcome = 'UNKNOWN'
            AND event_family IS NULL
            AND matched_rule_code IS NULL
            AND precedence_band IS NULL
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_event_resolution_current
    ON intel.financial_event_resolution (logical_transaction_id)
    WHERE is_current;

COMMENT ON TABLE intel.financial_event_resolution IS
'Versioned F10D interpretation of one canonical transaction. A new rulebook version inserts a row. Canonical money columns stay unchanged.';

ALTER TABLE intel.financial_event_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.financial_event_resolution FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_financial_event_resolution_owner_read ON intel.financial_event_resolution;
CREATE POLICY pol_financial_event_resolution_owner_read
ON intel.financial_event_resolution
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM core.logical_transaction lt
        JOIN core.account_ownership ao ON ao.financial_account_id = lt.financial_account_id
        WHERE lt.logical_transaction_id = financial_event_resolution.logical_transaction_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

CREATE OR REPLACE FUNCTION ops.interpret_financial_event(
    p_actor uuid,
    p_owner uuid,
    p_logical uuid,
    p_rulebook_version text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ref, intel, core, ops, pg_temp
AS $fe$
DECLARE
    v_rulebook constant text := 'F10D-v1.2';
    v_version text;
    v_owner_type text;
    v_account uuid;
    v_canonical uuid;
    v_direction text;
    v_reversal boolean;
    v_description text;
    v_existing uuid;
    v_existing_outcome text;
    v_existing_family text;
    v_existing_rule text;
    v_existing_current boolean;
    v_src record;
    v_rule record;
    v_descriptions text[] := ARRAY[]::text[];
    v_channels text[] := ARRAY[]::text[];
    v_subtypes text[] := ARRAY[]::text[];
    v_formats text[] := ARRAY[]::text[];
    v_evidence uuid[] := ARRAY[]::uuid[];
    v_codes text[] := ARRAY[]::text[];
    v_bands text[] := ARRAY[]::text[];
    v_families text[] := ARRAY[]::text[];
    v_seen text[] := ARRAY[]::text[];
    v_hit boolean;
    v_best text;
    v_i integer;
    v_outcome text;
    v_family text;
    v_rule_code text;
    v_band text;
    v_evidence_json jsonb;
    v_resolution uuid;
BEGIN
    IF p_actor IS NULL OR p_owner IS NULL OR p_logical IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT owner_type INTO v_owner_type
      FROM core.owner
     WHERE owner_id = p_owner;
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
        SELECT 1
          FROM core.account_ownership
         WHERE owner_id = p_owner
           AND financial_account_id = v_account
           AND relationship_status = 'ACTIVE'
           AND effective_to IS NULL
    ) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    v_version := COALESCE(NULLIF(btrim(COALESCE(p_rulebook_version, '')), ''), v_rulebook);
    IF NOT EXISTS (
        SELECT 1 FROM ref.financial_event_rule WHERE rulebook_version = v_version
    ) THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('monytix-financial-event:' || p_logical::text, 0));

    SELECT cv.canonical_transaction_version_id, cv.direction, cv.reversal_indicator, cv.raw_description
      INTO v_canonical, v_direction, v_reversal, v_description
      FROM core.logical_transaction lt
      JOIN core.canonical_transaction_version cv
        ON cv.canonical_transaction_version_id = lt.current_canonical_version_id
       AND cv.logical_transaction_id = lt.logical_transaction_id
     WHERE lt.logical_transaction_id = p_logical
       AND cv.is_current = true
       AND cv.normalization_status = 'READY';
    IF v_canonical IS NULL THEN
        RETURN jsonb_build_object('outcome', 'ineligible');
    END IF;

    SELECT financial_event_resolution_id, resolution_outcome, event_family, matched_rule_code, is_current
      INTO v_existing, v_existing_outcome, v_existing_family, v_existing_rule, v_existing_current
      FROM intel.financial_event_resolution
     WHERE logical_transaction_id = p_logical
       AND canonical_transaction_version_id = v_canonical
       AND rulebook_version = v_version
     FOR UPDATE;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object(
            'outcome', 'replay',
            'resolution_outcome', v_existing_outcome,
            'event_family', v_existing_family,
            'matched_rule_code', v_existing_rule,
            'rulebook_version', v_version,
            'logical_transaction_id', p_logical,
            'canonical_transaction_version_id', v_canonical,
            'financial_event_resolution_id', v_existing,
            'is_current', v_existing_current
        );
    END IF;

    IF v_description IS NOT NULL AND btrim(v_description) <> '' THEN
        v_descriptions := array_append(v_descriptions, v_description);
    END IF;

    FOR v_src IN
        SELECT DISTINCT sr.source_record_id, sr.raw_description, sr.raw_record_payload
          FROM core.transaction_evidence_link tel
          JOIN core.source_record sr ON sr.source_record_id = tel.source_record_id
          JOIN core.extraction_run er ON er.extraction_run_id = sr.extraction_run_id
          JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
         WHERE tel.logical_transaction_id = p_logical
           AND tel.source_record_id IS NOT NULL
           AND sd.owner_id = p_owner
    LOOP
        v_evidence := array_append(v_evidence, v_src.source_record_id);
        IF v_src.raw_description IS NOT NULL AND btrim(v_src.raw_description) <> '' THEN
            v_descriptions := array_append(v_descriptions, v_src.raw_description);
        END IF;
        IF NULLIF(btrim(COALESCE(v_src.raw_record_payload->>'channel_type', '')), '') IS NOT NULL THEN
            v_channels := array_append(v_channels, v_src.raw_record_payload->>'channel_type');
        END IF;
        IF NULLIF(btrim(COALESCE(v_src.raw_record_payload->>'sub_type', '')), '') IS NOT NULL THEN
            v_subtypes := array_append(v_subtypes, v_src.raw_record_payload->>'sub_type');
        END IF;
        IF NULLIF(btrim(COALESCE(v_src.raw_record_payload->>'parse_format', '')), '') IS NOT NULL THEN
            v_formats := array_append(v_formats, v_src.raw_record_payload->>'parse_format');
        END IF;
    END LOOP;

    FOR v_rule IN
        SELECT rule_code, precedence_band, event_family, direction_code,
               evidence_source, match_value, exclusion_regex
          FROM ref.financial_event_rule
         WHERE rulebook_version = v_version
         ORDER BY precedence_band, rule_code, clause_no
    LOOP
        IF v_rule.direction_code IS NOT NULL AND v_rule.direction_code IS DISTINCT FROM v_direction THEN
            CONTINUE;
        END IF;
        IF v_rule.exclusion_regex IS NOT NULL AND EXISTS (
            SELECT 1 FROM unnest(v_descriptions) AS d(txt) WHERE txt ~* v_rule.exclusion_regex
        ) THEN
            CONTINUE;
        END IF;
        v_hit := false;
        IF v_rule.evidence_source = 'description' THEN
            v_hit := EXISTS (
                SELECT 1 FROM unnest(v_descriptions) AS d(txt) WHERE txt ~* v_rule.match_value
            );
        ELSIF v_rule.evidence_source = 'parser_channel' THEN
            v_hit := v_rule.match_value = ANY (v_channels);
        ELSIF v_rule.evidence_source = 'parser_sub_type' THEN
            v_hit := v_rule.match_value = ANY (v_subtypes);
        ELSIF v_rule.evidence_source = 'parser_format' THEN
            v_hit := v_rule.match_value = ANY (v_formats);
        ELSIF v_rule.evidence_source = 'reversal_and_description' THEN
            v_hit := v_reversal AND EXISTS (
                SELECT 1 FROM unnest(v_descriptions) AS d(txt) WHERE txt ~* v_rule.match_value
            );
        END IF;
        IF v_hit AND NOT (v_rule.rule_code = ANY (v_codes)) THEN
            v_codes := array_append(v_codes, v_rule.rule_code);
            v_bands := array_append(v_bands, v_rule.precedence_band);
            v_families := array_append(v_families, v_rule.event_family);
        END IF;
    END LOOP;

    v_family := NULL;
    v_rule_code := NULL;
    v_band := NULL;
    IF COALESCE(cardinality(v_codes), 0) = 0 THEN
        v_outcome := 'UNKNOWN';
    ELSE
        v_best := v_bands[1];
        FOR v_i IN 1..cardinality(v_bands) LOOP
            IF v_bands[v_i] < v_best THEN
                v_best := v_bands[v_i];
            END IF;
        END LOOP;
        FOR v_i IN 1..cardinality(v_codes) LOOP
            IF v_bands[v_i] = v_best THEN
                IF NOT (v_families[v_i] = ANY (v_seen)) THEN
                    v_seen := array_append(v_seen, v_families[v_i]);
                END IF;
                IF v_rule_code IS NULL OR v_codes[v_i] < v_rule_code THEN
                    v_rule_code := v_codes[v_i];
                    v_family := v_families[v_i];
                END IF;
            END IF;
        END LOOP;
        v_band := v_best;
        IF cardinality(v_seen) > 1 THEN
            v_outcome := 'AMBIGUOUS';
            v_family := NULL;
            v_rule_code := NULL;
        ELSE
            v_outcome := 'RESOLVED';
        END IF;
    END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(eid) ORDER BY eid), '[]'::jsonb)
      INTO v_evidence_json
      FROM (SELECT DISTINCT x AS eid FROM unnest(v_evidence) AS u(x)) s;

    UPDATE intel.financial_event_resolution
       SET is_current = false
     WHERE logical_transaction_id = p_logical
       AND is_current = true;

    INSERT INTO intel.financial_event_resolution (
        logical_transaction_id, canonical_transaction_version_id, rulebook_version,
        matched_rule_code, precedence_band, resolution_outcome, event_family,
        evidence_references, is_current
    ) VALUES (
        p_logical, v_canonical, v_version,
        v_rule_code, v_band, v_outcome, v_family,
        v_evidence_json, true
    ) RETURNING financial_event_resolution_id INTO v_resolution;

    INSERT INTO ops.outbox_event (
        owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
    ) VALUES (
        p_owner,
        'FINANCIAL_EVENT_INTERPRETED',
        'logical_transaction',
        p_logical,
        jsonb_build_object(
            'logical_transaction_id', p_logical,
            'canonical_transaction_version_id', v_canonical,
            'rulebook_version', v_version,
            'outcome', v_outcome,
            'event_family', v_family,
            'matched_rule_code', v_rule_code
        ),
        'interpret:' || p_logical::text || ':' || v_canonical::text || ':' || v_version
    );

    RETURN jsonb_build_object(
        'outcome', 'created',
        'resolution_outcome', v_outcome,
        'event_family', v_family,
        'matched_rule_code', v_rule_code,
        'rulebook_version', v_version,
        'logical_transaction_id', p_logical,
        'canonical_transaction_version_id', v_canonical,
        'financial_event_resolution_id', v_resolution,
        'is_current', true
    );
END;
$fe$;

COMMENT ON FUNCTION ops.interpret_financial_event(uuid, uuid, uuid, text) IS
'Writes one F10D interpretation for the current canonical version. Personal owners only. Same canonical version and rulebook version replay. Does not change canonical amount, date, direction, currency, or account.';

CREATE OR REPLACE FUNCTION ops.interpret_extraction_run(p_run uuid) RETURNS jsonb
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
        v_one := ops.interpret_financial_event(v_actor, v_owner, v_logical, NULL);
        v_results := v_results || jsonb_build_array(v_one);
    END LOOP;
    RETURN jsonb_build_object('outcome', 'completed', 'results', v_results);
END;
$batch$;

REVOKE ALL ON FUNCTION ops.interpret_financial_event(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.interpret_extraction_run(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.interpret_financial_event(uuid, uuid, uuid, text) FROM monytix_intelligence;
REVOKE ALL ON FUNCTION ops.interpret_extraction_run(uuid) FROM monytix_intelligence;
GRANT EXECUTE ON FUNCTION ops.interpret_financial_event(uuid, uuid, uuid, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.interpret_extraction_run(uuid) TO monytix_api;

GRANT USAGE ON SCHEMA intel TO monytix_api;
GRANT SELECT ON intel.financial_event_resolution TO monytix_api;
GRANT SELECT ON ref.financial_event_rule TO monytix_api;
REVOKE INSERT, UPDATE, DELETE ON intel.financial_event_resolution FROM monytix_api;
REVOKE INSERT, UPDATE, DELETE ON ref.financial_event_rule FROM monytix_api;
REVOKE ALL ON intel.financial_event_resolution FROM monytix_intelligence;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M3-1-FINANCIAL-EVENT',
    'Financial event rulebook interpretation',
    'F10D v1.2 FINAL FREEZE',
    'F10D-v1.2',
    'Versioned personal-event interpretation of the current canonical row. No second ledger and no public classify route.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
