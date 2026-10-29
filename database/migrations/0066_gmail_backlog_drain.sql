-- Promote the alerts stranded by 0056, but only the ones that are safe to trust.
--
-- 0056 dropped gmail_spot_transaction_id from save_gmail_spot_transaction, so the
-- worker never promoted anything after 2026-10-28 14:42. 380 alerts accumulated in
-- the staging table. This file drains them.
--
-- It deliberately does NOT drain all of them.
--
-- Inspecting the backlog showed the staging table also caught marketing mail and
-- corporate notices as if they were transactions. The worst offenders carried no
-- account reference at all, because there was no bank alert to take one from:
--
--     INR 67,402,000   "the Forty-ninth Annual General Meeting (Post-"
--     INR 14,213,238   "the ICICI Direct platform"
--     INR    532,494   "find the perfect payment solution"
--
-- Across the unmasked backlog the parsed total was about 8.6 crore, which is more
-- than an order of magnitude above the masked rows' 6.5 lakh. Promoting that would
-- put phantom spend into the owner's ledger, totals, and insights -- silently, and
-- with no review row to flag it, because a promoted row looks exactly like a real
-- one. A ledger that is visibly incomplete is far less harmful than one that is
-- confidently wrong.
--
-- So the gate is evidence, not confidence:
--
--   * account_last4 must be present. A bank alert naming the account it debited is
--     the only cheap proof that the mail was an alert and not prose.
--   * amount must be positive and below a sanity ceiling. The ceiling is generous
--     (1 crore) -- it is a guard against a mis-parsed sentence, not a spending cap.
--   * currency must be one the detector could justify: either an explicit ISO code
--     in the mail, or the owner's own default. A guessed currency from a bare "$"
--     is not enough to book money.
--
-- Everything else stays staged, and stays visible: the ledger's uncertain-currency
-- and needs-review rows are driven by the spot table, so a stranded row is a
-- backlog an operator can see, whereas a wrong promotion is invisible forever.

BEGIN;

-- The rows this file will promote, captured once so the report and the promotion
-- act on exactly the same set.
CREATE TEMP TABLE backfill_target ON COMMIT DROP AS
SELECT s.gmail_spot_transaction_id
  FROM core.gmail_spot_transaction s
 WHERE s.logical_transaction_id IS NULL
   AND s.account_last4 IS NOT NULL
   AND s.amount > 0
   AND s.amount <= 10000000
   AND coalesce(s.currency_basis, '') IN ('EXPLICIT_ISO', 'UNAMBIGUOUS_SYMBOL', 'OWNER_DEFAULT')
   -- A row whose currency disagrees with the account it names cannot be booked
   -- without an FX rate, and the account is the truth. Leave it for review.
   AND EXISTS (
       SELECT 1
         FROM core.account_ownership o
         JOIN core.financial_account a ON a.financial_account_id = o.financial_account_id
        WHERE o.owner_id = s.owner_id
          AND o.relationship_status = 'ACTIVE'
          AND o.effective_to IS NULL
          AND o.verification_state <> 'REVOKED'
          AND a.lifecycle_status = 'ACTIVE'
          AND a.masked_identifier = s.account_last4
          AND btrim(a.base_currency_code) = btrim(s.currency_code)
   );

DO $drain$
DECLARE
    v_id uuid;
    v_ok integer := 0;
    v_failed integer := 0;
    v_first_error text;
BEGIN
    FOR v_id IN SELECT gmail_spot_transaction_id FROM backfill_target ORDER BY gmail_spot_transaction_id LOOP
        BEGIN
            PERFORM ops.promote_gmail_spot(v_id);
            v_ok := v_ok + 1;
        EXCEPTION WHEN OTHERS THEN
            -- One malformed alert must not abort the run. Record the first failure
            -- so a systemic break is still visible in the migration output.
            v_failed := v_failed + 1;
            IF v_first_error IS NULL THEN
                v_first_error := v_id::text || ': ' || SQLERRM;
            END IF;
        END;
    END LOOP;

    IF v_failed > 0 THEN
        RAISE WARNING 'gmail backlog: % promoted, % failed (first: %)', v_ok, v_failed, v_first_error;
    ELSE
        RAISE NOTICE 'gmail backlog: % promoted', v_ok;
    END IF;
END;
$drain$;

-- Every targeted row must now be linked. A silent partial run would look like a
-- clean drain, which is precisely the class of bug this file exists to undo.
DO $check$
DECLARE
    v_left integer;
BEGIN
    SELECT count(*) INTO v_left
      FROM backfill_target t
      JOIN core.gmail_spot_transaction s USING (gmail_spot_transaction_id)
     WHERE s.logical_transaction_id IS NULL;

    IF v_left > 0 THEN
        RAISE EXCEPTION 'gmail backlog: % targeted rows were not promoted', v_left;
    END IF;
END;
$check$;

INSERT INTO ops.schema_migration (
    migration_code, migration_name, architecture_version, checksum_hint, notes
) VALUES (
    'GMAIL-BACKLOG-DRAIN',
    'Promote the evidence-backed alerts stranded by 0056, leaving prose staged',
    'D10.1',
    'gmail-backlog-drain',
    'Drains staged spot alerts that name an account, carry a positive amount, and have a justified currency. Unmasked rows are deliberately left staged: the backlog contained marketing mail and AGM notices parsed as transactions, totalling about 8.6 crore.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
