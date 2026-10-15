-- M3.6 F10B structural evidence.
-- Publishes a versioned rail and typed tokens for one canonical version.
-- Does not resolve an entity, assign SELF, or assign a financial event or spend category.
-- Does not edit migrations 0001-0015.

BEGIN;

CREATE TABLE IF NOT EXISTS ref.structure_policy (
    structure_policy_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    f10b_version        text NOT NULL,
    status              text NOT NULL DEFAULT 'ACTIVE',
    created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_structure_policy UNIQUE (f10b_version),
    CONSTRAINT ck_structure_policy_version CHECK (btrim(f10b_version) <> ''),
    CONSTRAINT ck_structure_policy_status CHECK (status IN ('ACTIVE', 'RETIRED'))
);

INSERT INTO ref.structure_policy (f10b_version)
VALUES ('F10B-v2.0')
ON CONFLICT (f10b_version) DO NOTHING;

CREATE TABLE IF NOT EXISTS intel.transaction_structure (
    transaction_structure_id         uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    logical_transaction_id           uuid NOT NULL REFERENCES core.logical_transaction(logical_transaction_id) ON DELETE RESTRICT,
    canonical_transaction_version_id uuid NOT NULL REFERENCES core.canonical_transaction_version(canonical_transaction_version_id) ON DELETE RESTRICT,
    f10b_version                     text NOT NULL,
    parser_version                   text NOT NULL,
    registry_version                 text NOT NULL,
    payment_rail                     text NOT NULL,
    funding_instrument_type          text NOT NULL,
    initiation_mechanism             text NOT NULL,
    format_name                      text,
    structural_subtype               text,
    parse_status                     text NOT NULL,
    rail_confidence                  numeric(5,4),
    parse_confidence                 numeric(5,4),
    direction_consistency            text NOT NULL,
    observed_type_markers            text[] NOT NULL DEFAULT '{}'::text[],
    reason_codes                     text[] NOT NULL,
    is_current                       boolean NOT NULL DEFAULT true,
    parsed_at                        timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_transaction_structure_attempt UNIQUE (
        logical_transaction_id, canonical_transaction_version_id, f10b_version
    ),
    CONSTRAINT ck_transaction_structure_rail CHECK (payment_rail IN (
        'UPI', 'IMPS', 'NEFT', 'RTGS', 'ACH', 'NACH', 'CARD_NETWORK', 'CHEQUE',
        'WIRE', 'CASH', 'INTERNAL', 'BILLPAY', 'WALLET', 'OTHER', 'UNKNOWN'
    )),
    CONSTRAINT ck_transaction_structure_funding CHECK (funding_instrument_type IN (
        'BANK_ACCOUNT', 'DEBIT_CARD', 'CREDIT_CARD', 'WALLET_PPI', 'CREDIT_LINE',
        'VOUCHER', 'CASH', 'UNKNOWN'
    )),
    CONSTRAINT ck_transaction_structure_initiation CHECK (initiation_mechanism IN (
        'MANUAL', 'STANDING_INSTRUCTION', 'AUTO_SWEEP', 'MANDATE', 'SCHEDULED',
        'VOUCHER_REDEMPTION', 'PROVIDER_INITIATED', 'UNKNOWN'
    )),
    CONSTRAINT ck_transaction_structure_status CHECK (parse_status IN (
        'PARSED', 'PARTIAL', 'UNPARSED', 'CONFLICT', 'NOT_APPLICABLE'
    )),
    CONSTRAINT ck_transaction_structure_direction CHECK (direction_consistency IN (
        'CONSISTENT', 'SOURCE_MARKER_ABSENT', 'CONFLICT'
    )),
    CONSTRAINT ck_transaction_structure_confidence CHECK (
        (rail_confidence IS NULL OR (rail_confidence >= 0 AND rail_confidence <= 1))
        AND (parse_confidence IS NULL OR (parse_confidence >= 0 AND parse_confidence <= 1))
    ),
    CONSTRAINT ck_transaction_structure_slice CHECK (
        parse_status IN ('PARTIAL', 'UNPARSED', 'CONFLICT')
        AND funding_instrument_type = 'UNKNOWN'
        AND initiation_mechanism = 'UNKNOWN'
        AND rail_confidence IS NULL
        AND parse_confidence IS NULL
        AND (structural_subtype IS NULL OR structural_subtype IN (
            'CASH_MACHINE_WITHDRAWAL', 'BRANCH_CASH', 'POS', 'BILLPAY_GENERIC',
            'BILLDESK', 'CHEQUE_GENERIC'
        ))
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_structure_current
    ON intel.transaction_structure (logical_transaction_id)
    WHERE is_current;

COMMENT ON TABLE intel.transaction_structure IS
'F10B structural attempt. Parser v4 is a candidate extractor. PARSED is withheld until a versioned field threshold exists. Confidence is not copied from the parser.';

CREATE TABLE IF NOT EXISTS intel.transaction_identifier (
    transaction_identifier_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    transaction_structure_id  uuid NOT NULL REFERENCES intel.transaction_structure(transaction_structure_id) ON DELETE RESTRICT,
    identifier_type           text NOT NULL,
    identifier_role           text NOT NULL,
    raw_value                 text NOT NULL,
    normalized_value          text NOT NULL,
    field_name                text NOT NULL,
    extraction_method         text NOT NULL,
    confidence                numeric(5,4),
    ambiguity_status          text NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_transaction_identifier_type CHECK (identifier_type IN (
        'VPA', 'UPI_RRN', 'IFSC', 'ACCOUNT_TOKEN', 'COUNTERPARTY_LABEL_RAW'
    )),
    CONSTRAINT ck_transaction_identifier_role CHECK (identifier_role IN (
        'UNKNOWN_VPA', 'UNKNOWN_REFERENCE_ROLE', 'COUNTERPARTY_ACCOUNT'
    )),
    CONSTRAINT ck_transaction_identifier_method CHECK (extraction_method = 'PARSER_V4_FIELD'),
    CONSTRAINT ck_transaction_identifier_confidence CHECK (
        confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
    ),
    CONSTRAINT ck_transaction_identifier_ambiguity CHECK (ambiguity_status = 'CANDIDATE')
);

COMMENT ON TABLE intel.transaction_identifier IS
'Typed structural token. A VPA role is not a person, merchant, or SELF. An account token is not ownership.';

ALTER TABLE intel.transaction_structure ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.transaction_structure FORCE ROW LEVEL SECURITY;
ALTER TABLE intel.transaction_identifier ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.transaction_identifier FORCE ROW LEVEL SECURITY;

CREATE POLICY pol_transaction_structure_owner_read
ON intel.transaction_structure
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM core.logical_transaction lt
        JOIN core.account_ownership ao ON ao.financial_account_id = lt.financial_account_id
        WHERE lt.logical_transaction_id = transaction_structure.logical_transaction_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

CREATE POLICY pol_transaction_identifier_owner_read
ON intel.transaction_identifier
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM intel.transaction_structure ts
        JOIN core.logical_transaction lt ON lt.logical_transaction_id = ts.logical_transaction_id
        JOIN core.account_ownership ao ON ao.financial_account_id = lt.financial_account_id
        WHERE ts.transaction_structure_id = transaction_identifier.transaction_structure_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

CREATE OR REPLACE FUNCTION ops.publish_transaction_structure(
    p_actor uuid,
    p_owner uuid,
    p_logical uuid,
    p_f10b_version text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ref, intel, core, ops, spendsense, pg_temp
AS $structure$
DECLARE
    v_default constant text := 'F10B-v2.0';
    v_version text;
    v_registry constant text := 'parser-v4-candidate';
    v_owner_type text;
    v_account uuid;
    v_canonical uuid;
    v_direction text;
    v_description text;
    v_existing uuid;
    v_existing_status text;
    v_existing_rail text;
    v_existing_current boolean;
    v_parsed jsonb;
    v_channel text;
    v_format text;
    v_parser_direction text;
    v_rail text;
    v_subtype text;
    v_status text;
    v_consistency text;
    v_markers text[] := ARRAY[]::text[];
    v_reasons text[] := ARRAY[]::text[];
    v_reason text;
    v_structure uuid;
    v_raw text;
    v_normalized text;
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

    v_version := COALESCE(NULLIF(btrim(COALESCE(p_f10b_version, '')), ''), v_default);
    IF NOT EXISTS (
        SELECT 1 FROM ref.structure_policy
         WHERE f10b_version = v_version AND status = 'ACTIVE'
    ) THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('monytix-structure:' || p_logical::text, 0));

    SELECT cv.canonical_transaction_version_id, cv.direction, cv.raw_description
      INTO v_canonical, v_direction, v_description
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

    SELECT transaction_structure_id, parse_status, payment_rail, is_current
      INTO v_existing, v_existing_status, v_existing_rail, v_existing_current
      FROM intel.transaction_structure
     WHERE logical_transaction_id = p_logical
       AND canonical_transaction_version_id = v_canonical
       AND f10b_version = v_version
     FOR UPDATE;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object(
            'outcome', 'replay',
            'parse_status', v_existing_status,
            'payment_rail', v_existing_rail,
            'f10b_version', v_version,
            'logical_transaction_id', p_logical,
            'canonical_transaction_version_id', v_canonical,
            'transaction_structure_id', v_existing,
            'is_current', v_existing_current
        );
    END IF;

    v_rail := 'UNKNOWN';
    v_subtype := NULL;
    v_status := 'UNPARSED';
    v_consistency := 'SOURCE_MARKER_ABSENT';
    v_reasons := ARRAY['NO_RAIL_MATCH'];
    v_parsed := NULL;

    IF NULLIF(btrim(COALESCE(v_description, '')), '') IS NOT NULL THEN
        v_parsed := spendsense.parse_narration_v4(v_description, v_direction);
        v_channel := COALESCE(v_parsed->>'channel_type', 'OTHER');
        v_format := NULLIF(btrim(COALESCE(v_parsed->>'parse_format', '')), '');
        v_parser_direction := upper(COALESCE(v_parsed->>'direction', ''));
        v_rail := CASE v_channel
            WHEN 'UPI' THEN 'UPI'
            WHEN 'IMPS' THEN 'IMPS'
            WHEN 'NEFT' THEN 'NEFT'
            WHEN 'RTGS' THEN 'RTGS'
            WHEN 'ACH' THEN 'ACH'
            WHEN 'NACH' THEN 'NACH'
            WHEN 'ATM' THEN 'CASH'
            WHEN 'POS' THEN 'CARD_NETWORK'
            WHEN 'CARD_BILLPAY' THEN 'BILLPAY'
            ELSE CASE COALESCE(v_parsed->>'sub_type', '')
                WHEN 'CHEQUE' THEN 'CHEQUE'
                WHEN 'CASH_DEPOSIT' THEN 'CASH'
                WHEN 'BILLDESK' THEN 'BILLPAY'
                ELSE 'UNKNOWN'
            END
        END;
        v_subtype := CASE
            WHEN v_channel = 'ATM' THEN 'CASH_MACHINE_WITHDRAWAL'
            WHEN COALESCE(v_parsed->>'sub_type', '') = 'CASH_DEPOSIT' THEN 'BRANCH_CASH'
            WHEN v_channel = 'POS' THEN 'POS'
            WHEN v_channel = 'CARD_BILLPAY' THEN 'BILLPAY_GENERIC'
            WHEN COALESCE(v_parsed->>'sub_type', '') = 'BILLDESK' THEN 'BILLDESK'
            WHEN COALESCE(v_parsed->>'sub_type', '') = 'CHEQUE' THEN 'CHEQUE_GENERIC'
            ELSE NULL
        END;
        IF v_format IS NOT NULL AND v_rail = 'UNKNOWN' THEN
            v_format := NULL;
        END IF;
        IF v_format IS NOT NULL AND v_format LIKE '%P2A%' THEN
            v_markers := v_markers || ARRAY['P2A'];
        END IF;
        IF v_format IS NOT NULL AND v_format LIKE '%P2M%' THEN
            v_markers := v_markers || ARRAY['P2M'];
        END IF;
        IF v_format IS NOT NULL AND v_format LIKE '%P2P%' THEN
            v_markers := v_markers || ARRAY['P2P'];
        END IF;
        IF v_parser_direction = 'REV' OR (v_format IS NOT NULL AND v_format LIKE '%REV%') THEN
            v_markers := v_markers || ARRAY['REV'];
        END IF;
        IF v_parser_direction IN ('IN', 'OUT') AND v_parser_direction IS DISTINCT FROM v_direction THEN
            v_consistency := 'CONFLICT';
        ELSIF v_parser_direction IN ('IN', 'OUT') THEN
            v_consistency := 'CONSISTENT';
        ELSE
            v_consistency := 'SOURCE_MARKER_ABSENT';
        END IF;
        IF v_rail = 'UNKNOWN' THEN
            v_status := 'UNPARSED';
            v_reasons := ARRAY['NO_RAIL_MATCH'];
        ELSIF v_consistency = 'CONFLICT' THEN
            v_status := 'CONFLICT';
            v_reasons := ARRAY['DIRECTION_MARKER_CONFLICT'];
        ELSE
            v_status := 'PARTIAL';
            v_reasons := ARRAY['AMBIGUOUS_IDENTIFIER_ROLE'];
            IF v_rail = 'UPI' AND NULLIF(btrim(COALESCE(v_parsed#>>'{fields,counterparty_vpa}', '')), '') IS NULL THEN
                v_reasons := v_reasons || ARRAY['NO_VPA'];
            END IF;
        END IF;
    END IF;
    v_reason := v_reasons[1];

    UPDATE intel.transaction_structure
       SET is_current = false
     WHERE logical_transaction_id = p_logical
       AND is_current = true;

    INSERT INTO intel.transaction_structure (
        logical_transaction_id, canonical_transaction_version_id, f10b_version,
        parser_version, registry_version, payment_rail, funding_instrument_type,
        initiation_mechanism, format_name, structural_subtype, parse_status,
        rail_confidence, parse_confidence, direction_consistency, observed_type_markers,
        reason_codes, is_current
    ) VALUES (
        p_logical, v_canonical, v_version,
        'v4', v_registry, v_rail, 'UNKNOWN',
        'UNKNOWN', CASE WHEN v_rail = 'UNKNOWN' THEN NULL ELSE v_format END, v_subtype, v_status,
        NULL, NULL, v_consistency, v_markers,
        v_reasons, true
    ) RETURNING transaction_structure_id INTO v_structure;

    IF v_parsed IS NOT NULL AND v_rail <> 'UNKNOWN' THEN
        v_raw := NULLIF(btrim(COALESCE(v_parsed#>>'{fields,counterparty_vpa}', '')), '');
        IF v_raw IS NOT NULL AND v_raw ~ '^[^[:space:]]+@[^[:space:]]+$' THEN
            INSERT INTO intel.transaction_identifier (
                transaction_structure_id, identifier_type, identifier_role, raw_value,
                normalized_value, field_name, extraction_method, confidence, ambiguity_status
            ) VALUES (
                v_structure, 'VPA', 'UNKNOWN_VPA', v_raw, lower(v_raw),
                'counterparty_vpa', 'PARSER_V4_FIELD', NULL, 'CANDIDATE'
            );
        END IF;
        v_raw := NULLIF(btrim(COALESCE(v_parsed#>>'{fields,upi_rrn}', '')), '');
        IF v_rail = 'UPI' AND v_raw IS NOT NULL AND v_raw ~ '^[0-9]{12,14}$' THEN
            INSERT INTO intel.transaction_identifier (
                transaction_structure_id, identifier_type, identifier_role, raw_value,
                normalized_value, field_name, extraction_method, confidence, ambiguity_status
            ) VALUES (
                v_structure, 'UPI_RRN', 'UNKNOWN_REFERENCE_ROLE', v_raw, v_raw,
                'upi_rrn', 'PARSER_V4_FIELD', NULL, 'CANDIDATE'
            );
        END IF;
        v_raw := NULLIF(btrim(COALESCE(v_parsed#>>'{fields,counterparty_ifsc}', '')), '');
        v_normalized := upper(COALESCE(v_raw, ''));
        IF v_raw IS NOT NULL AND v_normalized ~ '^[A-Z]{4}0[A-Z0-9]{6}$' THEN
            INSERT INTO intel.transaction_identifier (
                transaction_structure_id, identifier_type, identifier_role, raw_value,
                normalized_value, field_name, extraction_method, confidence, ambiguity_status
            ) VALUES (
                v_structure, 'IFSC', 'UNKNOWN_REFERENCE_ROLE', v_raw, v_normalized,
                'counterparty_ifsc', 'PARSER_V4_FIELD', NULL, 'CANDIDATE'
            );
        END IF;
        v_raw := NULLIF(btrim(COALESCE(v_parsed#>>'{fields,counterparty_account}', '')), '');
        IF v_raw IS NOT NULL THEN
            INSERT INTO intel.transaction_identifier (
                transaction_structure_id, identifier_type, identifier_role, raw_value,
                normalized_value, field_name, extraction_method, confidence, ambiguity_status
            ) VALUES (
                v_structure, 'ACCOUNT_TOKEN', 'COUNTERPARTY_ACCOUNT', v_raw, upper(v_raw),
                'counterparty_account', 'PARSER_V4_FIELD', NULL, 'CANDIDATE'
            );
        END IF;
        v_raw := NULLIF(btrim(COALESCE(v_parsed#>>'{fields,counterparty_name}', '')), '');
        IF v_raw IS NOT NULL THEN
            INSERT INTO intel.transaction_identifier (
                transaction_structure_id, identifier_type, identifier_role, raw_value,
                normalized_value, field_name, extraction_method, confidence, ambiguity_status
            ) VALUES (
                v_structure, 'COUNTERPARTY_LABEL_RAW', 'UNKNOWN_REFERENCE_ROLE', v_raw,
                upper(regexp_replace(v_raw, '\s+', ' ', 'g')),
                'counterparty_name', 'PARSER_V4_FIELD', NULL, 'CANDIDATE'
            );
        END IF;
    END IF;

    INSERT INTO ops.outbox_event (
        owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
    ) VALUES (
        p_owner, 'TRANSACTION_STRUCTURE_AVAILABLE', 'logical_transaction', p_logical,
        jsonb_build_object(
            'logical_transaction_id', p_logical,
            'canonical_transaction_version_id', v_canonical,
            'transaction_structure_id', v_structure,
            'f10b_version', v_version,
            'payment_rail', v_rail,
            'parse_status', v_status,
            'matched_reason', v_reason
        ),
        'structure:' || p_logical::text || ':' || v_canonical::text || ':' || v_version
    );

    RETURN jsonb_build_object(
        'outcome', 'created',
        'parse_status', v_status,
        'payment_rail', v_rail,
        'matched_reason', v_reason,
        'f10b_version', v_version,
        'logical_transaction_id', p_logical,
        'canonical_transaction_version_id', v_canonical,
        'transaction_structure_id', v_structure,
        'is_current', true
    );
END;
$structure$;

COMMENT ON FUNCTION ops.publish_transaction_structure(uuid, uuid, uuid, text) IS
'Publishes one F10B structural attempt from parser v4 fields. Does not copy parser confidence, assign PARSED, or change canonical money, F10C, F10D, or F10E.';

CREATE OR REPLACE FUNCTION ops.publish_structure_extraction_run(p_run uuid) RETURNS jsonb
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
        v_one := ops.publish_transaction_structure(v_actor, v_owner, v_logical, NULL);
        v_results := v_results || jsonb_build_array(v_one);
    END LOOP;
    RETURN jsonb_build_object('outcome', 'completed', 'results', v_results);
END;
$batch$;

REVOKE ALL ON FUNCTION ops.publish_transaction_structure(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.publish_structure_extraction_run(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.publish_transaction_structure(uuid, uuid, uuid, text) FROM monytix_intelligence;
REVOKE ALL ON FUNCTION ops.publish_structure_extraction_run(uuid) FROM monytix_intelligence;
GRANT EXECUTE ON FUNCTION ops.publish_transaction_structure(uuid, uuid, uuid, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.publish_structure_extraction_run(uuid) TO monytix_api;

GRANT SELECT ON ref.structure_policy, intel.transaction_structure, intel.transaction_identifier TO monytix_api;
REVOKE INSERT, UPDATE, DELETE ON ref.structure_policy, intel.transaction_structure, intel.transaction_identifier FROM monytix_api;
REVOKE ALL ON intel.transaction_structure, intel.transaction_identifier FROM monytix_intelligence;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M3-6-F10B-STRUCTURE',
    'F10B typed structure',
    'F10B v2.0 FINAL FREEZE',
    'F10B-v2.0',
    'Versioned rail and typed tokens from parser v4. No entity, no PARSED status, no spend category.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
