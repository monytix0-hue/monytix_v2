-- Reconnecting a mailbox must scan the initial window again.
-- The previous connect path kept initial_window_drained, so a new OAuth grant
-- only refreshed the token and the worker stayed on the history checkpoint.

BEGIN;

CREATE OR REPLACE FUNCTION ops.connect_gmail_mailbox(
    p_owner uuid,
    p_mailbox text,
    p_credential_ref text,
    p_ciphertext text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $$
DECLARE
    v_connection uuid;
    v_source uuid;
    v_mailbox text;
BEGIN
    v_mailbox := lower(btrim(COALESCE(p_mailbox, '')));
    IF p_owner IS NULL
        OR position('@' in v_mailbox) = 0
        OR p_credential_ref IS NULL
        OR btrim(p_credential_ref) = ''
        OR p_credential_ref ~* 'refresh_token'
        OR p_credential_ref ~ '^ya29'
        OR p_credential_ref ~ 'Bearer '
        OR p_ciphertext IS NULL
        OR btrim(p_ciphertext) = '' THEN
        RAISE EXCEPTION 'gmail connection is invalid';
    END IF;

    SELECT gmail_connection_id INTO v_connection
    FROM core.gmail_connection
    WHERE owner_id = p_owner
      AND mailbox_address = v_mailbox;

    IF v_connection IS NOT NULL THEN
        UPDATE core.gmail_connection
        SET oauth_state = 'AUTHORIZED',
            credential_ref = p_credential_ref,
            credential_ciphertext = p_ciphertext,
            initial_window_drained = false,
            updated_at = clock_timestamp()
        WHERE gmail_connection_id = v_connection;
        PERFORM pg_notify('gmail_ingest', v_connection::text);
        RETURN v_connection;
    END IF;

    INSERT INTO core.source_connection (owner_id, connection_type, provider_code, status)
    VALUES (p_owner, 'EMAIL', 'GMAIL', 'ACTIVE')
    RETURNING source_connection_id INTO v_source;

    INSERT INTO core.gmail_connection (
        owner_id, source_connection_id, mailbox_address, oauth_state, credential_ref, credential_ciphertext
    ) VALUES (
        p_owner, v_source, v_mailbox, 'AUTHORIZED', p_credential_ref, p_ciphertext
    )
    RETURNING gmail_connection_id INTO v_connection;

    PERFORM pg_notify('gmail_ingest', v_connection::text);
    RETURN v_connection;
END;
$$;

REVOKE ALL ON FUNCTION ops.connect_gmail_mailbox(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.connect_gmail_mailbox(uuid, text, text, text) TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'GMAIL-RECONNECT-RESCAN',
    'Gmail reconnect reopens the initial scan window',
    'OQ-11-open',
    'gmail-reconnect-rescan',
    'A repeated OAuth grant clears initial_window_drained so the worker searches the mailbox again.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
