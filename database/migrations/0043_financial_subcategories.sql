-- Loan EMI and credit-card bill subcategories under FINANCIAL_SERVICES.

BEGIN;

INSERT INTO ref.taxonomy_subcategory (taxonomy_version, category_code, subcategory_code, display_name) VALUES
    ('F10E-v1.2', 'FINANCIAL_SERVICES', 'LOAN_EMI', 'Loan EMI and NBFC debits'),
    ('F10E-v1.2', 'FINANCIAL_SERVICES', 'CREDIT_CARD_BILL', 'Credit card bill payment')
ON CONFLICT (taxonomy_version, subcategory_code) DO NOTHING;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'FINANCIAL-SUBCATEGORIES',
    'Loan EMI and credit card bill subcategories',
    'finance-v0.1',
    'financial-subcategories',
    'Extends FINANCIAL_SERVICES for EMI and card-bill Decision OS classification.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
