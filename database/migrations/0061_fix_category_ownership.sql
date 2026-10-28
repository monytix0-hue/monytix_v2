-- `ops.set_transaction_category` could not be called at all. Every edit made from
-- the phone -- accepting a suggested category, or correcting one -- died with
--   ERROR 42703: column fa.owner_id does not exist
-- inside the function, so `PATCH /v1/transactions/:id/category` answered 500 and
-- `ops.correct_transaction` (which calls this function whenever a correction
-- carries a category) failed the same way.
--
-- The cause is a stale assumption about where ownership lives. `core.financial_account`
-- is deliberately ownerless: it is the bank's object, and who may see it is a
-- relationship recorded in `core.account_ownership`. Two statements in the body still
-- joined `core.financial_account fa` and filtered on `fa.owner_id`, a column that has
-- never existed in the D10 schema. PL/pgSQL resolves column names when a statement is
-- first planned, not when the function is created, so `CREATE FUNCTION` in 0049
-- succeeded and the defect only surfaced on the first real call.
--
-- Both sites now resolve ownership the way the rest of the ledger does -- an ACTIVE,
-- open-ended `core.account_ownership` row -- and both keep the check they were doing:
-- the first still decides "is this transaction visible to this owner", the second
-- still decides "which candidate rows belong to this owner" before a retroactive
-- rewrite. The ownership predicate is spelled out rather than left to
-- `ops.owner_owns_transaction` so the retroactive `FOR ... IN` query stays a single
-- set-returning statement.
--
-- Only the ownership join changes; the token derivation, the category/subcategory
-- writes, the rule upsert and the retroactive rewrite are carried over untouched, so
-- this migration is a repair and not a behaviour change. 0049 is left as applied --
-- the repo's convention is to supersede a function, as 0049 itself superseded 0028.

BEGIN;

