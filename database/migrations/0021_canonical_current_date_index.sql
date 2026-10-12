-- The transaction list was sorting every current row before applying LIMIT.
-- This index lets an owner page start from account and date order.
-- Does not edit migrations 0001-0020.

BEGIN;

CREATE INDEX IF NOT EXISTS ix_canonical_current_account_date
    ON core.canonical_transaction_version (financial_account_id, transaction_date DESC, logical_transaction_id DESC)
    WHERE is_current AND duplicate_outcome <> 'EQUIVALENT_SUPERSEDED';

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'M3-20-CURRENT-DATE-INDEX',
    'Current transaction date index',
    'ledger-read-v0.1',
    'ix-canonical-current-account-date',
    'Supports owner-scoped transaction pages ordered by date without sorting superseded rows.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
