-- Let the phone API name the weights already stored on recorded movements.

BEGIN;

GRANT EXECUTE ON FUNCTION ops.weight_display_names(text[]) TO monytix_api, monytix_finance;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'WEIGHT-DISPLAY-GRANT',
    'Allow the phone API to read weight display names',
    'OQ-11-open',
    'weight-display-grant',
    'Live groups recorded movements by the weight already stored on each one.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
