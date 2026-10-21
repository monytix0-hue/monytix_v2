-- Extra card, mandate, and cheque rails, plus the brand subcategories.

BEGIN;

ALTER TABLE finance.ledger_transactions DROP CONSTRAINT ck_ledger_channel;
ALTER TABLE finance.ledger_transactions
    ADD CONSTRAINT ck_ledger_channel CHECK (
        channel IN (
            'UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD_POS', 'CARD_ECOMMERCE',
            'ATM', 'ACH', 'ACH_NACH', 'CHEQUE', 'CARD', 'FT', 'OTHER'
        )
    );

INSERT INTO ref.taxonomy_subcategory (taxonomy_version, category_code, subcategory_code, display_name) VALUES
    ('F10E-v1.2', 'FOOD_DINING', 'GROCERIES_SUPERMARKET', 'Groceries and supermarket'),
    ('F10E-v1.2', 'MOBILITY_TRANSPORT', 'TRANSIT_CABS', 'Cabs and ride hail'),
    ('F10E-v1.2', 'MOBILITY_TRANSPORT', 'TRANSIT_FUEL', 'Fuel'),
    ('F10E-v1.2', 'TRAVEL', 'TRAVEL_RAILWAYS', 'Railways'),
    ('F10E-v1.2', 'TRAVEL', 'AIRLINE_TRAVEL', 'Flights and hotels'),
    ('F10E-v1.2', 'SHOPPING_RETAIL', 'ECOMMERCE', 'E-commerce'),
    ('F10E-v1.2', 'ENTERTAINMENT_MEDIA', 'STREAMING_SUBSCRIPTIONS', 'Streaming subscriptions'),
    ('F10E-v1.2', 'UTILITIES_COMMUNICATION', 'MOBILE_INTERNET', 'Mobile and internet'),
    ('F10E-v1.2', 'HEALTH_MEDICAL', 'PHARMACY', 'Pharmacy')
ON CONFLICT (taxonomy_version, subcategory_code) DO NOTHING;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'LEDGER-CHANNELS',
    'Card, mandate, and cheque rails plus brand subcategories',
    'finance-v0.1',
    'ledger-channels',
    'Rail detection writes these channel codes. Brand matches use the new subcategories.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
