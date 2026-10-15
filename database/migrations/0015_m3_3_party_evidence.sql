-- M3.3 F10C party evidence.
-- Records structured parser observations and an unresolved or ambiguous
-- party attempt. Does not create a reusable entity, a merchant, or a spend category.
-- Does not edit migrations 0001-0014 and does not change canonical money or F10D/F10E rows.

BEGIN;

CREATE TABLE IF NOT EXISTS ref.party_resolution_policy (
    party_policy_id  uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    f10c_version     text NOT NULL,
    status           text NOT NULL DEFAULT 'ACTIVE',
    created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_party_resolution_policy UNIQUE (f10c_version),
    CONSTRAINT ck_party_resolution_policy_version CHECK (btrim(f10c_version) <> ''),
    CONSTRAINT ck_party_resolution_policy_status CHECK (status IN ('ACTIVE', 'RETIRED'))
);

CREATE TABLE IF NOT EXISTS ref.party_observation_field (
    party_observation_field_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    f10c_version               text NOT NULL REFERENCES ref.party_resolution_policy(f10c_version),
    field_name                 text NOT NULL,
    observation_type           text NOT NULL,
    sensitivity_class          text NOT NULL,
    identifier_strength        text NOT NULL,
    created_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_party_observation_field UNIQUE (f10c_version, field_name),
    CONSTRAINT ck_party_observation_type CHECK (observation_type IN (
        'LABEL', 'VPA', 'ACCOUNT_TOKEN', 'CARD_TOKEN', 'MERCHANT_ID', 'TERMINAL_ID',
        'BILLER_ID', 'BANK_ID', 'BIC', 'IFSC', 'RTA_TOKEN', 'FOLIO_TOKEN',
        'LINKED_DEPOSIT_ACCOUNT_TOKEN', 'SWEEP_REFERENCE', 'OTHER_IDENTIFIER'
    )),
    CONSTRAINT ck_party_observation_sensitivity CHECK (sensitivity_class IN ('IDENTIFIER', 'LABEL')),
    CONSTRAINT ck_party_observation_strength CHECK (identifier_strength IN ('STRONG', 'WEAK'))
);

COMMENT ON TABLE ref.party_observation_field IS
'F10B field names F10C may read. Narration text and UPI classifier scores are not fields.';

INSERT INTO ref.party_resolution_policy (f10c_version)
VALUES ('F10C-v1.2')
ON CONFLICT (f10c_version) DO NOTHING;

INSERT INTO ref.party_observation_field (
    f10c_version, field_name, observation_type, sensitivity_class, identifier_strength
) VALUES
    ('F10C-v1.2', 'counterparty_vpa', 'VPA', 'IDENTIFIER', 'STRONG'),
    ('F10C-v1.2', 'counterparty_account', 'ACCOUNT_TOKEN', 'IDENTIFIER', 'STRONG'),
    ('F10C-v1.2', 'counterparty_name', 'LABEL', 'LABEL', 'WEAK'),
    ('F10C-v1.2', 'counterparty_bank', 'BANK_ID', 'LABEL', 'WEAK'),
    ('F10C-v1.2', 'counterparty_ifsc', 'IFSC', 'IDENTIFIER', 'WEAK')
