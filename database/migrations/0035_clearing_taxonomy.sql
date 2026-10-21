-- Categories used when a narration is a rail, a fee, or a named counterparty
-- after clearing and forex boilerplate is removed.

BEGIN;

INSERT INTO ref.taxonomy_category (taxonomy_version, category_code, display_name) VALUES
    ('F10E-v1.2', 'PAYMENTS', 'Payments'),
    ('F10E-v1.2', 'TRANSFER', 'Transfer'),
    ('F10E-v1.2', 'OTHER_PAYMENT', 'Other Payment'),
    ('F10E-v1.2', 'BANK_FEES', 'Bank Fees'),
    ('F10E-v1.2', 'TECHNOLOGY_SERVICES', 'Technology Services')
ON CONFLICT (taxonomy_version, category_code) DO NOTHING;

INSERT INTO ref.taxonomy_subcategory (taxonomy_version, category_code, subcategory_code, display_name) VALUES
    ('F10E-v1.2', 'PAYMENTS', 'MERCHANT_SETTLEMENT', 'Merchant settlement'),
    ('F10E-v1.2', 'TRANSFER', 'PEER_TO_PEER', 'Peer to peer'),
    ('F10E-v1.2', 'OTHER_PAYMENT', 'MISCELLANEOUS', 'Miscellaneous'),
    ('F10E-v1.2', 'OTHER_PAYMENT', 'INTERNATIONAL_SPEND', 'International spend'),
    ('F10E-v1.2', 'BANK_FEES', 'FOREX_MARKUP', 'Forex markup'),
    ('F10E-v1.2', 'BANK_FEES', 'TAXES_AND_SURCHARGES', 'Taxes and surcharges'),
    ('F10E-v1.2', 'TECHNOLOGY_SERVICES', 'SOFTWARE_SUBSCRIPTIONS', 'Software subscriptions'),
    ('F10E-v1.2', 'TRAVEL', 'DUTY_FREE', 'Duty free')
ON CONFLICT (taxonomy_version, subcategory_code) DO NOTHING;

UPDATE finance.ledger_transactions
   SET clean_merchant = 'Merchant Payment',
       category_id = 'PAYMENTS',
       subcategory_id = 'MERCHANT_SETTLEMENT'
 WHERE owner_id = '01a14e15-95a1-7630-9ead-c6985e5f7b76'
   AND clean_merchant = 'P2m Transactions Above Deferred';

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'CLEARING-TAXONOMY',
    'Clearing, transfer, and forex fee categories',
    'finance-v0.1',
    'clearing-taxonomy',
    'Merchant cascade labels for NPCI settlement, peer transfers, and forex fees.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
