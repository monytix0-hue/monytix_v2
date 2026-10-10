-- M2.1 RLS and role checks. Test rows roll back. Run as the migration superuser
-- after 0004 and 0005. Application roles must not bypass RLS or insert the ledger.

BEGIN;

DO $$
DECLARE
    api_bypass boolean;
    intel_bypass boolean;
    owner_a uuid;
    owner_b uuid;
    account_a uuid;
    account_b uuid;
    logical_a uuid;
    logical_b uuid;
    visible integer;
BEGIN
    SELECT rolbypassrls INTO api_bypass FROM pg_roles WHERE rolname = 'monytix_api';
    SELECT rolbypassrls INTO intel_bypass FROM pg_roles WHERE rolname = 'monytix_intelligence';
    IF api_bypass IS DISTINCT FROM false OR intel_bypass IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'M2.1 verification failed: an application role bypasses RLS';
    END IF;

    IF to_regclass('core.logical_transaction') IS NULL
       OR to_regclass('core.transaction_evidence_link') IS NULL
       OR to_regclass('public.transactions') IS NULL THEN
        RAISE EXCEPTION 'M2.1 verification failed: required relations are missing';
    END IF;

    IF to_regclass('txn_fact') IS NOT NULL OR to_regclass('public.txn_fact') IS NOT NULL THEN
        RAISE EXCEPTION 'M2.1 verification failed: txn_fact exists';
    END IF;

    INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', 'M2 Owner A') RETURNING owner_id INTO owner_a;
    INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', 'M2 Owner B') RETURNING owner_id INTO owner_b;

    INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
    VALUES ('SAVINGS', 'Account A', 'INR', 'ACTIVE') RETURNING financial_account_id INTO account_a;
    INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
    VALUES ('SAVINGS', 'Account B', 'INR', 'ACTIVE') RETURNING financial_account_id INTO account_b;

    INSERT INTO core.account_ownership (
        owner_id, financial_account_id, relationship_role, verification_state, relationship_status, verification_source
    ) VALUES
        (owner_a, account_a, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE', 'M2-1_RLS'),
        (owner_b, account_b, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE', 'M2-1_RLS');

    INSERT INTO core.logical_transaction (financial_account_id) VALUES (account_a) RETURNING logical_transaction_id INTO logical_a;
    INSERT INTO core.logical_transaction (financial_account_id) VALUES (account_b) RETURNING logical_transaction_id INTO logical_b;

    EXECUTE 'SET LOCAL ROLE monytix_api';
    PERFORM set_config('app.owner_id', owner_a::text, true);

    SELECT count(*) INTO visible FROM core.logical_transaction WHERE logical_transaction_id = logical_b;
    IF visible <> 0 THEN
        RAISE EXCEPTION 'M2.1 verification failed: owner A can read owner B logical transaction';
    END IF;

    SELECT count(*) INTO visible FROM core.logical_transaction WHERE logical_transaction_id = logical_a;
    IF visible <> 1 THEN
        RAISE EXCEPTION 'M2.1 verification failed: owner A cannot read its own logical transaction';
    END IF;

    RESET ROLE;

    BEGIN
        EXECUTE 'SET LOCAL ROLE monytix_intelligence';
        INSERT INTO core.logical_transaction (financial_account_id) VALUES (account_a);
        RAISE EXCEPTION 'M2.1 verification failed: monytix_intelligence inserted core.logical_transaction';
    EXCEPTION
        WHEN insufficient_privilege THEN
            NULL;
    END;
END $$;

ROLLBACK;

SELECT 'M2.1 RLS verification passed' AS result;
