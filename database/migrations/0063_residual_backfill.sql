-- Apply ref.merchant_alias to the rows 0057 could not classify.
--
-- 0057 taught spendsense.classify_movement a long list of Indian merchant descriptors
-- and backfilled core.category_choice from it. It left 247 rows NULL. 0062 recorded a
-- reviewed mapping for the descriptors that are genuinely resolvable; this file applies
-- it, and nothing else.
--
-- Two deliberate non-goals:
--
--   * Parser defects stay NULL. HDFC's email footer ("report if this transaction was not
--     authorized by you") was extracted instead of the payee on 13 outflows worth about
--     2.08 lakh. Filing those under a plausible category would convert a visible gap
--     into an invisible wrong answer, so the pattern is asserted absent at the end.
--   * Rows that already carry a category are untouched. This only fills NULLs, so it is
--     safe to re-run after a later import adds rows.

BEGIN;

-- Longer patterns win, so a specific merchant ("SRI SAI TEJA") beats a broader person
-- pattern ("MALLA") without relying on the order rows happen to be inserted in.
CREATE TEMP TABLE residual_matched ON COMMIT DROP AS
WITH target AS (
    SELECT lt.logical_transaction_id,
           cv.direction,
           spendsense.clean_counterparty_name(cv.raw_description) AS clean,
           own.owner_id
      FROM core.canonical_transaction_version cv
      JOIN core.logical_transaction lt
        ON lt.logical_transaction_id = cv.logical_transaction_id
      JOIN LATERAL (
          SELECT o.owner_id
            FROM core.account_ownership o
           WHERE o.financial_account_id = lt.financial_account_id
             AND o.relationship_status = 'ACTIVE'
             AND o.effective_to IS NULL
           ORDER BY CASE WHEN o.relationship_role = 'PRIMARY_HOLDER' THEN 0 ELSE 1 END
           LIMIT 1
      ) own ON true
     WHERE cv.is_current
       AND lt.identity_status = 'ACTIVE'
       AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
       -- Only fill gaps: an explicit user choice, or any earlier resolution, wins.
       AND NOT EXISTS (
           SELECT 1 FROM core.category_choice c
            WHERE c.logical_transaction_id = lt.logical_transaction_id
       )
       AND NOT EXISTS (
           SELECT 1
             FROM intel.financial_event_resolution er
             JOIN intel.category_resolution cr
               ON cr.financial_event_resolution_id = er.financial_event_resolution_id
              AND cr.is_current
            WHERE er.logical_transaction_id = lt.logical_transaction_id
              AND er.canonical_transaction_version_id = cv.canonical_transaction_version_id
              AND er.is_current
       )
),
matched AS (
    SELECT t.logical_transaction_id,
           t.owner_id,
           t.clean,
           alias.category_code,
           alias.subcategory_code,
           alias.alias_pattern,
           alias.match_kind
      FROM target t
      JOIN LATERAL (
          SELECT a.category_code, a.subcategory_code, a.alias_pattern, a.match_kind
            FROM ref.merchant_alias a
           WHERE upper(t.clean) LIKE a.alias_pattern
           -- A person pattern describes somebody's contact, so it is only allowed to
           -- fire on the account that person actually pays into.
           AND (a.match_kind <> 'PERSON' OR t.owner_id IS NOT NULL)
           ORDER BY length(a.alias_pattern) DESC
           LIMIT 1
      ) alias ON true
)
SELECT DISTINCT ON (logical_transaction_id)
       owner_id,
       logical_transaction_id,
       category_code,
       subcategory_code,
       alias_pattern,
       left(btrim(clean), 180) AS match_token
  FROM matched
 ORDER BY logical_transaction_id;

INSERT INTO core.category_choice (
    owner_id, logical_transaction_id, category_code, subcategory_code, match_token, match_scope, is_explicit
)
SELECT owner_id,
       logical_transaction_id,
       category_code,
       subcategory_code,
       match_token,
       -- Same scope the classifier's own backfill used: derived, not user-asserted, so a
       -- later import is still free to overwrite it.
       'EXACT_MERCHANT',
       false
  FROM residual_matched
