-- M3.18 registry write-integrity correction.
-- WI-1 revalidates half-open collisions when the identifier key changes.
-- WI-2 rejects a direct change to UNIQUE while an overlap remains.
-- WI-3 adds an owner-side period update that locks the scoped identifier first.
-- Does not change entity_id behavior, restore AMBIGUOUS to UNIQUE, or resolve a party.
-- Does not edit migrations 0001-0018.

BEGIN;

CREATE OR REPLACE FUNCTION ops.mark_governed_identifier_collision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, intel
AS $$
DECLARE
    key_changed boolean := false;
    period_changed boolean := false;
    status_to_unique boolean := false;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        key_changed := NEW.identifier_type IS DISTINCT FROM OLD.identifier_type
            OR NEW.provider_scope IS DISTINCT FROM OLD.provider_scope
            OR NEW.normalized_value IS DISTINCT FROM OLD.normalized_value;
        period_changed := NEW.effective_from IS DISTINCT FROM OLD.effective_from
            OR NEW.effective_to IS DISTINCT FROM OLD.effective_to;
        status_to_unique := NEW.ambiguity_status = 'UNIQUE'
            AND OLD.ambiguity_status IS DISTINCT FROM 'UNIQUE';
    END IF;

    IF TG_OP = 'UPDATE' AND NOT key_changed AND NOT period_changed THEN
        IF status_to_unique THEN
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
                RAISE EXCEPTION 'direct UNIQUE status is rejected while a half-open identifier overlap exists'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
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
        IF status_to_unique THEN
            RAISE EXCEPTION 'direct UNIQUE status is rejected while a half-open identifier overlap exists'
                USING ERRCODE = '23514';
        END IF;
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
'Half-open overlap on one scoped identifier. Key and period changes mark both rows AMBIGUOUS. A direct change to UNIQUE is rejected while that overlap exists. The function never assigns UNIQUE and does not treat entity_id as a collision event.';

DROP TRIGGER IF EXISTS trg_entity_identifier_collision ON intel.entity_identifier;
CREATE TRIGGER trg_entity_identifier_collision
BEFORE INSERT OR UPDATE OF identifier_type, provider_scope, normalized_value, effective_from, effective_to, ambiguity_status
ON intel.entity_identifier
FOR EACH ROW
EXECUTE FUNCTION ops.mark_governed_identifier_collision();

CREATE OR REPLACE FUNCTION ops.apply_governed_identifier_period(
    p_entity_identifier_id uuid,
    p_effective_from timestamptz,
    p_effective_to timestamptz
) RETURNS SETOF intel.entity_identifier
LANGUAGE plpgsql
SET search_path = pg_catalog, intel
AS $$
DECLARE
    v_type text;
    v_scope text;
    v_value text;
    v_row intel.entity_identifier;
BEGIN
    SELECT identifier_type, provider_scope, normalized_value
      INTO v_type, v_scope, v_value
      FROM intel.entity_identifier
     WHERE entity_identifier_id = p_entity_identifier_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'identifier association not found'
            USING ERRCODE = 'no_data_found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        v_type || '|' || v_scope || '|' || v_value,
        0
    ));

    UPDATE intel.entity_identifier
       SET effective_from = p_effective_from,
           effective_to = p_effective_to
     WHERE entity_identifier_id = p_entity_identifier_id
       AND identifier_type = v_type
       AND provider_scope = v_scope
       AND normalized_value = v_value
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'identifier association changed before the locked period update'
            USING ERRCODE = '40001';
    END IF;

    RETURN NEXT v_row;
    RETURN;
END;
$$;

COMMENT ON FUNCTION ops.apply_governed_identifier_period(uuid, timestamptz, timestamptz) IS
'Owner-side period update. Takes the scoped advisory lock before updating effective_from and effective_to. Collision checks stay in the identifier trigger. The function does not change entity_id or ambiguity_status and is not granted to application roles.';

REVOKE ALL ON FUNCTION ops.mark_governed_identifier_collision() FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.mark_governed_identifier_collision() FROM monytix_api, monytix_intelligence;
REVOKE ALL ON FUNCTION ops.apply_governed_identifier_period(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.apply_governed_identifier_period(uuid, timestamptz, timestamptz) FROM monytix_api, monytix_intelligence;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M3-18-WRITE-INTEGRITY',
    'Registry write-integrity correction',
    'M3.17-WI-1-WI-2-WI-3',
    'M3.18-key-status-lock',
    'Revalidate identifier key changes, reject direct UNIQUE during overlap, and lock before an owner-side period update. Entity attachment is unchanged.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