CREATE OR REPLACE FUNCTION ops.set_transaction_category(
    p_actor uuid,
    p_owner uuid,
    p_logical uuid,
    p_category text,
    p_apply_to_past boolean,
    p_match_scope text,
    p_subcategory text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, spendsense, ops, pg_temp
AS $set_category$
DECLARE
    v_description text;
    v_direction text;
    v_parsed jsonb;
    v_counterparty text;
    v_token text;
    v_saved text;
    v_sanitized text;
    v_count integer := 0;
    v_written integer := 0;
    v_other uuid;
    v_other_description text;
    v_other_direction text;
    v_other_parsed jsonb;
    v_other_token text;
BEGIN
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF p_match_scope NOT IN ('EXACT_MERCHANT', 'RAW_TOKEN') THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM ref.taxonomy_category
         WHERE taxonomy_version = 'F10E-v1.2' AND category_code = p_category
    ) THEN
        RETURN jsonb_build_object('outcome', 'invalid_category');
    END IF;
    IF p_subcategory IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ref.taxonomy_subcategory
         WHERE taxonomy_version = 'F10E-v1.2'
           AND category_code = p_category
           AND subcategory_code = p_subcategory
    ) THEN
        RETURN jsonb_build_object('outcome', 'invalid_category');
    END IF;

    -- Ownership is a row in account_ownership, not a column on the account.
    SELECT cv.raw_description, cv.direction
      INTO v_description, v_direction
      FROM core.logical_transaction lt
      JOIN core.account_ownership ao
        ON ao.financial_account_id = lt.financial_account_id
      LEFT JOIN core.canonical_transaction_version cv
        ON cv.logical_transaction_id = lt.logical_transaction_id AND cv.is_current
     WHERE lt.logical_transaction_id = p_logical
       AND ao.owner_id = p_owner
       AND ao.relationship_status = 'ACTIVE'
       AND ao.effective_to IS NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'missing');
    END IF;

    v_parsed := spendsense.parse_narration_v4(coalesce(v_description, ''), coalesce(v_direction, ''));
    v_counterparty := coalesce(v_parsed #>> '{fields,cleaned_counterparty}', v_parsed #>> '{fields,counterparty_name}', '');
    v_sanitized := btrim(regexp_replace(upper(coalesce(v_description, '')), '[^A-Z0-9]+', ' ', 'g'));
    SELECT match_token INTO v_saved
      FROM core.category_choice
     WHERE logical_transaction_id = p_logical
       AND owner_id = p_owner;
    v_token := CASE
        WHEN p_match_scope = 'RAW_TOKEN' THEN v_sanitized
        WHEN nullif(btrim(coalesce(v_saved, '')), '') IS NOT NULL THEN btrim(v_saved)
        ELSE coalesce(
            nullif(btrim(coalesce(spendsense.clean_counterparty_name(v_description), '')), ''),
            nullif(btrim(v_counterparty), '')
        )
    END;
    IF v_token IS NULL OR v_token = '' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    INSERT INTO core.category_choice (
        owner_id, logical_transaction_id, category_code, subcategory_code, match_token, match_scope, is_explicit
    ) VALUES (p_owner, p_logical, p_category, p_subcategory, v_token, p_match_scope, true)
    ON CONFLICT (logical_transaction_id) DO UPDATE
        SET category_code = EXCLUDED.category_code,
            subcategory_code = EXCLUDED.subcategory_code,
            match_token = EXCLUDED.match_token,
            match_scope = EXCLUDED.match_scope,
            is_explicit = true;

    INSERT INTO core.category_rule (owner_id, match_token, match_scope, category_code, subcategory_code)
    VALUES (p_owner, v_token, p_match_scope, p_category, p_subcategory)
    ON CONFLICT (owner_id, match_scope, match_token) DO UPDATE
        SET category_code = EXCLUDED.category_code,
            subcategory_code = EXCLUDED.subcategory_code;

    PERFORM ops.record_movement_weight(p_logical);

    IF p_apply_to_past THEN
        FOR v_other, v_other_description, v_other_direction IN
            SELECT lt.logical_transaction_id, cv.raw_description, cv.direction
              FROM core.logical_transaction lt
              JOIN core.account_ownership ao
                ON ao.financial_account_id = lt.financial_account_id
              JOIN core.canonical_transaction_version cv
                ON cv.logical_transaction_id = lt.logical_transaction_id AND cv.is_current
             WHERE ao.owner_id = p_owner
               AND ao.relationship_status = 'ACTIVE'
               AND ao.effective_to IS NULL
               AND lt.logical_transaction_id <> p_logical
               AND NOT EXISTS (
                   SELECT 1 FROM core.category_choice existing
                    WHERE existing.owner_id = p_owner
                      AND existing.logical_transaction_id = lt.logical_transaction_id
                      AND existing.is_explicit
               )
        LOOP
            v_other_parsed := spendsense.parse_narration_v4(coalesce(v_other_description, ''), coalesce(v_other_direction, ''));
            IF p_match_scope = 'EXACT_MERCHANT' THEN
                v_other_token := btrim(coalesce(v_other_parsed #>> '{fields,cleaned_counterparty}', ''));
                IF v_other_token IS DISTINCT FROM v_token THEN
                    SELECT choice.match_token INTO v_other_token
                      FROM core.category_choice choice
                     WHERE choice.logical_transaction_id = v_other
                       AND choice.owner_id = p_owner;
                    IF v_other_token IS DISTINCT FROM v_token THEN
                        CONTINUE;
                    END IF;
                END IF;
            ELSE
                v_other_token := btrim(regexp_replace(upper(coalesce(v_other_description, '')), '[^A-Z0-9]+', ' ', 'g'));
                IF position(' ' || v_token || ' ' IN ' ' || v_other_token || ' ') = 0 THEN
                    CONTINUE;
                END IF;
            END IF;
            INSERT INTO core.category_choice (
                owner_id, logical_transaction_id, category_code, subcategory_code, match_token, match_scope, is_explicit
            ) VALUES (p_owner, v_other, p_category, p_subcategory, v_token, p_match_scope, true)
            ON CONFLICT (logical_transaction_id) DO UPDATE
                SET category_code = EXCLUDED.category_code,
                    subcategory_code = EXCLUDED.subcategory_code,
                    match_token = EXCLUDED.match_token,
                    match_scope = EXCLUDED.match_scope,
                    is_explicit = true
              WHERE core.category_choice.is_explicit = false;
            GET DIAGNOSTICS v_written = ROW_COUNT;
            IF v_written > 0 THEN
                v_count := v_count + 1;
                PERFORM ops.record_movement_weight(v_other);
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'outcome', 'updated',
        'body', jsonb_build_object(
            'updated_transaction', jsonb_build_object('id', p_logical, 'category_id', p_category, 'counterparty', v_counterparty),
            'rule_created', jsonb_build_object('match_token', v_token, 'category_id', p_category),
            'retroactive_count', v_count
        )
    );
END;
$set_category$;

-- CREATE OR REPLACE reuses the function's OID and keeps its ACLs, but restating them
-- keeps this migration honest on a database where 0049's grants were never applied.
REVOKE ALL ON FUNCTION ops.set_transaction_category(uuid, uuid, uuid, text, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.set_transaction_category(uuid, uuid, uuid, text, boolean, text, text) TO monytix_api;

-- --------------------------------------------------------------------------
-- Assertions.
--
-- The whole reason this migration exists is that a bad column reference cannot be
-- caught by the compiler, so the checks below have to look at the compiled body and
-- at the data the body walks, not just at the fact that CREATE FUNCTION returned.
-- --------------------------------------------------------------------------
DO $check$
DECLARE
    v_body text;
    v_notext text;
    v_actor uuid;
    v_owner uuid;
    v_logical uuid;
    v_probe jsonb;
    v_shadow jsonb;
    v_fanout integer;
BEGIN
    SELECT pg_get_functiondef(p.oid)
      INTO v_body
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'ops'
       AND p.proname = 'set_transaction_category'
       AND pg_get_function_identity_arguments(p.oid) LIKE '%p_subcategory%';

    IF v_body IS NULL THEN
        RAISE EXCEPTION 'ops.set_transaction_category(uuid,uuid,uuid,text,boolean,text,text) is missing';
    END IF;

    -- Strip comments so the prose above cannot satisfy or trip the checks below.
    v_notext := regexp_replace(v_body, '--[^\n]*', '', 'g');

    -- The exact defect: an owner filter hung off a financial_account alias.
    IF v_notext ~ '\mfa\.owner_id\M' THEN
        RAISE EXCEPTION 'set_transaction_category still filters on fa.owner_id';
    END IF;

    -- The repair must be present at both sites: the visibility lookup and the
    -- retroactive candidate scan. Counting the join keeps a future edit from
    -- reintroducing the filter at only one of them.
    IF (length(v_notext) - length(replace(v_notext, 'core.account_ownership', '')))
       / length('core.account_ownership') <> 2 THEN
        RAISE EXCEPTION 'set_transaction_category must resolve ownership at both call sites';
    END IF;

    -- The new join is only safe while it cannot fan out. If the same account were
    -- ever recorded as ACTIVE twice for one owner, the retroactive loop would visit
    -- a transaction more than once and report a wrong retroactive_count.
    SELECT count(*) INTO v_fanout
      FROM (
        SELECT o.financial_account_id, o.owner_id
          FROM core.account_ownership o
         WHERE o.relationship_status = 'ACTIVE'
           AND o.effective_to IS NULL
         GROUP BY 1, 2
        HAVING count(*) > 1
      ) dup;
    IF v_fanout > 0 THEN
        RAISE EXCEPTION 'account_ownership fans out for % (account, owner) pairs', v_fanout;
    END IF;

    -- End-to-end proof that the corrected statement plan is valid and that a real
    -- caller sees a real transaction. Both function calls run inside a block that is
    -- always rolled back, so no category choice or rule survives this migration.
    SELECT m.actor_id, o.owner_id, lt.logical_transaction_id
      INTO v_actor, v_owner, v_logical
      FROM core.actor_owner_membership m
      JOIN core.account_ownership o
        ON o.owner_id = m.owner_id
       AND o.relationship_status = 'ACTIVE'
       AND o.effective_to IS NULL
      JOIN core.logical_transaction lt
        ON lt.financial_account_id = o.financial_account_id
     WHERE m.membership_status = 'ACTIVE'
       AND m.effective_to IS NULL
       AND m.effective_from <= clock_timestamp()
     ORDER BY lt.created_at
     LIMIT 1;

    IF v_logical IS NOT NULL THEN
        -- An actor the owner never admitted is refused before any row is read.
        v_probe := ops.set_transaction_category(
            gen_random_uuid(), v_owner, v_logical, 'FOOD_DINING', false, 'EXACT_MERCHANT'
        );
        IF v_probe ->> 'outcome' IS DISTINCT FROM 'forbidden' THEN
            RAISE EXCEPTION 'set_transaction_category accepted an unauthorised actor: %', v_probe;
        END IF;

        -- This is the call that used to raise 42703: the ownership lookup plans and
        -- executes against a real transaction. A well-formed narration yields
        -- 'updated'; one that cannot name a merchant yields 'invalid'. Either way the
        -- statement that was broken has run.
        BEGIN
            v_shadow := ops.set_transaction_category(
                v_actor, v_owner, v_logical, 'FOOD_DINING', false, 'EXACT_MERCHANT'
            );
            IF v_shadow ->> 'outcome' NOT IN ('updated', 'invalid') THEN
                RAISE EXCEPTION 'categorising an owned transaction returned %', v_shadow ->> 'outcome';
            END IF;
            RAISE EXCEPTION 'rollback probe';
        EXCEPTION
            WHEN raise_exception THEN
                IF SQLERRM <> 'rollback probe' THEN
                    RAISE;
                END IF;
        END;
    END IF;
END;
$check$;

INSERT INTO ops.schema_migration (
    migration_code, migration_name, architecture_version, checksum_hint, notes
) VALUES (
    'CATEGORY-OWNERSHIP',
    'Category edits resolve ownership through core.account_ownership, not a phantom fa.owner_id',
    'D10.1',
    'category-ownership',
    'Repairs ops.set_transaction_category (superseding 0049) so PATCH /v1/transactions/:id/category and ops.correct_transaction stop raising 42703.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
