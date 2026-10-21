-- Connect a mailbox from the signed OAuth callback.
-- credential_ref is sealed ciphertext, never a raw Google token.

BEGIN;

CREATE OR REPLACE FUNCTION ops.connect_gmail_mailbox(
    p_actor uuid,
    p_owner uuid,
    p_mailbox text,
    p_credential_ref text,
    p_history_checkpoint text,
    p_watch_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $fn$
DECLARE
    v_mailbox text := lower(btrim(p_mailbox));
    v_connection uuid;
    v_gmail uuid;
BEGIN
    IF NOT ops.actor_can_access_owner(p_actor, p_owner) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF v_mailbox !~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF btrim(p_credential_ref) = ''
        OR p_credential_ref ~* 'refresh_token'
        OR p_credential_ref ~ '^ya29'
        OR p_credential_ref ~ 'Bearer ' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    IF p_history_checkpoint IS NOT NULL AND p_history_checkpoint !~ '^[0-9]+$' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;

    SELECT source_connection_id INTO v_connection
      FROM core.source_connection
     WHERE owner_id = p_owner
       AND connection_type = 'EMAIL'
       AND provider_code = 'GMAIL'
       AND provider_connection_reference = v_mailbox
     LIMIT 1
     FOR UPDATE;
    IF v_connection IS NULL THEN
        INSERT INTO core.source_connection (
            owner_id, connection_type, provider_code, provider_connection_reference,
            status, consent_scope, metadata
        ) VALUES (
            p_owner, 'EMAIL', 'GMAIL', v_mailbox, 'ACTIVE',
            jsonb_build_object('scope', 'gmail.readonly'),
            jsonb_build_object('channel', 'gmail')
        ) RETURNING source_connection_id INTO v_connection;
    ELSE
        UPDATE core.source_connection
           SET status = 'ACTIVE', updated_at = clock_timestamp()
         WHERE source_connection_id = v_connection AND owner_id = p_owner;
    END IF;

    INSERT INTO core.gmail_connection (
        owner_id, source_connection_id, mailbox_address, oauth_state, credential_ref,
        watch_expires_at, history_checkpoint, sync_state, error_state
    ) VALUES (
        p_owner, v_connection, v_mailbox, 'AUTHORIZED', p_credential_ref,
        p_watch_expires_at, p_history_checkpoint, 'IDLE', NULL
    )
    ON CONFLICT (owner_id, mailbox_address) DO UPDATE
        SET source_connection_id = EXCLUDED.source_connection_id,
            oauth_state = 'AUTHORIZED',
            credential_ref = EXCLUDED.credential_ref,
            watch_expires_at = EXCLUDED.watch_expires_at,
            history_checkpoint = COALESCE(EXCLUDED.history_checkpoint, core.gmail_connection.history_checkpoint),
            sync_state = 'IDLE',
            error_state = NULL,
            updated_at = clock_timestamp()
    RETURNING gmail_connection_id INTO v_gmail;

    RETURN jsonb_build_object('outcome', 'connected', 'gmail_connection_id', v_gmail);
END;
$fn$;

REVOKE ALL ON FUNCTION ops.connect_gmail_mailbox(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.connect_gmail_mailbox(uuid, uuid, text, text, text, timestamptz) TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'GMAIL-MAILBOX-CONNECT',
    'Authorize a Gmail mailbox and store a sealed credential reference',
    'OQ-11-connect',
    'gmail-oauth-connect',
    'Refresh tokens stay sealed. The add sheet can start Google consent.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
