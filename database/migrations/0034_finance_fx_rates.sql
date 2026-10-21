-- Daily FX reference rates. Amounts stay in the original currency.
-- The API converts for display. Intelligence does not write this table.

BEGIN;

CREATE TABLE finance.fx_rates (
    rate_date   date NOT NULL,
    base_code   char(3) NOT NULL,
    quote_code  char(3) NOT NULL,
    rate        numeric(18, 8) NOT NULL CHECK (rate > 0),
    source      text NOT NULL,
    PRIMARY KEY (rate_date, base_code, quote_code)
);

GRANT SELECT, INSERT, UPDATE ON finance.fx_rates TO monytix_api, monytix_finance;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'FINANCE-FX-RATES',
    'ECB daily rates for display conversion',
    'finance-v0.1',
    'fx-rates',
    'Ledger rows keep their currency. Home reads convert with this table.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
