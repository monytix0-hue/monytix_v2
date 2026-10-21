-- The first Gmail search stopped after 50 messages and then saved a history id.
-- Drain the 90-day window once, then return to history.

BEGIN;

ALTER TABLE core.gmail_connection
    ADD COLUMN IF NOT EXISTS initial_window_drained boolean NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS ops.list_gmail_poll_targets();

CREATE FUNCTION ops.list_gmail_poll_targets()
RETURNS TABLE (
    gmail_connection_id uuid,
    owner_id uuid,
    actor_id uuid,
    history_checkpoint text,
    credential_ciphertext text,
    initial_window_drained boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
    SELECT DISTINCT ON (g.gmail_connection_id)
           g.gmail_connection_id, g.owner_id, m.actor_id, g.history_checkpoint, g.credential_ciphertext, g.initial_window_drained
      FROM core.gmail_connection g
      LEFT JOIN core.actor_owner_membership m
        ON m.owner_id = g.owner_id
       AND m.membership_status = 'ACTIVE'
       AND m.effective_to IS NULL
       AND m.effective_from <= clock_timestamp()
     WHERE g.oauth_state = 'AUTHORIZED'
       AND g.credential_ciphertext IS NOT NULL
     ORDER BY g.gmail_connection_id, m.is_default_owner DESC NULLS LAST, m.created_at;
$$;

CREATE OR REPLACE FUNCTION ops.mark_gmail_window_drained(p_connection uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
BEGIN
    UPDATE core.gmail_connection
       SET initial_window_drained = true, updated_at = clock_timestamp()
     WHERE gmail_connection_id = p_connection;
END;
$$;

REVOKE ALL ON FUNCTION ops.list_gmail_poll_targets() FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.mark_gmail_window_drained(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.list_gmail_poll_targets() TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.mark_gmail_window_drained(uuid) TO monytix_api;

COMMIT;
