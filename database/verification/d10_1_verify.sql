-- ============================================================================
-- MONYTIX D10-1 verification / smoke test
-- Safe behavior: all test rows are rolled back.
-- Run after D10_1_foundation_identity.sql using the schema-owner/migration role.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    missing text;
    u uuid;
BEGIN
    SELECT string_agg(s, ', ')
    INTO missing
    FROM unnest(ARRAY['core','intel','evidence','context','action','experience','ref','ops']) AS s
    WHERE NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = s);

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'D10-1 verification failed: missing schemas: %', missing;
    END IF;

    u := ops.uuid_v7();
    IF substr(u::text, 15, 1) <> '7' THEN
        RAISE EXCEPTION 'D10-1 verification failed: ops.uuid_v7() did not emit version 7 UUID: %', u;
    END IF;
    IF substr(u::text, 20, 1) NOT IN ('8','9','a','b') THEN
        RAISE EXCEPTION 'D10-1 verification failed: UUID variant invalid: %', u;
    END IF;
END $$;

DO $$
DECLARE
    inst_id uuid;
    actor_id_ uuid;
    owner_id_ uuid;
    account_id_ uuid;
    instrument_id_ uuid;
    bucket_id_ uuid;
BEGIN
    INSERT INTO ref.institution (
        institution_code, display_name, institution_type, country_code
    ) VALUES (
        '__D10_TEST__', 'D10 Test Institution', 'BANK', 'IN'
    ) RETURNING institution_id INTO inst_id;

    INSERT INTO core.authenticated_actor (
        actor_type, auth_provider, auth_subject, email
    ) VALUES (
        'HUMAN', 'TEST', 'd10-1-smoke-subject', 'd10-1@example.invalid'
    ) RETURNING actor_id INTO actor_id_;

    INSERT INTO core.owner (
        owner_type, display_name, default_currency_code, timezone_name
    ) VALUES (
        'PERSON', 'D10-1 Smoke Owner', 'INR', 'Asia/Kolkata'
    ) RETURNING owner_id INTO owner_id_;

    INSERT INTO core.actor_owner_membership (
        actor_id, owner_id, membership_role, membership_status, is_default_owner
    ) VALUES (
        actor_id_, owner_id_, 'OWNER', 'ACTIVE', true
    );

    INSERT INTO core.financial_account (
        institution_id, account_type, account_display_name,
        masked_identifier, provider_account_reference,
        base_currency_code, lifecycle_status
    ) VALUES (
        inst_id, 'SAVINGS', 'Smoke Savings', 'XXXX1234', 'D10_TEST_ACCOUNT_001',
        'INR', 'ACTIVE'
    ) RETURNING financial_account_id INTO account_id_;

    INSERT INTO core.account_ownership (
        owner_id, financial_account_id, relationship_role,
        verification_state, relationship_status, verification_source
    ) VALUES (
        owner_id_, account_id_, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE', 'D10-1_SMOKE'
    );

    INSERT INTO core.financial_account_instrument (
        financial_account_id, instrument_type, masked_identifier, status
    ) VALUES (
        account_id_, 'PHYSICAL_CARD', 'XXXX5678', 'ACTIVE'
    ) RETURNING instrument_id INTO instrument_id_;

    INSERT INTO core.account_currency_bucket (
        financial_account_id, currency_code, provider_bucket_reference, status
    ) VALUES (
        account_id_, 'INR', 'D10_TEST_BUCKET_INR', 'ACTIVE'
    ) RETURNING account_currency_bucket_id INTO bucket_id_;

    IF NOT EXISTS (
        SELECT 1
        FROM core.v_current_owner_account
        WHERE owner_id = owner_id_
          AND financial_account_id = account_id_
          AND is_current_active = true
    ) THEN
        RAISE EXCEPTION 'D10-1 verification failed: current owner/account view did not return smoke account';
    END IF;

    IF substr(actor_id_::text, 15, 1) <> '7'
       OR substr(owner_id_::text, 15, 1) <> '7'
       OR substr(account_id_::text, 15, 1) <> '7'
       OR substr(instrument_id_::text, 15, 1) <> '7'
       OR substr(bucket_id_::text, 15, 1) <> '7' THEN
        RAISE EXCEPTION 'D10-1 verification failed: one or more vNext PKs are not UUIDv7';
    END IF;
END $$;

DO $$
DECLARE
    required_tables text[] := ARRAY[
        'ops.schema_migration',
        'ref.institution',
        'core.authenticated_actor',
        'core.owner',
        'core.actor_owner_membership',
        'core.financial_account',
        'core.financial_account_instrument',
        'core.account_ownership',
        'core.account_currency_bucket'
    ];
    t text;
BEGIN
    FOREACH t IN ARRAY required_tables LOOP
        IF to_regclass(t) IS NULL THEN
            RAISE EXCEPTION 'D10-1 verification failed: missing relation %', t;
        END IF;
    END LOOP;
END $$;

-- Confirm migration record exists outside the smoke data.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM ops.schema_migration WHERE migration_code = 'D10-1'
    ) THEN
        RAISE EXCEPTION 'D10-1 verification failed: schema migration ledger does not contain D10-1';
    END IF;
END $$;

ROLLBACK;

SELECT 'D10-1 verification passed' AS result;
