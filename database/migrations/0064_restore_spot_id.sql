-- Restore the spot id on save_gmail_spot_transaction's success returns.
--
-- 0056 rewrote this function to carry the detected currency and the stated pair,
-- and in doing so dropped `gmail_spot_transaction_id` from the `created` and
-- `replay` jsonb. The caller in services/api/src/gmail/poll-worker.ts promotes a
-- spot only when that key is present:
--
--     const spotId = saved.rows[0]?.result?.gmail_spot_transaction_id;
--     if (spotId) { ... ops.promote_gmail_spot(spotId) ... }
--
-- So from the moment 0056 was applied every alert was still parsed and saved, and
-- still reported `outcome: "created"`, but was never promoted into the ledger.
-- The worker's own tick logged a healthy `stored` count throughout, which is why
-- the only visible symptom was an empty ledger.
--
-- This file restores the two keys and changes nothing else. The signature, the
-- defaults, and the invalid/created/replay vocabulary are byte-identical to
-- 0056's body, so CREATE OR REPLACE needs no DROP and no caller changes.

BEGIN;

CREATE OR REPLACE FUNCTION ops.save_gmail_spot_transaction(
    p_owner uuid,
    p_connection uuid,
    p_message text,
    p_idempotency_key text,
    p_flow text,
    p_amount numeric,
    p_account_last4 text,
    p_payment_ref text,
    p_channel text,
    p_counterparty text,
    p_posted_at timestamptz,
    p_raw_excerpt text,
    p_currency text DEFAULT 'INR',
    p_currency_basis text DEFAULT NULL,
    p_currency_confidence numeric DEFAULT NULL,
    p_stated_amount numeric DEFAULT NULL,
    p_stated_currency text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
DECLARE
    v_id uuid;
    v_last4 text;
    v_counterparty text;
    v_currency text;
    v_stated_currency text;
BEGIN
    v_last4 := nullif(btrim(coalesce(p_account_last4, '')), '');
    v_counterparty := left(btrim(coalesce(p_counterparty, '')), 120);
    v_currency := upper(btrim(coalesce(p_currency, 'INR')));
    v_stated_currency := nullif(upper(btrim(coalesce(p_stated_currency, ''))), '');

    IF p_owner IS NULL
        OR p_connection IS NULL
        OR btrim(coalesce(p_message, '')) = ''
        OR p_idempotency_key !~ '^(ref:[A-Za-z0-9]{10,16}|hash:[0-9a-f]{64})$'
        OR p_flow NOT IN ('DEBIT', 'CREDIT')
        OR p_channel NOT IN ('UPI', 'IMPS', 'NEFT', 'RTGS', 'ATM', 'CARD', 'OTHER')
        OR p_amount IS NULL
        OR p_amount <= 0
        OR v_currency !~ '^[A-Z]{3}$'
        OR (v_stated_currency IS NOT NULL AND v_stated_currency !~ '^[A-Z]{3}$')
        OR (p_stated_amount IS NOT NULL AND p_stated_amount <= 0)
        OR ((p_stated_amount IS NULL) <> (v_stated_currency IS NULL))
        OR (v_last4 IS NOT NULL AND v_last4 !~ '^[0-9]{4}$')
        OR v_counterparty = ''
        OR NOT EXISTS (
            SELECT 1 FROM core.gmail_connection
             WHERE gmail_connection_id = p_connection
               AND owner_id = p_owner
        ) THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    INSERT INTO core.gmail_spot_transaction (
        owner_id, gmail_connection_id, gmail_message_id, idempotency_key, flow, amount,
        currency_code, account_last4, payment_ref, channel, counterparty, posted_at, raw_excerpt,
        currency_basis, currency_confidence, stated_amount, stated_currency_code
    ) VALUES (
        p_owner, p_connection, btrim(p_message), p_idempotency_key, p_flow, p_amount,
        v_currency, v_last4, nullif(btrim(coalesce(p_payment_ref, '')), ''), p_channel, v_counterparty,
        p_posted_at, left(coalesce(p_raw_excerpt, ''), 500),
        nullif(btrim(coalesce(p_currency_basis, '')), ''), p_currency_confidence,
        p_stated_amount, v_stated_currency
    )
    ON CONFLICT DO NOTHING
    RETURNING gmail_spot_transaction_id INTO v_id;

    -- ON CONFLICT DO NOTHING leaves v_id NULL on a duplicate, so resolve the row
    -- that already holds this idempotency key. The worker promotes on either
    -- outcome, and promote_gmail_spot returns early when the spot is already
    -- linked, so a replay is both safe and self-healing: a message that was saved
    -- but stranded by the missing id is promoted the next time it is re-polled.
    IF v_id IS NULL THEN
        SELECT gmail_spot_transaction_id INTO v_id
          FROM core.gmail_spot_transaction
         WHERE owner_id = p_owner
           AND idempotency_key = p_idempotency_key;

        IF v_id IS NULL THEN
            -- A conflict on the message key with a different idempotency key would
            -- reach here. Report replay without an id rather than inventing one.
            RETURN jsonb_build_object('outcome', 'replay');
        END IF;

        RETURN jsonb_build_object('outcome', 'replay', 'gmail_spot_transaction_id', v_id);
    END IF;

    RETURN jsonb_build_object('outcome', 'created', 'gmail_spot_transaction_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION ops.save_gmail_spot_transaction(
    uuid, uuid, text, text, text, numeric, text, text, text, text, timestamptz, text,
    text, text, numeric, numeric, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.save_gmail_spot_transaction(
    uuid, uuid, text, text, text, numeric, text, text, text, text, timestamptz, text,
    text, text, numeric, numeric, text
) TO monytix_api;

-- The replay branch must report the existing row's id, not a nil one: the worker
-- promotes on either outcome, so a replay that omitted the id would strand the
-- message a second time.
DO $check$
DECLARE
    v_body text;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_body
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'ops' AND p.proname = 'save_gmail_spot_transaction';

    IF v_body IS NULL THEN
        RAISE EXCEPTION 'save_gmail_spot_transaction is missing';
    END IF;
    IF v_body NOT LIKE '%''created'', ''gmail_spot_transaction_id'', v_id%' THEN
        RAISE EXCEPTION 'the created branch does not return the spot id';
    END IF;
    IF v_body NOT LIKE '%''replay'', ''gmail_spot_transaction_id'', v_id%' THEN
        RAISE EXCEPTION 'the replay branch does not return the spot id';
    END IF;
END;
$check$;

INSERT INTO ops.schema_migration (
    migration_code, migration_name, architecture_version, checksum_hint, notes
) VALUES (
    'SPOT-ID-RESTORE',
    'save_gmail_spot_transaction returns the spot id again so the worker promotes',
    'D10.1',
    'spot-id-restore',
    'Restores gmail_spot_transaction_id on both success branches, dropped by 0056. Without it poll-worker.ts never called ops.promote_gmail_spot and every alert after 2026-10-28 14:42 stayed out of the ledger.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
