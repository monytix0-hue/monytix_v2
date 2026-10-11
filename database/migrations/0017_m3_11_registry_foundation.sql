-- M3.11 governed registry foundation.
-- Non-personal entities, identifiers, aliases, and a versioned policy row.
-- Does not resolve a party, assign SELF, or read or write F10B-F10E results.
-- Does not edit migrations 0001-0016.

BEGIN;

CREATE TABLE IF NOT EXISTS ref.entity_registry_rule (
    entity_registry_rule_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    registry_version        text NOT NULL,
    rule_code               text NOT NULL,
    status                  text NOT NULL DEFAULT 'ACTIVE',
    catalogue_note          text NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_entity_registry_rule UNIQUE (registry_version, rule_code),
    CONSTRAINT ck_entity_registry_rule_version CHECK (btrim(registry_version) <> ''),
    CONSTRAINT ck_entity_registry_rule_code CHECK (btrim(rule_code) <> ''),
    CONSTRAINT ck_entity_registry_rule_status CHECK (status IN ('ACTIVE', 'RETIRED'))
);

COMMENT ON TABLE ref.entity_registry_rule IS
'M3.11 policy version a later resolution could cite. No numeric threshold and no calibration set are stored.';

INSERT INTO ref.entity_registry_rule (registry_version, rule_code, catalogue_note)
VALUES (
    'M3.11-v1',
    'FOUNDATION_ONLY',
    'Structure only. No auto-resolution cutoff.'
)
ON CONFLICT (registry_version, rule_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS intel.financial_entity (
    entity_id               uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    entity_nature           text NOT NULL,
    entity_registry_rule_id uuid NOT NULL REFERENCES ref.entity_registry_rule(entity_registry_rule_id) ON DELETE RESTRICT,
    status                  text NOT NULL DEFAULT 'ACTIVE',
    effective_from          timestamptz NOT NULL DEFAULT clock_timestamp(),
    effective_to            timestamptz,
    created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_financial_entity_nature CHECK (entity_nature IN (
        'ORGANIZATION', 'FINANCIAL_INSTITUTION', 'GOVERNMENT_BODY',
        'PLATFORM_OR_INTERMEDIARY', 'UNKNOWN'
    )),
    CONSTRAINT ck_financial_entity_status CHECK (status IN ('ACTIVE', 'RETIRED')),
    CONSTRAINT ck_financial_entity_period CHECK (effective_to IS NULL OR effective_to > effective_from)
);

COMMENT ON TABLE intel.financial_entity IS
'Non-personal governed entity. PERSON is excluded. The row has no owner and does not resolve a transaction.';

CREATE TABLE IF NOT EXISTS intel.entity_identifier (
    entity_identifier_id    uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    entity_id               uuid NOT NULL REFERENCES intel.financial_entity(entity_id) ON DELETE RESTRICT,
    identifier_type         text NOT NULL,
    provider_scope          text NOT NULL,
    normalized_value        text NOT NULL,
    ambiguity_status        text NOT NULL DEFAULT 'UNIQUE',
    effective_from          timestamptz NOT NULL DEFAULT clock_timestamp(),
    effective_to            timestamptz,
    entity_registry_rule_id uuid NOT NULL REFERENCES ref.entity_registry_rule(entity_registry_rule_id) ON DELETE RESTRICT,
    created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_entity_identifier_type CHECK (identifier_type IN (
        'MERCHANT_ID', 'TERMINAL_ID', 'BILLER_ID', 'BANK_ID', 'BIC', 'IFSC'
    )),
    CONSTRAINT ck_entity_identifier_scope CHECK (provider_scope = btrim(provider_scope) AND provider_scope <> ''),
    CONSTRAINT ck_entity_identifier_value CHECK (normalized_value = btrim(normalized_value) AND normalized_value <> ''),
    CONSTRAINT ck_entity_identifier_ambiguity CHECK (ambiguity_status IN ('UNIQUE', 'AMBIGUOUS')),
    CONSTRAINT ck_entity_identifier_period CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_identifier_same_entity
    ON intel.entity_identifier (entity_id, identifier_type, provider_scope, normalized_value)
    WHERE effective_to IS NULL;

COMMENT ON TABLE intel.entity_identifier IS
'Non-personal governed token. A second active attachment for the same scoped value marks both AMBIGUOUS and selects neither entity. VPA and account tokens are rejected.';

CREATE TABLE IF NOT EXISTS intel.entity_alias (
    entity_alias_id         uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    entity_id               uuid NOT NULL REFERENCES intel.financial_entity(entity_id) ON DELETE RESTRICT,
    alias_type              text NOT NULL,
    normalized_value        text NOT NULL,
    alias_confidence        numeric(5,4),
    ambiguity_status        text NOT NULL DEFAULT 'UNIQUE',
    effective_from          timestamptz NOT NULL DEFAULT clock_timestamp(),
    effective_to            timestamptz,
    entity_registry_rule_id uuid NOT NULL REFERENCES ref.entity_registry_rule(entity_registry_rule_id) ON DELETE RESTRICT,
    created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_entity_alias_type CHECK (alias_type IN (
        'LEGAL_NAME', 'BRAND', 'DISPLAY_NAME', 'NARRATION_VARIANT', 'VPA_LABEL', 'LEGACY_ALIAS'
    )),
    CONSTRAINT ck_entity_alias_value CHECK (normalized_value = btrim(normalized_value) AND normalized_value <> ''),
    CONSTRAINT ck_entity_alias_confidence CHECK (alias_confidence IS NULL),
    CONSTRAINT ck_entity_alias_ambiguity CHECK (ambiguity_status IN ('UNIQUE', 'AMBIGUOUS')),
    CONSTRAINT ck_entity_alias_period CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_alias_same_entity
    ON intel.entity_alias (entity_id, alias_type, normalized_value)
    WHERE effective_to IS NULL;

COMMENT ON TABLE intel.entity_alias IS
'Non-personal name form. Confidence stays null. USER_ALIAS is rejected. A shared active name marks both rows AMBIGUOUS.';

CREATE OR REPLACE FUNCTION ops.mark_governed_identifier_collision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, intel
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
        NEW.identifier_type || '|' || NEW.provider_scope || '|' || NEW.normalized_value,
        0
    ));
    IF EXISTS (
        SELECT 1
          FROM intel.entity_identifier existing
         WHERE existing.identifier_type = NEW.identifier_type
           AND existing.provider_scope = NEW.provider_scope
           AND existing.normalized_value = NEW.normalized_value
           AND existing.effective_to IS NULL
           AND existing.entity_id IS DISTINCT FROM NEW.entity_id
    ) THEN
        UPDATE intel.entity_identifier
           SET ambiguity_status = 'AMBIGUOUS'
         WHERE identifier_type = NEW.identifier_type
           AND provider_scope = NEW.provider_scope
           AND normalized_value = NEW.normalized_value
           AND effective_to IS NULL
           AND entity_id IS DISTINCT FROM NEW.entity_id;
        NEW.ambiguity_status := 'AMBIGUOUS';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ops.mark_governed_alias_collision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, intel
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'alias|' || NEW.alias_type || '|' || NEW.normalized_value,
        0
    ));
    IF EXISTS (
        SELECT 1
          FROM intel.entity_alias existing
         WHERE existing.alias_type = NEW.alias_type
           AND existing.normalized_value = NEW.normalized_value
           AND existing.effective_to IS NULL
           AND existing.entity_id IS DISTINCT FROM NEW.entity_id
    ) THEN
        UPDATE intel.entity_alias
           SET ambiguity_status = 'AMBIGUOUS'
         WHERE alias_type = NEW.alias_type
           AND normalized_value = NEW.normalized_value
           AND effective_to IS NULL
           AND entity_id IS DISTINCT FROM NEW.entity_id;
        NEW.ambiguity_status := 'AMBIGUOUS';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entity_identifier_collision ON intel.entity_identifier;
