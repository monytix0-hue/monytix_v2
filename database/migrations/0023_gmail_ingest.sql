-- Gmail Pub/Sub foundation. Owner-scoped connection and notification receipt.
-- Credential material is a reference only. Email text cannot become ledger truth.

BEGIN;

CREATE TABLE core.gmail_connection (
    gmail_connection_id   uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id              uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    source_connection_id  uuid NOT NULL,
    mailbox_address       text NOT NULL,
    oauth_state           text NOT NULL DEFAULT 'PENDING',
    credential_ref        text NOT NULL,
    watch_expires_at      timestamptz,
    history_checkpoint    text,
    sync_state            text NOT NULL DEFAULT 'IDLE',
    error_state           text,
    lock_worker           text,
    created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_gmail_connection_owner_pair UNIQUE (gmail_connection_id, owner_id),
    CONSTRAINT fk_gmail_connection_source FOREIGN KEY (source_connection_id, owner_id)
        REFERENCES core.source_connection (source_connection_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT uq_gmail_connection_mailbox UNIQUE (owner_id, mailbox_address),
    CONSTRAINT ck_gmail_oauth_state CHECK (oauth_state IN ('PENDING', 'AUTHORIZED', 'REVOKED')),
    CONSTRAINT ck_gmail_sync_state CHECK (sync_state IN ('IDLE', 'RUNNING', 'RESYNC_REQUIRED', 'ERROR')),
    CONSTRAINT ck_gmail_credential_ref CHECK (
        btrim(credential_ref) <> ''
        AND credential_ref !~* 'refresh_token'
        AND credential_ref !~ '^ya29'
        AND credential_ref !~ 'Bearer '
    ),
    CONSTRAINT ck_gmail_checkpoint_digits CHECK (history_checkpoint IS NULL OR history_checkpoint ~ '^[0-9]+$')
);

CREATE INDEX ix_gmail_connection_mailbox ON core.gmail_connection (mailbox_address);

CREATE TABLE core.gmail_notification (
    gmail_notification_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id              uuid NOT NULL,
    gmail_connection_id   uuid NOT NULL,
    pubsub_message_id     text NOT NULL,
    history_id            text NOT NULL,
    disposition           text NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT fk_gmail_notification_connection FOREIGN KEY (gmail_connection_id, owner_id)
        REFERENCES core.gmail_connection (gmail_connection_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT uq_gmail_notification_message UNIQUE (pubsub_message_id),
    CONSTRAINT ck_gmail_notification_disposition CHECK (disposition IN ('BASELINE', 'QUEUED', 'DUPLICATE', 'OUT_OF_ORDER')),
    CONSTRAINT ck_gmail_notification_history CHECK (history_id ~ '^[0-9]+$')
);

CREATE TABLE core.gmail_history_job (
    gmail_history_job_id  uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id              uuid NOT NULL,
    gmail_connection_id   uuid NOT NULL,
    history_id            text NOT NULL,
    status                text NOT NULL DEFAULT 'PENDING',
    attempt_count         integer NOT NULL DEFAULT 0,
    next_attempt_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    page_token            text,
    range_durable         boolean NOT NULL DEFAULT false,
    created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT fk_gmail_history_job_connection FOREIGN KEY (gmail_connection_id, owner_id)
        REFERENCES core.gmail_connection (gmail_connection_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT uq_gmail_history_job UNIQUE (gmail_connection_id, history_id),
    CONSTRAINT ck_gmail_history_job_status CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'EXPIRED')),
    CONSTRAINT ck_gmail_history_job_attempts CHECK (attempt_count >= 0),
    CONSTRAINT ck_gmail_history_job_id CHECK (history_id ~ '^[0-9]+$')
);

CREATE TABLE core.gmail_message_ref (
    gmail_message_ref_id  uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id              uuid NOT NULL,
    gmail_connection_id   uuid NOT NULL,
    gmail_message_id      text NOT NULL,
    history_id            text NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT fk_gmail_message_ref_connection FOREIGN KEY (gmail_connection_id, owner_id)
        REFERENCES core.gmail_connection (gmail_connection_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT uq_gmail_message_ref UNIQUE (gmail_connection_id, gmail_message_id)
);

CREATE TABLE core.gmail_message_candidate (
    gmail_message_candidate_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id              uuid NOT NULL,
    gmail_connection_id   uuid NOT NULL,
    gmail_message_id      text NOT NULL,
    part_index            integer NOT NULL,
    mime_type             text NOT NULL,
    content_sha256        text NOT NULL,
    provenance            jsonb NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT fk_gmail_candidate_connection FOREIGN KEY (gmail_connection_id, owner_id)
        REFERENCES core.gmail_connection (gmail_connection_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT ck_gmail_candidate_mime CHECK (mime_type IN ('text/plain', 'text/html')),
    CONSTRAINT uq_gmail_candidate_part UNIQUE (gmail_connection_id, gmail_message_id, part_index)
);

CREATE TABLE core.gmail_attachment_handoff (
    gmail_attachment_handoff_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id              uuid NOT NULL,
    gmail_connection_id   uuid NOT NULL,
    gmail_message_id      text NOT NULL,
    part_index            integer NOT NULL,
    file_type             text NOT NULL,
    byte_size             bigint NOT NULL,
    sha256                text NOT NULL,
    original_filename     text NOT NULL,
    provenance            jsonb NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT fk_gmail_handoff_connection FOREIGN KEY (gmail_connection_id, owner_id)
        REFERENCES core.gmail_connection (gmail_connection_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT ck_gmail_handoff_file_type CHECK (file_type IN ('PDF', 'CSV', 'XLS', 'XLSX')),
    CONSTRAINT ck_gmail_handoff_sha CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT uq_gmail_handoff_part UNIQUE (gmail_connection_id, gmail_message_id, part_index)
);

ALTER TABLE core.gmail_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.gmail_notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.gmail_history_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.gmail_message_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.gmail_message_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.gmail_attachment_handoff ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_gmail_connection_owner_read ON core.gmail_connection
FOR SELECT USING (owner_id = ops.current_owner_id());
CREATE POLICY pol_gmail_notification_owner_read ON core.gmail_notification
FOR SELECT USING (owner_id = ops.current_owner_id());
CREATE POLICY pol_gmail_history_job_owner_read ON core.gmail_history_job
FOR SELECT USING (owner_id = ops.current_owner_id());
CREATE POLICY pol_gmail_message_ref_owner_read ON core.gmail_message_ref
FOR SELECT USING (owner_id = ops.current_owner_id());
CREATE POLICY pol_gmail_message_candidate_owner_read ON core.gmail_message_candidate
FOR SELECT USING (owner_id = ops.current_owner_id());
CREATE POLICY pol_gmail_attachment_handoff_owner_read ON core.gmail_attachment_handoff
FOR SELECT USING (owner_id = ops.current_owner_id());

COMMENT ON TABLE core.gmail_connection IS
'Owner-scoped Gmail watch. credential_ref names a secret and does not store a refresh token.';
COMMENT ON TABLE core.gmail_notification IS
'Idempotent Pub/Sub receipt. A redelivery does not create a second history job.';
COMMENT ON TABLE core.gmail_message_candidate IS
'Unreviewed email text. It is not canonical ledger truth.';

CREATE OR REPLACE FUNCTION ops.record_gmail_notification(
    p_owner uuid,
    p_connection uuid,
    p_message_id text,
    p_history_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, ops, pg_temp
AS $fn$
DECLARE
    v_checkpoint text;
    v_oauth text;
    v_disposition text;
    v_job uuid;
BEGIN
    IF p_history_id !~ '^[0-9]+$' OR btrim(p_message_id) = '' THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    SELECT history_checkpoint, oauth_state
      INTO v_checkpoint, v_oauth
      FROM core.gmail_connection
     WHERE gmail_connection_id = p_connection
       AND owner_id = p_owner
     FOR UPDATE;
    IF v_oauth IS NULL OR v_oauth = 'REVOKED' THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF EXISTS (
        SELECT 1 FROM core.gmail_notification WHERE pubsub_message_id = p_message_id
    ) THEN
        RETURN jsonb_build_object('outcome', 'duplicate');
    END IF;
    IF v_checkpoint IS NULL THEN
        v_disposition := 'BASELINE';
        UPDATE core.gmail_connection
           SET history_checkpoint = p_history_id, updated_at = clock_timestamp()
         WHERE gmail_connection_id = p_connection AND owner_id = p_owner;
    ELSIF p_history_id::numeric <= v_checkpoint::numeric OR EXISTS (
        SELECT 1 FROM core.gmail_history_job
         WHERE gmail_connection_id = p_connection
           AND status IN ('PENDING', 'RUNNING')
           AND history_id::numeric >= p_history_id::numeric
    ) THEN
        v_disposition := 'OUT_OF_ORDER';
    ELSE
        v_disposition := 'QUEUED';
    END IF;
    INSERT INTO core.gmail_notification (owner_id, gmail_connection_id, pubsub_message_id, history_id, disposition)
    VALUES (p_owner, p_connection, p_message_id, p_history_id, v_disposition);
    IF v_disposition = 'QUEUED' THEN
        INSERT INTO core.gmail_history_job (owner_id, gmail_connection_id, history_id)
        VALUES (p_owner, p_connection, p_history_id)
        RETURNING gmail_history_job_id INTO v_job;
    END IF;
    RETURN jsonb_build_object('outcome', lower(v_disposition), 'job_id', v_job);
END;
$fn$;

REVOKE ALL ON FUNCTION ops.record_gmail_notification(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.record_gmail_notification(uuid, uuid, text, text) TO monytix_api;

GRANT SELECT, INSERT, UPDATE ON
    core.gmail_connection,
    core.gmail_notification,
    core.gmail_history_job,
    core.gmail_message_ref,
    core.gmail_message_candidate,
    core.gmail_attachment_handoff
TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'GMAIL-INGEST-FOUNDATION',
    'Gmail connection, notification, and checkpoint tables',
    'OQ-11-open',
    'gmail-pubsub-foundation',
    'Mailbox calls stay mocked. EMAIL_ALERT still cannot become current ledger truth.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
