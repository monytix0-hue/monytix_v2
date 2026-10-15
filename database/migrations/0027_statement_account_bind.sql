-- Bind a statement to one owned account before mapping.
-- Zero accounts creates one personal INR account. More than one stays unbound.
-- An earlier ACCOUNT_UNRESOLVED disposition can be cleared so mapping can run again.

BEGIN;

CREATE OR REPLACE FUNCTION ops.bind_statement_for_mapping(p_document uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $bind$
DECLARE
    v_owner uuid;
    v_count integer;
    v_account uuid;
    v_currency char(3);
    v_instance uuid;
    v_resolved uuid;
BEGIN
    SELECT owner_id INTO v_owner
      FROM core.source_document
     WHERE source_document_id = p_document
     FOR UPDATE;
    IF v_owner IS NULL THEN
        RETURN 'missing';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('monytix-statement-account:' || v_owner::text, 0));

    SELECT statement_instance_id INTO v_resolved
      FROM core.statement_instance
     WHERE source_document_id = p_document
       AND account_resolution_status = 'RESOLVED'
       AND financial_account_id IS NOT NULL
     LIMIT 1;
    IF v_resolved IS NOT NULL THEN
        PERFORM ops.clear_unresolved_statement_dispositions(p_document);
        RETURN 'bound';
    END IF;

    SELECT count(*)::int INTO v_count
      FROM core.account_ownership o
      JOIN core.financial_account a ON a.financial_account_id = o.financial_account_id
     WHERE o.owner_id = v_owner
       AND o.relationship_status = 'ACTIVE'
       AND o.effective_to IS NULL
       AND o.verification_state <> 'REVOKED'
       AND a.lifecycle_status = 'ACTIVE';
    IF v_count > 1 THEN
        RETURN 'ambiguous';
    END IF;

    IF v_count = 1 THEN
        SELECT a.financial_account_id, a.base_currency_code
          INTO v_account, v_currency
          FROM core.account_ownership o
          JOIN core.financial_account a ON a.financial_account_id = o.financial_account_id
         WHERE o.owner_id = v_owner
           AND o.relationship_status = 'ACTIVE'
           AND o.effective_to IS NULL
           AND o.verification_state <> 'REVOKED'
           AND a.lifecycle_status = 'ACTIVE';
    ELSE
        INSERT INTO core.financial_account (
            account_type, account_display_name, base_currency_code, lifecycle_status, metadata
        ) VALUES (
            'SAVINGS', 'Personal account', 'INR', 'ACTIVE',
            jsonb_build_object('binding_version', 'M2.10-v1', 'bound_by', 'statement_import')
        ) RETURNING financial_account_id, base_currency_code INTO v_account, v_currency;
        INSERT INTO core.account_ownership (
            owner_id, financial_account_id, relationship_role, verification_state, relationship_status
        ) VALUES (
            v_owner, v_account, 'PRIMARY_HOLDER', 'DECLARED', 'ACTIVE'
        );
    END IF;

    SELECT statement_instance_id INTO v_instance
      FROM core.statement_instance
     WHERE source_document_id = p_document
     ORDER BY created_at
     LIMIT 1;
    IF v_instance IS NULL THEN
        INSERT INTO core.statement_instance (
            source_document_id, financial_account_id, currency_code,
            account_resolution_status, statement_status, metadata
        ) VALUES (
            p_document, v_account, coalesce(v_currency, 'INR'),
            'RESOLVED', 'PARTIAL',
            jsonb_build_object('binding_version', 'M2.10-v1', 'bound_by', 'statement_import')
        );
    ELSE
        UPDATE core.statement_instance
           SET financial_account_id = v_account,
               currency_code = coalesce(v_currency, currency_code, 'INR'),
               account_resolution_status = 'RESOLVED',
               metadata = metadata || jsonb_build_object('binding_version', 'M2.10-v1', 'bound_by', 'statement_import')
         WHERE statement_instance_id = v_instance;
    END IF;

    PERFORM ops.clear_unresolved_statement_dispositions(p_document);
    RETURN 'bound';
END;
$bind$;

CREATE OR REPLACE FUNCTION ops.clear_unresolved_statement_dispositions(p_document uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $clear$
BEGIN
    DELETE FROM core.source_record_disposition d
     USING core.source_record r, core.extraction_run er
     WHERE d.source_record_id = r.source_record_id
       AND r.extraction_run_id = er.extraction_run_id
       AND er.source_document_id = p_document
       AND d.outcome = 'REVIEW_REQUIRED'
       AND d.reason_codes = ARRAY['ACCOUNT_UNRESOLVED']::text[];
END;
$clear$;

REVOKE ALL ON FUNCTION ops.bind_statement_for_mapping(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.clear_unresolved_statement_dispositions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.bind_statement_for_mapping(uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.clear_unresolved_statement_dispositions(uuid) TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'STATEMENT-ACCOUNT-BIND',
    'Bind one personal account before a statement is mapped',
    'D10 v1.2 FINAL FREEZE',
    'M2.10-v1',
    'Zero accounts creates one INR savings account. More than one account stays unbound. ACCOUNT_UNRESOLVED dispositions can be cleared.'
)
ON CONFLICT (migration_code) DO UPDATE SET notes = EXCLUDED.notes;

COMMIT;