ON CONFLICT (f10c_version, field_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS intel.entity_observation (
    entity_observation_id        uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    logical_transaction_id       uuid NOT NULL REFERENCES core.logical_transaction(logical_transaction_id) ON DELETE RESTRICT,
    canonical_transaction_version_id uuid NOT NULL REFERENCES core.canonical_transaction_version(canonical_transaction_version_id) ON DELETE RESTRICT,
    source_record_id             uuid NOT NULL REFERENCES core.source_record(source_record_id) ON DELETE RESTRICT,
    f10c_version                 text NOT NULL,
    parser_version               text,
    field_name                   text NOT NULL,
    observation_type             text NOT NULL,
    structural_role              text NOT NULL,
    raw_value                    text NOT NULL,
    normalized_value             text NOT NULL,
    source_confidence            numeric(5,4),
    sensitivity_class            text NOT NULL,
    provenance                   jsonb NOT NULL,
    created_at                   timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_entity_observation UNIQUE (source_record_id, f10c_version, field_name),
    CONSTRAINT ck_entity_observation_role CHECK (structural_role = 'VISIBLE_COUNTERPARTY'),
    CONSTRAINT ck_entity_observation_confidence CHECK (
        source_confidence IS NULL OR (source_confidence >= 0 AND source_confidence <= 1)
    ),
    CONSTRAINT ck_entity_observation_provenance CHECK (jsonb_typeof(provenance) = 'object')
);

COMMENT ON TABLE intel.entity_observation IS
'Same-owner structured party signal. Not a reusable entity. Raw values stay out of the outbox.';

CREATE TABLE IF NOT EXISTS intel.transaction_party_resolution (
    party_resolution_id              uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    logical_transaction_id           uuid NOT NULL REFERENCES core.logical_transaction(logical_transaction_id) ON DELETE RESTRICT,
    canonical_transaction_version_id uuid NOT NULL REFERENCES core.canonical_transaction_version(canonical_transaction_version_id) ON DELETE RESTRICT,
    f10c_version                     text NOT NULL,
    resolution_status                text NOT NULL,
    entity_id                        uuid,
    entity_nature                    text NOT NULL,
    owner_relationship               text NOT NULL,
    commercial_role_hint             text,
    counterparty_scale_hint          text,
    matched_reason                   text NOT NULL,
    reason_codes                     text[] NOT NULL,
    evidence_references              jsonb NOT NULL DEFAULT '[]'::jsonb,
    identity_confidence              numeric(5,4),
    overall_resolution_confidence    numeric(5,4),
    is_current                       boolean NOT NULL DEFAULT true,
    resolved_at                      timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_party_resolution_attempt UNIQUE (
        logical_transaction_id, canonical_transaction_version_id, f10c_version
    ),
    CONSTRAINT ck_party_resolution_status CHECK (resolution_status IN (
        'RESOLVED', 'PROVISIONAL', 'AMBIGUOUS', 'UNKNOWN', 'NOT_APPLICABLE', 'INVALIDATED'
    )),
    CONSTRAINT ck_party_resolution_nature CHECK (entity_nature IN (
        'PERSON', 'ORGANIZATION', 'FINANCIAL_INSTITUTION', 'GOVERNMENT_BODY',
        'PLATFORM_OR_INTERMEDIARY', 'UNKNOWN'
    )),
    CONSTRAINT ck_party_resolution_relationship CHECK (owner_relationship IN (
        'SELF', 'JOINT_SELF', 'RELATED_PARTY', 'EXTERNAL', 'UNKNOWN'
    )),
    CONSTRAINT ck_party_resolution_hint CHECK (
        commercial_role_hint IS NULL OR commercial_role_hint IN (
            'MERCHANT', 'BILLER', 'EMPLOYER_CANDIDATE', 'RTA', 'PAYMENT_GATEWAY',
            'MARKETPLACE', 'SERVICE_PROVIDER', 'UNKNOWN'
        )
    ),
    CONSTRAINT ck_party_resolution_scale CHECK (
        counterparty_scale_hint IS NULL OR counterparty_scale_hint IN (
            'SMALL_MERCHANT_CANDIDATE', 'ESTABLISHED_MERCHANT_CANDIDATE', 'UNKNOWN'
        )
    ),
    CONSTRAINT ck_party_resolution_reason CHECK (matched_reason IN (
        'NO_ENTITY_CANDIDATE', 'WEAK_LABEL_ONLY', 'VPA_ROLE_AMBIGUOUS', 'MULTIPLE_ENTITY_CANDIDATES'
    )),
    CONSTRAINT ck_party_resolution_evidence CHECK (jsonb_typeof(evidence_references) = 'array'),
    CONSTRAINT ck_party_resolution_confidence CHECK (
        (identity_confidence IS NULL OR (identity_confidence >= 0 AND identity_confidence <= 1))
        AND (overall_resolution_confidence IS NULL OR (overall_resolution_confidence >= 0 AND overall_resolution_confidence <= 1))
    ),
    CONSTRAINT ck_party_resolution_shape CHECK (
        resolution_status IN ('UNKNOWN', 'AMBIGUOUS', 'PROVISIONAL', 'NOT_APPLICABLE', 'INVALIDATED')
        AND entity_id IS NULL
        AND entity_nature = 'UNKNOWN'
        AND owner_relationship = 'UNKNOWN'
        AND commercial_role_hint IS NULL
        AND counterparty_scale_hint IS NULL
        AND identity_confidence IS NULL
        AND overall_resolution_confidence IS NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_party_resolution_current
    ON intel.transaction_party_resolution (logical_transaction_id)
    WHERE is_current;

COMMENT ON TABLE intel.transaction_party_resolution IS
'Versioned F10C attempt. This slice does not resolve a reusable entity and does not assign SELF or MERCHANT.';

ALTER TABLE intel.entity_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.entity_observation FORCE ROW LEVEL SECURITY;
ALTER TABLE intel.transaction_party_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.transaction_party_resolution FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_entity_observation_owner_read ON intel.entity_observation;
CREATE POLICY pol_entity_observation_owner_read
ON intel.entity_observation
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM core.logical_transaction lt
        JOIN core.account_ownership ao ON ao.financial_account_id = lt.financial_account_id
        WHERE lt.logical_transaction_id = entity_observation.logical_transaction_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

DROP POLICY IF EXISTS pol_party_resolution_owner_read ON intel.transaction_party_resolution;
CREATE POLICY pol_party_resolution_owner_read
ON intel.transaction_party_resolution
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM core.logical_transaction lt
        JOIN core.account_ownership ao ON ao.financial_account_id = lt.financial_account_id
        WHERE lt.logical_transaction_id = transaction_party_resolution.logical_transaction_id
          AND ao.owner_id = ops.current_owner_id()
          AND ao.relationship_status = 'ACTIVE'
          AND ao.effective_to IS NULL
    )
);

CREATE OR REPLACE FUNCTION ops.resolve_transaction_party(
    p_actor uuid,
    p_owner uuid,
    p_logical uuid,
    p_f10c_version text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ref, intel, core, ops, pg_temp
AS $party$
DECLARE
    v_default constant text := 'F10C-v1.2';
    v_version text;
    v_owner_type text;
    v_account uuid;
    v_canonical uuid;
    v_existing uuid;
    v_existing_status text;
    v_existing_reason text;
    v_existing_current boolean;
    v_src record;
    v_field record;
    v_raw text;
    v_normalized text;
    v_observation uuid;
    v_evidence jsonb;
    v_strong integer;
    v_labels integer;
    v_vpas integer;
    v_status text;
    v_reason text;
    v_reasons text[];
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

    v_version := COALESCE(NULLIF(btrim(COALESCE(p_f10c_version, '')), ''), v_default);
    IF NOT EXISTS (
        SELECT 1 FROM ref.party_resolution_policy
         WHERE f10c_version = v_version AND status = 'ACTIVE'
    ) THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('monytix-party:' || p_logical::text, 0));

    SELECT canonical_transaction_version_id
      INTO v_canonical
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

    SELECT party_resolution_id, resolution_status, matched_reason, is_current
      INTO v_existing, v_existing_status, v_existing_reason, v_existing_current
      FROM intel.transaction_party_resolution
     WHERE logical_transaction_id = p_logical
       AND canonical_transaction_version_id = v_canonical
       AND f10c_version = v_version
     FOR UPDATE;
    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object(
            'outcome', 'replay',
            'resolution_status', v_existing_status,
            'matched_reason', v_existing_reason,
            'f10c_version', v_version,
            'logical_transaction_id', p_logical,
            'canonical_transaction_version_id', v_canonical,
            'party_resolution_id', v_existing,
            'is_current', v_existing_current
        );
    END IF;

    FOR v_src IN
        SELECT DISTINCT sr.source_record_id, sr.raw_record_payload
          FROM core.transaction_evidence_link tel
          JOIN core.source_record sr ON sr.source_record_id = tel.source_record_id
          JOIN core.extraction_run er ON er.extraction_run_id = sr.extraction_run_id
          JOIN core.source_document sd ON sd.source_document_id = er.source_document_id
         WHERE tel.logical_transaction_id = p_logical
           AND tel.source_record_id IS NOT NULL
           AND sd.owner_id = p_owner
    LOOP
        FOR v_field IN
            SELECT field_name, observation_type, sensitivity_class, identifier_strength
              FROM ref.party_observation_field
             WHERE f10c_version = v_version
        LOOP
            v_raw := NULLIF(btrim(COALESCE(v_src.raw_record_payload->'fields'->>v_field.field_name, '')), '');
            IF v_raw IS NULL THEN
                CONTINUE;
            END IF;
            v_normalized := CASE
                WHEN v_field.observation_type = 'VPA' THEN lower(v_raw)
                WHEN v_field.observation_type IN ('LABEL', 'BANK_ID') THEN upper(regexp_replace(v_raw, '\s+', ' ', 'g'))
                ELSE upper(v_raw)
            END;
            INSERT INTO intel.entity_observation (
                logical_transaction_id, canonical_transaction_version_id, source_record_id,
                f10c_version, parser_version, field_name, observation_type, structural_role,
                raw_value, normalized_value, source_confidence, sensitivity_class, provenance
            ) VALUES (
                p_logical, v_canonical, v_src.source_record_id,
                v_version, NULLIF(btrim(COALESCE(v_src.raw_record_payload->>'parse_version', '')), ''),
                v_field.field_name, v_field.observation_type, 'VISIBLE_COUNTERPARTY',
                v_raw, v_normalized, NULL, v_field.sensitivity_class,
                jsonb_build_object('field', v_field.field_name, 'parser_version', NULLIF(btrim(COALESCE(v_src.raw_record_payload->>'parse_version', '')), ''))
            )
            ON CONFLICT (source_record_id, f10c_version, field_name) DO NOTHING;
        END LOOP;
    END LOOP;

    SELECT count(DISTINCT normalized_value) FILTER (WHERE observation_type IN ('VPA', 'ACCOUNT_TOKEN')),
           count(*) FILTER (WHERE observation_type = 'LABEL'),
           count(DISTINCT normalized_value) FILTER (WHERE observation_type = 'VPA')
      INTO v_strong, v_labels, v_vpas
      FROM intel.entity_observation
     WHERE logical_transaction_id = p_logical
       AND canonical_transaction_version_id = v_canonical
       AND f10c_version = v_version;

    IF COALESCE(v_strong, 0) > 1 THEN
        v_status := 'AMBIGUOUS';
        v_reason := 'MULTIPLE_ENTITY_CANDIDATES';
        v_reasons := ARRAY['MULTIPLE_ENTITY_CANDIDATES'];
    ELSIF COALESCE(v_vpas, 0) = 1 THEN
        v_status := 'UNKNOWN';
        v_reason := 'VPA_ROLE_AMBIGUOUS';
        v_reasons := ARRAY['VPA_ROLE_AMBIGUOUS', 'NO_ENTITY_CANDIDATE'];
    ELSIF COALESCE(v_labels, 0) > 0 THEN
        v_status := 'UNKNOWN';
        v_reason := 'WEAK_LABEL_ONLY';
        v_reasons := ARRAY['WEAK_LABEL_ONLY'];
    ELSE
        v_status := 'UNKNOWN';
        v_reason := 'NO_ENTITY_CANDIDATE';
        v_reasons := ARRAY['NO_ENTITY_CANDIDATE'];
    END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(entity_observation_id) ORDER BY entity_observation_id), '[]'::jsonb)
      INTO v_evidence
      FROM intel.entity_observation
     WHERE logical_transaction_id = p_logical
       AND canonical_transaction_version_id = v_canonical
       AND f10c_version = v_version;

    UPDATE intel.transaction_party_resolution
       SET is_current = false
     WHERE logical_transaction_id = p_logical
       AND is_current = true;

    INSERT INTO intel.transaction_party_resolution (
        logical_transaction_id, canonical_transaction_version_id, f10c_version,
        resolution_status, entity_id, entity_nature, owner_relationship,
        commercial_role_hint, counterparty_scale_hint, matched_reason, reason_codes,
        evidence_references, identity_confidence, overall_resolution_confidence, is_current
    ) VALUES (
        p_logical, v_canonical, v_version,
        v_status, NULL, 'UNKNOWN', 'UNKNOWN',
        NULL, NULL, v_reason, v_reasons,
        v_evidence, NULL, NULL, true
    ) RETURNING party_resolution_id INTO v_observation;

    INSERT INTO ops.outbox_event (
        owner_id, semantic_trigger_code, aggregate_type, aggregate_id, event_payload, dedupe_key
    ) VALUES (
        p_owner, 'TRANSACTION_PARTY_RESOLVED', 'logical_transaction', p_logical,
        jsonb_build_object(
            'logical_transaction_id', p_logical,
            'canonical_transaction_version_id', v_canonical,
            'party_resolution_id', v_observation,
            'f10c_version', v_version,
            'resolution_status', v_status,
            'matched_reason', v_reason
        ),
        'party-resolve:' || p_logical::text || ':' || v_canonical::text || ':' || v_version
    );

    RETURN jsonb_build_object(
        'outcome', 'created',
        'resolution_status', v_status,
        'matched_reason', v_reason,
        'f10c_version', v_version,
        'logical_transaction_id', p_logical,
        'canonical_transaction_version_id', v_canonical,
        'party_resolution_id', v_observation,
        'is_current', true
    );
