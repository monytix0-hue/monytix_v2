-- Parent link for forex markup and GST lines. The import writes the rows.
-- Reconciliation runs after commit.

BEGIN;

ALTER TABLE finance.ledger_transactions
    ADD COLUMN parent_transaction_id uuid REFERENCES finance.ledger_transactions(id) ON DELETE SET NULL,
    ADD COLUMN fee_role varchar(32) NOT NULL DEFAULT 'BASE',
    ADD CONSTRAINT ck_ledger_fee_role CHECK (fee_role IN ('BASE', 'FCY_MARKUP', 'GST_TAX', 'OTHER_SURCHARGE'));

CREATE INDEX idx_ledger_parent_lookup
    ON finance.ledger_transactions (parent_transaction_id)
    WHERE parent_transaction_id IS NOT NULL;

CREATE INDEX idx_ledger_unlinked_fees
    ON finance.ledger_transactions (account_id, posted_at, fee_role)
    WHERE parent_transaction_id IS NULL AND fee_role <> 'BASE';

UPDATE finance.ledger_transactions
   SET fee_role = 'FCY_MARKUP'
 WHERE subcategory_id = 'FOREX_MARKUP';

UPDATE finance.ledger_transactions
   SET fee_role = 'GST_TAX'
 WHERE subcategory_id = 'TAXES_AND_SURCHARGES';

CREATE OR REPLACE FUNCTION finance.link_forex_fees(p_owner uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
    linked integer := 0;
    changed integer := 0;
BEGIN
    WITH matched_by_ref AS (
        SELECT DISTINCT ON (fee.id)
               fee.id AS fee_id,
               base.id AS base_id
          FROM finance.ledger_transactions fee
          JOIN finance.ledger_transactions base
            ON fee.account_id = base.account_id
           AND fee.owner_id = base.owner_id
           AND fee.id <> base.id
           AND base.fee_role = 'BASE'
           AND fee.fee_role IN ('FCY_MARKUP', 'GST_TAX')
           AND fee.parent_transaction_id IS NULL
           AND (p_owner IS NULL OR fee.owner_id = p_owner)
           AND (
                (base.payment_ref IS NOT NULL
                 AND length(base.payment_ref) >= 6
                 AND position(lower(base.payment_ref) IN lower(fee.raw_narration)) > 0)
             OR (fee.payment_ref IS NOT NULL AND fee.payment_ref = base.payment_ref)
           )
         ORDER BY fee.id, abs(extract(epoch FROM (fee.posted_at - base.posted_at)))
    )
    UPDATE finance.ledger_transactions lt
       SET parent_transaction_id = matched.base_id
      FROM matched_by_ref matched
     WHERE lt.id = matched.fee_id
       AND lt.parent_transaction_id IS NULL;
    GET DIAGNOSTICS changed = ROW_COUNT;
    linked := linked + changed;

    WITH candidate_pairs AS (
        SELECT fee.id AS fee_id,
               base.id AS base_id,
               row_number() OVER (
                   PARTITION BY fee.id
                   ORDER BY abs(extract(epoch FROM (fee.posted_at - base.posted_at)))
               ) AS rank_order
          FROM finance.ledger_transactions fee
          JOIN finance.ledger_transactions base
            ON fee.account_id = base.account_id
           AND fee.owner_id = base.owner_id
           AND fee.id <> base.id
           AND base.fee_role = 'BASE'
           AND fee.parent_transaction_id IS NULL
           AND (p_owner IS NULL OR fee.owner_id = p_owner)
           AND fee.posted_at >= base.posted_at
           AND fee.posted_at <= base.posted_at + interval '3 days'
           AND (
                base.subcategory_id IN ('INTERNATIONAL_SPEND', 'SOFTWARE_SUBSCRIPTIONS', 'DUTY_FREE')
             OR base.raw_narration ~* '\m(USD|EUR|GBP|SGD|AED|THB|JPY|AUD|CAD)\M'
           )
         WHERE (fee.fee_role = 'FCY_MARKUP' AND fee.amount BETWEEN (base.amount * 0.018) AND (base.amount * 0.0365))
            OR (fee.fee_role = 'GST_TAX' AND fee.amount BETWEEN (base.amount * 0.018 * 0.18) AND (base.amount * 0.0365 * 0.18))
    )
    UPDATE finance.ledger_transactions lt
       SET parent_transaction_id = pair.base_id
      FROM candidate_pairs pair
     WHERE lt.id = pair.fee_id
       AND pair.rank_order = 1
       AND lt.parent_transaction_id IS NULL;
    GET DIAGNOSTICS changed = ROW_COUNT;
    linked := linked + changed;
    RETURN linked;
END;
$$;

REVOKE ALL ON FUNCTION finance.link_forex_fees(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.link_forex_fees(uuid) TO monytix_api, monytix_finance;

CREATE OR REPLACE VIEW finance.v_landed_international_transactions
WITH (security_invoker = true) AS
SELECT base.id AS transaction_id,
       base.owner_id,
       base.account_id,
       base.posted_at,
       base.clean_merchant,
       base.amount AS base_amount_inr,
       COALESCE(SUM(markup.amount), 0) AS fcy_markup_inr,
       COALESCE(SUM(tax.amount), 0) AS gst_tax_inr,
       base.amount + COALESCE(SUM(markup.amount), 0) + COALESCE(SUM(tax.amount), 0) AS total_landed_cost_inr
  FROM finance.ledger_transactions base
  LEFT JOIN finance.ledger_transactions markup
    ON markup.parent_transaction_id = base.id
   AND markup.fee_role = 'FCY_MARKUP'
  LEFT JOIN finance.ledger_transactions tax
    ON tax.parent_transaction_id = base.id
   AND tax.fee_role = 'GST_TAX'
 WHERE base.fee_role = 'BASE'
 GROUP BY base.id, base.owner_id, base.account_id, base.posted_at, base.clean_merchant, base.amount;

GRANT SELECT ON finance.v_landed_international_transactions TO monytix_api, monytix_finance;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'LEDGER-FEE-PARENT',
    'Parent link for forex markup and GST lines',
    'finance-v0.1',
    'ledger-fee-parent',
    'Fee rows stay in the ledger. Reconciliation links them after the import commits.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
