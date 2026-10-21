-- Gmail connect stores an encrypted credential. The reference column stays a pointer.

BEGIN;

ALTER TABLE core.gmail_connection
    ADD COLUMN credential_ciphertext text;

ALTER TABLE core.gmail_connection
    DROP CONSTRAINT IF EXISTS ck_gmail_credential_ciphertext;

ALTER TABLE core.gmail_connection
    ADD CONSTRAINT ck_gmail_credential_ciphertext CHECK (
        credential_ciphertext IS NULL OR btrim(credential_ciphertext) <> ''
    );

COMMENT ON COLUMN core.gmail_connection.credential_ciphertext IS
'Encrypted mailbox credential. credential_ref remains a pointer and is not the token.';

CREATE TABLE core.gmail_oauth_state (
    state_id     uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id     uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    state_token  text NOT NULL UNIQUE,
    expires_at   timestamptz NOT NULL,
    consumed_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_gmail_oauth_state_token CHECK (btrim(state_token) <> '')
);

CREATE OR REPLACE FUNCTION ops.issue_gmail_oauth_state(
    p_owner uuid,
    p_state text,
    p_expires timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $$
BEGIN
    IF p_owner IS NULL OR p_state IS NULL OR btrim(p_state) = '' OR p_expires IS NULL THEN
        RAISE EXCEPTION 'oauth state is invalid';
    END IF;

    INSERT INTO core.gmail_oauth_state (owner_id, state_token, expires_at)
    VALUES (p_owner, p_state, p_expires);
END;
$$;

CREATE OR REPLACE FUNCTION ops.consume_gmail_oauth_state(p_state text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $$
DECLARE
    v_owner uuid;
BEGIN
    UPDATE core.gmail_oauth_state
    SET consumed_at = clock_timestamp()
    WHERE state_token = p_state
      AND consumed_at IS NULL
      AND expires_at > clock_timestamp()
    RETURNING owner_id INTO v_owner;

    RETURN v_owner;
END;
$$;

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
            credential_ciphertext = p_ciphertext
        WHERE gmail_connection_id = v_connection;
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

    RETURN v_connection;
END;
$$;

REVOKE ALL ON FUNCTION ops.issue_gmail_oauth_state(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.consume_gmail_oauth_state(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.connect_gmail_mailbox(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.issue_gmail_oauth_state(uuid, text, timestamptz) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.consume_gmail_oauth_state(text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.connect_gmail_mailbox(uuid, text, text, text) TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'GMAIL-OAUTH-CONNECT',
    'Gmail OAuth connect',
    'OQ-11-open',
    'gmail-oauth-ciphertext',
    'The callback stores an encrypted credential. Email text still cannot become ledger truth.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
