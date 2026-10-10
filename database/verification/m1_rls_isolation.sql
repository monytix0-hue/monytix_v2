-- M1 RLS and role checks. Test rows roll back. Run as the migration superuser
-- after 0002 and 0003. Application roles must not bypass RLS.

BEGIN;

DO $$
DECLARE
    api_bypass boolean;
    api_super boolean;
    intel_bypass boolean;
    actor_a uuid;
    owner_a uuid;
    owner_b uuid;
    visible integer;
BEGIN
    IF to_regclass('ops.idempotency_record') IS NULL THEN
        RAISE EXCEPTION 'M1 verification failed: ops.idempotency_record is missing';
    END IF;
    IF to_regclass('ops.outbox_event') IS NULL THEN
        RAISE EXCEPTION 'M1 verification failed: ops.outbox_event is missing';
    END IF;

    SELECT rolbypassrls, rolsuper
    INTO api_bypass, api_super
    FROM pg_roles
    WHERE rolname = 'monytix_api';

    IF api_bypass IS DISTINCT FROM false OR api_super IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'M1 verification failed: monytix_api bypasses RLS or is superuser';
    END IF;

    SELECT rolbypassrls INTO intel_bypass
    FROM pg_roles
    WHERE rolname = 'monytix_intelligence';

    IF intel_bypass IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'M1 verification failed: monytix_intelligence bypasses RLS';
    END IF;

    INSERT INTO core.authenticated_actor (actor_type, auth_provider, auth_subject)
    VALUES ('HUMAN', 'TEST', 'm1-rls-actor')
    RETURNING actor_id INTO actor_a;

    INSERT INTO core.owner (owner_type, display_name)
    VALUES ('PERSON', 'Owner A')
    RETURNING owner_id INTO owner_a;

    INSERT INTO core.owner (owner_type, display_name)
    VALUES ('PERSON', 'Owner B')
    RETURNING owner_id INTO owner_b;

    INSERT INTO core.actor_owner_membership (
        actor_id, owner_id, membership_role, membership_status, is_default_owner
    ) VALUES (
        actor_a, owner_a, 'OWNER', 'ACTIVE', true
    );

    EXECUTE format('SET LOCAL ROLE monytix_api');
    PERFORM set_config('app.actor_id', actor_a::text, true);
    PERFORM set_config('app.owner_id', owner_a::text, true);

    SELECT count(*) INTO visible
    FROM core.owner
    WHERE owner_id = owner_b;

    IF visible <> 0 THEN
        RAISE EXCEPTION 'M1 verification failed: owner A can read owner B';
    END IF;

    SELECT count(*) INTO visible
    FROM core.owner
    WHERE owner_id = owner_a;

    IF visible <> 1 THEN
        RAISE EXCEPTION 'M1 verification failed: owner A cannot read its own row';
    END IF;

    RESET ROLE;

    BEGIN
        EXECUTE 'SET LOCAL ROLE monytix_intelligence';
        INSERT INTO core.owner (owner_type, display_name)
        VALUES ('BUSINESS', 'Intelligence must not insert');
        RAISE EXCEPTION 'M1 verification failed: monytix_intelligence inserted core.owner';
    EXCEPTION
        WHEN insufficient_privilege THEN
            NULL;
    END;
END $$;

ROLLBACK;

SELECT 'M1 RLS verification passed' AS result;