ON CONFLICT (logical_transaction_id) DO UPDATE
    SET category_code    = EXCLUDED.category_code,
        subcategory_code = EXCLUDED.subcategory_code,
        match_token      = EXCLUDED.match_token
  WHERE core.category_choice.is_explicit = false;

-- The weight each newly categorised movement contributes is derived, not stored by the
-- insert above. Driving the loop from the staging table keeps this exact rather than
-- relying on a time window that would drift on a slow run.
DO $weights$
DECLARE
    v_logical uuid;
BEGIN
    FOR v_logical IN SELECT DISTINCT logical_transaction_id FROM residual_matched LOOP
        PERFORM ops.record_movement_weight(v_logical);
    END LOOP;
END;
$weights$;

DO $check$
DECLARE
    v_left integer;
    v_defect integer;
    v_missing text;
BEGIN
    -- Nothing should remain NULL except the descriptors we knowingly declined.
    SELECT count(*)
      INTO v_left
      FROM core.canonical_transaction_version cv
      JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
     WHERE cv.is_current
       AND lt.identity_status = 'ACTIVE'
       AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM core.category_choice c WHERE c.logical_transaction_id = lt.logical_transaction_id)
       AND upper(cv.raw_description) NOT LIKE '%REPORT IF THIS TRANSACTION%'
       AND upper(cv.raw_description) NOT LIKE '%HELP IF YOU HAVE ANY QUESTIONS%'
       AND upper(cv.raw_description) NOT LIKE '%INFORM THAT THE FOLLOWING BOOKING%'
       AND upper(cv.raw_description) NOT LIKE '%SHARE AN UPDATE%'
       AND upper(cv.raw_description) NOT LIKE '%EACH MONTH THEREAFTER%'
       AND upper(cv.raw_description) NOT LIKE '%MAILTO%'
       AND upper(cv.raw_description) NOT IN ('TRANSACTION', 'GOING', 'KNOW HOW', 'HOME NETWORK', 'THANK YOU HERO')
       AND upper(cv.raw_description) NOT LIKE '%139%';

    IF v_left > 0 THEN
        SELECT string_agg(DISTINCT upper(left(cv.raw_description, 60)), ' | ')
          INTO v_missing
          FROM core.canonical_transaction_version cv
          JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
         WHERE cv.is_current
           AND lt.identity_status = 'ACTIVE'
           AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
           AND NOT EXISTS (SELECT 1 FROM core.category_choice c WHERE c.logical_transaction_id = lt.logical_transaction_id);
        RAISE WARNING '% rows still uncategorised after 0062: %', v_left, v_missing;
    END IF;

    -- The footer fragments must still be NULL. If one of them ever gains a category, the
    -- extraction bug has been papered over and the next person to look will not see it.
    SELECT count(*)
      INTO v_defect
      FROM core.canonical_transaction_version cv
      JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
      JOIN core.category_choice c ON c.logical_transaction_id = lt.logical_transaction_id
     WHERE cv.is_current
       AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
       AND upper(cv.raw_description) LIKE '%REPORT IF THIS TRANSACTION%';
    IF v_defect > 0 THEN
        RAISE EXCEPTION 'HDFC footer rows were categorised; fix the extractor instead (% rows)', v_defect;
    END IF;
END;
$check$;

INSERT INTO ops.schema_migration (
    migration_code, migration_name, architecture_version, checksum_hint, notes
) VALUES (
    'RESIDUAL-BACKFILL',
    'Apply ref.merchant_alias to the rows 0057 declined, leaving parser defects NULL',
    'D10.1',
    'residual-backfill',
    'Applies ref.merchant_alias (0062) to the residual uncategorised canonical rows. Email-footer rows stay NULL on purpose; they are an extraction defect, not a category.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