CREATE TRIGGER trg_entity_identifier_collision
BEFORE INSERT ON intel.entity_identifier
FOR EACH ROW
EXECUTE FUNCTION ops.mark_governed_identifier_collision();

DROP TRIGGER IF EXISTS trg_entity_alias_collision ON intel.entity_alias;
CREATE TRIGGER trg_entity_alias_collision
BEFORE INSERT ON intel.entity_alias
FOR EACH ROW
EXECUTE FUNCTION ops.mark_governed_alias_collision();

REVOKE ALL ON FUNCTION ops.mark_governed_identifier_collision() FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.mark_governed_alias_collision() FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.mark_governed_identifier_collision() FROM monytix_api, monytix_intelligence;
REVOKE ALL ON FUNCTION ops.mark_governed_alias_collision() FROM monytix_api, monytix_intelligence;

ALTER TABLE intel.financial_entity ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.financial_entity FORCE ROW LEVEL SECURITY;
ALTER TABLE intel.entity_identifier ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.entity_identifier FORCE ROW LEVEL SECURITY;
ALTER TABLE intel.entity_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.entity_alias FORCE ROW LEVEL SECURITY;

REVOKE ALL ON ref.entity_registry_rule, intel.financial_entity, intel.entity_identifier, intel.entity_alias FROM PUBLIC;
REVOKE ALL ON ref.entity_registry_rule, intel.financial_entity, intel.entity_identifier, intel.entity_alias FROM monytix_api;
REVOKE ALL ON ref.entity_registry_rule, intel.financial_entity, intel.entity_identifier, intel.entity_alias FROM monytix_intelligence;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M3-11-REGISTRY-FOUNDATION',
    'Governed registry foundation',
    'IDENTITY-AMENDMENT-v0.1',
    'M3.11-v1',
    'Non-personal entity, identifier, alias, and policy structures. No resolution and no pipeline change.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
