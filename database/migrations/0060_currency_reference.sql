-- The ledger can already hold any ISO 4217 currency in `core.canonical_transaction_version`.
-- What it could not do is *format* one: both apps hard-coded rupee glyphs, `en_IN`
-- grouping and two decimals, and the `₹` check in the decisions screens short-circuited
-- any amount that already carried a symbol. This migration gives the clients a table to
-- read formatting facts from, so a new currency is data rather than an app release.
--
-- What lives here and what does not:
--   * `minor_units` is the ISO 4217 exponent (JPY 0, USD 2, KWD 3). It is not a display
--     preference; it is how many digits a stored `numeric(20,4)` value has in this currency.
--   * `group_sizes` is the *habitual* grouping, read right to left. Indian lakh grouping is
--     `{2,2,3}`; most of the world is `{3}`. It is `NULL` for currencies that do not group.
--   * `symbol` is only a fallback. The apps use the platform's own CLDR data first, because
--     a `NumberFormatter` already knows `en_GB` writes `£1,234.56` and `de_DE` writes
--     `1.234,56 €`. The symbol is here for the server-side evidence strings and for a
--     client whose locale has no CLDR entry.
--
-- The version is the ISO 4217 list as of 2026. A currency that appears in a mailbox but
-- not here is not rejected: `monetary` is `false` on this table only for the non-currency
-- codes some feeds use (`XXX`), and every reader treats an unknown code as two decimals
-- with a bare text fallback rather than refusing to render it.

BEGIN;

