-- A signed-in actor needs one personal owner before a statement upload can proceed.

BEGIN;

CREATE OR REPLACE FUNCTION ops.ensure_personal_owner(
    p_actor uuid,
    p_email text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $$
DECLARE
    v_owner uuid;
    v_name text;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'actor is required';
    END IF;

    PERFORM 1
    FROM core.authenticated_actor
    WHERE actor_id = p_actor
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'actor is required';
    END IF;

    SELECT owner_id INTO v_owner
    FROM core.actor_owner_membership
    WHERE actor_id = p_actor
      AND membership_status = 'ACTIVE'
      AND effective_to IS NULL
      AND effective_from <= clock_timestamp()
    ORDER BY is_default_owner DESC, created_at
    LIMIT 1;

    IF v_owner IS NOT NULL THEN
        UPDATE core.actor_owner_membership
        SET is_default_owner = true
        WHERE actor_id = p_actor
          AND owner_id = v_owner
          AND membership_status = 'ACTIVE'
          AND effective_to IS NULL
          AND is_default_owner = false;
        RETURN v_owner;
    END IF;

    v_name := NULLIF(btrim(COALESCE(p_email, '')), '');

    INSERT INTO core.owner (owner_type, display_name)
    VALUES ('PERSON', v_name)
    RETURNING owner_id INTO v_owner;

    INSERT INTO core.actor_owner_membership (
        actor_id, owner_id, membership_role, membership_status, is_default_owner
    ) VALUES (
        p_actor, v_owner, 'OWNER', 'ACTIVE', true
    );

    RETURN v_owner;
END;
$$;

REVOKE ALL ON FUNCTION ops.ensure_personal_owner(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.ensure_personal_owner(uuid, text) TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'PERSONAL-OWNER',
    'Personal owner for a signed-in actor',
    'identity-v0.1',
    'ensure-personal-owner',
    'The first signed-in request creates one PERSON owner. A requested owner the actor cannot access stays forbidden.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