END;
$party$;

COMMENT ON FUNCTION ops.resolve_transaction_party(uuid, uuid, uuid, text) IS
'Writes one F10C party attempt from same-owner structured fields. Does not create an entity, assign SELF or MERCHANT, or change canonical money, F10D, or F10E.';

CREATE OR REPLACE FUNCTION ops.resolve_party_extraction_run(p_run uuid) RETURNS jsonb
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
        v_one := ops.resolve_transaction_party(v_actor, v_owner, v_logical, NULL);
        v_results := v_results || jsonb_build_array(v_one);
    END LOOP;
    RETURN jsonb_build_object('outcome', 'completed', 'results', v_results);
END;
$batch$;

REVOKE ALL ON FUNCTION ops.resolve_transaction_party(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.resolve_party_extraction_run(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.resolve_transaction_party(uuid, uuid, uuid, text) FROM monytix_intelligence;
REVOKE ALL ON FUNCTION ops.resolve_party_extraction_run(uuid) FROM monytix_intelligence;
GRANT EXECUTE ON FUNCTION ops.resolve_transaction_party(uuid, uuid, uuid, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.resolve_party_extraction_run(uuid) TO monytix_api;

GRANT SELECT ON
    ref.party_resolution_policy,
    ref.party_observation_field,
    intel.entity_observation,
    intel.transaction_party_resolution
TO monytix_api;
REVOKE INSERT, UPDATE, DELETE ON
    ref.party_resolution_policy,
    ref.party_observation_field,
    intel.entity_observation,
    intel.transaction_party_resolution
FROM monytix_api;
REVOKE ALL ON intel.entity_observation, intel.transaction_party_resolution FROM monytix_intelligence;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M3-3-F10C-PARTY',
    'F10C party evidence',
    'F10C v1.2 FINAL FREEZE',
    'F10C-v1.2',
    'Structured same-owner party observations and unresolved or ambiguous attempts. No reusable entity and no spend category.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