CREATE TABLE IF NOT EXISTS ref.currency (
    currency_code   char(3) PRIMARY KEY,
    display_name    text NOT NULL,
    symbol          text,
    minor_units     smallint NOT NULL DEFAULT 2,
    -- Grouping widths, right to left. `{3}` is thousands; `{2,2,3}` is lakh/crore.
    group_sizes     smallint[],
    -- What the number is grouped by, for a client that has no CLDR locale.
    decimal_separator text NOT NULL DEFAULT '.',
    group_separator   text NOT NULL DEFAULT ',',
    -- False only for placeholder codes; every real ISO code is true.
    monetary        boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_ref_currency_code CHECK (currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_ref_currency_minor CHECK (minor_units BETWEEN 0 AND 4),
    CONSTRAINT ck_ref_currency_groups CHECK (
        group_sizes IS NULL OR (array_length(group_sizes, 1) BETWEEN 1 AND 4)
    )
);

INSERT INTO ref.currency (currency_code, display_name, symbol, minor_units, group_sizes) VALUES
    ('INR', 'Indian Rupee',              '₹',  2, '{2,2,3}'),
    ('USD', 'US Dollar',                '$',  2, '{3}'),
    ('EUR', 'Euro',                     '€',  2, '{3}'),
    ('GBP', 'Pound Sterling',           '£',  2, '{3}'),
    ('JPY', 'Japanese Yen',             '¥',  0, '{3}'),
    ('CNY', 'Chinese Yuan',             '¥',  2, '{3}'),
    ('KRW', 'South Korean Won',         '₩',  0, '{3}'),
    ('AUD', 'Australian Dollar',        'A$', 2, '{3}'),
    ('CAD', 'Canadian Dollar',          'C$', 2, '{3}'),
    ('NZD', 'New Zealand Dollar',       'NZ$',2, '{3}'),
    ('SGD', 'Singapore Dollar',         'S$', 2, '{3}'),
    ('HKD', 'Hong Kong Dollar',         'HK$',2, '{3}'),
    ('CHF', 'Swiss Franc',              'CHF',2, '{3}'),
    ('SEK', 'Swedish Krona',            'kr', 2, '{3}'),
    ('NOK', 'Norwegian Krone',          'kr', 2, '{3}'),
    ('DKK', 'Danish Krone',             'kr', 2, '{3}'),
    ('PLN', 'Polish Zloty',             'zł', 2, '{3}'),
    ('CZK', 'Czech Koruna',             'Kč', 2, '{3}'),
    ('HUF', 'Hungarian Forint',         'Ft', 2, '{3}'),
    ('RON', 'Romanian Leu',             'lei',2, '{3}'),
    ('TRY', 'Turkish Lira',             '₺',  2, '{3}'),
    ('RUB', 'Russian Ruble',            '₽',  2, '{3}'),
    ('UAH', 'Ukrainian Hryvnia',        '₴',  2, '{3}'),
    ('ILS', 'Israeli New Shekel',       '₪',  2, '{3}'),
    ('AED', 'UAE Dirham',               'AED',2, '{3}'),
    ('SAR', 'Saudi Riyal',              'SAR',2, '{3}'),
    ('QAR', 'Qatari Riyal',             'QAR',2, '{3}'),
    ('KWD', 'Kuwaiti Dinar',            'KWD',3, '{3}'),
    ('BHD', 'Bahraini Dinar',           'BHD',3, '{3}'),
    ('OMR', 'Omani Rial',               'OMR',3, '{3}'),
    ('EGP', 'Egyptian Pound',           'E£', 2, '{3}'),
    ('ZAR', 'South African Rand',       'R',  2, '{3}'),
    ('NGN', 'Nigerian Naira',           '₦',  2, '{3}'),
    ('KES', 'Kenyan Shilling',          'KSh',2, '{3}'),
    ('GHS', 'Ghanaian Cedi',            '₵',  2, '{3}'),
    ('MAD', 'Moroccan Dirham',          'MAD',2, '{3}'),
    ('PKR', 'Pakistani Rupee',          '₨',  2, '{3}'),
    ('BDT', 'Bangladeshi Taka',         '৳',  2, '{3}'),
    ('LKR', 'Sri Lankan Rupee',         'Rs', 2, '{3}'),
    ('NPR', 'Nepalese Rupee',           'Rs', 2, '{3}'),
    ('MUR', 'Mauritian Rupee',          'Rs', 2, '{3}'),
    ('THB', 'Thai Baht',                '฿',  2, '{3}'),
    ('VND', 'Vietnamese Dong',          '₫',  0, '{3}'),
    ('IDR', 'Indonesian Rupiah',        'Rp', 2, '{3}'),
    ('MYR', 'Malaysian Ringgit',        'RM', 2, '{3}'),
    ('PHP', 'Philippine Peso',          '₱',  2, '{3}'),
    ('TWD', 'New Taiwan Dollar',        'NT$',2, '{3}'),
    ('BRL', 'Brazilian Real',           'R$', 2, '{3}'),
    ('MXN', 'Mexican Peso',             'MX$',2, '{3}'),
    ('ARS', 'Argentine Peso',           'AR$',2, '{3}'),
    ('CLP', 'Chilean Peso',             'CL$',0, '{3}'),
    ('COP', 'Colombian Peso',           'CO$',2, '{3}'),
    ('PEN', 'Peruvian Sol',             'S/', 2, '{3}'),
    ('XXX', 'No currency',              NULL, 2, NULL)
ON CONFLICT (currency_code) DO UPDATE
SET display_name  = EXCLUDED.display_name,
    symbol        = EXCLUDED.symbol,
    minor_units   = EXCLUDED.minor_units,
    group_sizes   = EXCLUDED.group_sizes;

UPDATE ref.currency SET monetary = false WHERE currency_code = 'XXX';

GRANT SELECT ON ref.currency TO monytix_api, monytix_finance, monytix_intelligence;

-- The client cannot guess how to render a code that is not in the table, and neither
-- can the server. Warn loudly at migration time if the seeded `ref.institution` banks
-- name a country whose currency is missing, because that is exactly the case where a
-- `$` alert would otherwise fall back to the owner default.
DO $currency_check$
DECLARE
    v_missing text;
BEGIN
    SELECT string_agg(wanted.code, ', ' ORDER BY wanted.code)
      INTO v_missing
      FROM (VALUES ('INR'), ('USD'), ('GBP'), ('EUR'), ('AED'), ('SGD'), ('AUD'), ('CAD'), ('BRL'), ('JPY')) AS wanted(code)
     WHERE NOT EXISTS (SELECT 1 FROM ref.currency c WHERE c.currency_code = wanted.code);
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'seeded currencies missing from ref.currency: %', v_missing;
    END IF;

    -- Every currency an account or a canonical row actually holds must be formattable.
    SELECT string_agg(DISTINCT held.code, ', ' ORDER BY held.code)
      INTO v_missing
      FROM (
        SELECT upper(btrim(base_currency_code)) AS code FROM core.financial_account
        UNION
        SELECT upper(btrim(currency_code)) FROM core.canonical_transaction_version WHERE currency_code IS NOT NULL
        UNION
        SELECT upper(btrim(original_currency_code)) FROM core.canonical_transaction_version WHERE original_currency_code IS NOT NULL
        UNION
        SELECT upper(btrim(stated_currency_code)) FROM core.gmail_spot_transaction WHERE stated_currency_code IS NOT NULL
      ) held
     WHERE held.code ~ '^[A-Z]{3}$'
       AND NOT EXISTS (SELECT 1 FROM ref.currency c WHERE c.currency_code = held.code);
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'ledger holds currencies with no ref.currency row: %', v_missing;
    END IF;
END;
$currency_check$;

INSERT INTO ops.schema_migration (
    migration_code, migration_name, architecture_version, checksum_hint, notes
) VALUES (
    'CURRENCY-REFERENCE',
    'ref.currency carries minor units, symbol and grouping so clients format from data',
    'OQ-11-open',
    'currency-reference',
    'Adds the ISO 4217 formatting facts both apps read. The clients still prefer platform CLDR; this table is the fallback and the server-side evidence source.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
