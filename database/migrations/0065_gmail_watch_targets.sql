-- Give the poll target list the two columns watch renewal needs.
--
-- Renewal has to answer "whose watch is missing or about to lapse" from the same
-- single query the worker already runs each tick, rather than opening a second
-- connection per mailbox just to read a timestamp. `mailbox_address` is also
-- required to call ops.set_gmail_watch, which keys on owner + mailbox.
--
-- Adding OUT columns changes the return type, which CREATE OR REPLACE cannot do,
-- so the function is dropped and recreated. It is STABLE and holds no state, and
-- the two callers (services/api/src/gmail/poll-worker.ts and the statement puller)
-- both use `SELECT *`, so the appended columns are additive to them.

BEGIN;

DROP FUNCTION IF EXISTS ops.list_gmail_poll_targets();

CREATE OR REPLACE FUNCTION ops.list_gmail_poll_targets()
RETURNS TABLE (
    gmail_connection_id uuid,
    owner_id uuid,
    actor_id uuid,
    history_checkpoint text,
    credential_ciphertext text,
    initial_window_drained boolean,
    owner_timezone text,
    owner_currency text,
    owner_country text,
    owner_locale text,
    mailbox_address text,
    watch_expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
    SELECT DISTINCT ON (g.gmail_connection_id)
           g.gmail_connection_id, g.owner_id, m.actor_id, g.history_checkpoint,
           g.credential_ciphertext, g.initial_window_drained,
           o.timezone_name,
           btrim(o.default_currency_code),
           nullif(upper(btrim(o.metadata->>'country_code')), ''),
           nullif(btrim(o.metadata->>'locale'), ''),
           g.mailbox_address,
           g.watch_expires_at
      FROM core.gmail_connection g
      JOIN core.owner o ON o.owner_id = g.owner_id
      LEFT JOIN core.actor_owner_membership m
        ON m.owner_id = g.owner_id
       AND m.membership_status = 'ACTIVE'
       AND m.effective_to IS NULL
       AND m.effective_from <= clock_timestamp()
     WHERE g.oauth_state = 'AUTHORIZED'
       AND g.credential_ciphertext IS NOT NULL
     ORDER BY g.gmail_connection_id, m.is_default_owner DESC NULLS LAST, m.created_at;
$$;

REVOKE ALL ON FUNCTION ops.list_gmail_poll_targets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.list_gmail_poll_targets() TO monytix_api;

-- Every connection the worker will see must be renewable, or renewal silently has
-- nothing to act on -- the exact failure this whole change exists to prevent.
DO $check$
DECLARE
    v_has_mailbox boolean;
    v_has_watch boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'ops' AND p.proname = 'list_gmail_poll_targets'
           AND 'mailbox_address' = ANY (p.proargnames)
    ) INTO v_has_mailbox;
    SELECT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'ops' AND p.proname = 'list_gmail_poll_targets'
           AND 'watch_expires_at' = ANY (p.proargnames)
    ) INTO v_has_watch;

    IF NOT v_has_mailbox OR NOT v_has_watch THEN
        RAISE EXCEPTION 'list_gmail_poll_targets is missing the renewal columns';
    END IF;
END;
$check$;

INSERT INTO ops.schema_migration (
    migration_code, migration_name, architecture_version, checksum_hint, notes
) VALUES (
    'GMAIL-WATCH-TARGETS',
    'Poll targets expose mailbox and watch expiry so the worker can renew a lapsed watch',
    'D10.1',
    'gmail-watch-targets',
    'Appends mailbox_address and watch_expires_at to ops.list_gmail_poll_targets. Without them the worker cannot tell a missing watch from a live one, which is why push delivery was never restored after a watch expired.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
