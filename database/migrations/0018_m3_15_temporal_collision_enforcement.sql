-- M3.15 temporal collision enforcement.
-- Half-open identifier periods on insert and on effective-date update.
-- Does not rewrite untouched rows, restore AMBIGUOUS to UNIQUE, or resolve a party.
-- Does not edit migrations 0001-0017.

BEGIN;

CREATE OR REPLACE FUNCTION ops.mark_governed_identifier_collision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, intel
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.effective_from IS NOT DISTINCT FROM OLD.effective_from
       AND NEW.effective_to IS NOT DISTINCT FROM OLD.effective_to THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        NEW.identifier_type || '|' || NEW.provider_scope || '|' || NEW.normalized_value,
        0
    ));

    IF EXISTS (
        SELECT 1
          FROM intel.entity_identifier existing
         WHERE existing.entity_identifier_id IS DISTINCT FROM NEW.entity_identifier_id
           AND existing.identifier_type = NEW.identifier_type
           AND existing.provider_scope = NEW.provider_scope
           AND existing.normalized_value = NEW.normalized_value
           AND existing.entity_id IS DISTINCT FROM NEW.entity_id
           AND existing.effective_from < COALESCE(NEW.effective_to, 'infinity'::timestamptz)
           AND NEW.effective_from < COALESCE(existing.effective_to, 'infinity'::timestamptz)
    ) THEN
        UPDATE intel.entity_identifier AS existing
           SET ambiguity_status = 'AMBIGUOUS'
         WHERE existing.entity_identifier_id IS DISTINCT FROM NEW.entity_identifier_id
           AND existing.identifier_type = NEW.identifier_type
           AND existing.provider_scope = NEW.provider_scope
           AND existing.normalized_value = NEW.normalized_value
           AND existing.entity_id IS DISTINCT FROM NEW.entity_id
           AND existing.effective_from < COALESCE(NEW.effective_to, 'infinity'::timestamptz)
           AND NEW.effective_from < COALESCE(existing.effective_to, 'infinity'::timestamptz);
        NEW.ambiguity_status := 'AMBIGUOUS';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ops.mark_governed_identifier_collision() IS
'Half-open [effective_from, effective_to) overlap on one scoped identifier. Both rows become AMBIGUOUS. The function never assigns UNIQUE. Date-only changes are ignored when the period did not change. Untouched rows are not scanned.';

DROP TRIGGER IF EXISTS trg_entity_identifier_collision ON intel.entity_identifier;
CREATE TRIGGER trg_entity_identifier_collision
BEFORE INSERT OR UPDATE OF effective_from, effective_to ON intel.entity_identifier
FOR EACH ROW
EXECUTE FUNCTION ops.mark_governed_identifier_collision();

REVOKE ALL ON FUNCTION ops.mark_governed_identifier_collision() FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.mark_governed_identifier_collision() FROM monytix_api, monytix_intelligence;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M3-15-TEMPORAL-COLLISION',
    'Temporal collision enforcement',
    'TEMPORAL-COLLISION-v0.1',
    'M3.15-half-open',
    'Forward enforcement of half-open identifier overlap on insert and effective-date update. No backfill and no restoration to UNIQUE.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
