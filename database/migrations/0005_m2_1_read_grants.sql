-- M2.1 read grants for the D10-2 tables.
-- D10-2 creates SELECT policies and no GRANT. Writes stay an API concern for M2.2.
-- This file does not add columns, constraints, or write policies.

BEGIN;

GRANT SELECT ON
    ref.adapter_registry,
    core.source_connection,
    core.source_batch,
    core.source_document,
    core.document_set,
    core.document_set_member,
    core.statement_instance,
    core.statement_link,
    core.extraction_run,
    core.source_record,
    core.balance_snapshot,
    core.account_data_coverage,
    core.logical_transaction,
    core.canonical_transaction_version,
    core.transaction_evidence_link,
    core.v_current_canonical_transaction,
    core.v_source_document_processing_state
TO monytix_api;

REVOKE INSERT, UPDATE, DELETE ON
    ref.adapter_registry,
    core.source_connection,
    core.source_batch,
    core.source_document,
    core.document_set,
    core.document_set_member,
    core.statement_instance,
    core.statement_link,
    core.extraction_run,
    core.source_record,
    core.balance_snapshot,
    core.account_data_coverage,
    core.logical_transaction,
    core.canonical_transaction_version,
    core.transaction_evidence_link
FROM monytix_intelligence;

INSERT INTO ops.schema_migration (
    migration_code,
    migration_name,
    architecture_version,
    checksum_hint,
    notes
) VALUES (
    'M2-1-GRANTS',
    'D10-2 read grants',
    'D10 v1.2 FINAL FREEZE',
    'm2-1-select-only',
    'monytix_api may read D10-2 objects. monytix_intelligence cannot insert them. No write policy is added.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
