-- Spot alerts are staged from email text. A last-4 is not an account id,
-- so these rows stay out of the canonical ledger.
-- Connected mailboxes search the 365-day alert window once more.

BEGIN;

CREATE TABLE core.gmail_spot_transaction (
    gmail_spot_transaction_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id                  uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    gmail_connection_id       uuid NOT NULL,
    gmail_message_id          text NOT NULL,
    idempotency_key           text NOT NULL,
    flow                      text NOT NULL,
    amount                    numeric(20,4) NOT NULL,
    currency_code             char(3) NOT NULL DEFAULT 'INR',
    account_last4             text,
    payment_ref               text,
    channel                   text NOT NULL,
    counterparty              text NOT NULL,
    posted_at                 timestamptz,
    raw_excerpt               text NOT NULL DEFAULT '',
    created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT fk_gmail_spot_connection FOREIGN KEY (gmail_connection_id, owner_id)
        REFERENCES core.gmail_connection (gmail_connection_id, owner_id) ON DELETE RESTRICT,
    CONSTRAINT uq_gmail_spot_idempotency UNIQUE (owner_id, idempotency_key),
    CONSTRAINT uq_gmail_spot_message UNIQUE (gmail_connection_id, gmail_message_id),
    CONSTRAINT ck_gmail_spot_flow CHECK (flow IN ('DEBIT', 'CREDIT')),
    CONSTRAINT ck_gmail_spot_channel CHECK (channel IN ('UPI', 'IMPS', 'NEFT', 'RTGS', 'ATM', 'CARD', 'OTHER')),
    CONSTRAINT ck_gmail_spot_currency CHECK (currency_code = 'INR'),
    CONSTRAINT ck_gmail_spot_amount CHECK (amount > 0),
    CONSTRAINT ck_gmail_spot_last4 CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9]{4}$'),
    CONSTRAINT ck_gmail_spot_key CHECK (idempotency_key ~ '^(ref:[A-Za-z0-9]{10,16}|hash:[0-9a-f]{64})$'),
    CONSTRAINT ck_gmail_spot_counterparty CHECK (btrim(counterparty) <> '')
);

ALTER TABLE core.gmail_spot_transaction ENABLE ROW LEVEL SECURITY;

CREATE POLICY pol_gmail_spot_owner_read ON core.gmail_spot_transaction
    FOR SELECT USING (owner_id = ops.current_owner_id());

COMMENT ON TABLE core.gmail_spot_transaction IS
'A debit or credit parsed from an email alert. It is not canonical ledger truth.';

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
    p_raw_excerpt text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
DECLARE
    v_id uuid;
    v_last4 text;
    v_counterparty text;
BEGIN
    v_last4 := nullif(btrim(coalesce(p_account_last4, '')), '');
    v_counterparty := left(btrim(coalesce(p_counterparty, '')), 120);
    IF p_owner IS NULL
        OR p_connection IS NULL
        OR btrim(coalesce(p_message, '')) = ''
        OR p_idempotency_key !~ '^(ref:[A-Za-z0-9]{10,16}|hash:[0-9a-f]{64})$'
        OR p_flow NOT IN ('DEBIT', 'CREDIT')
        OR p_channel NOT IN ('UPI', 'IMPS', 'NEFT', 'RTGS', 'ATM', 'CARD', 'OTHER')
        OR p_amount IS NULL
        OR p_amount <= 0
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
        account_last4, payment_ref, channel, counterparty, posted_at, raw_excerpt
    ) VALUES (
        p_owner, p_connection, btrim(p_message), p_idempotency_key, p_flow, p_amount,
        v_last4, nullif(btrim(coalesce(p_payment_ref, '')), ''), p_channel, v_counterparty,
        p_posted_at, left(coalesce(p_raw_excerpt, ''), 500)
    )
    ON CONFLICT DO NOTHING
    RETURNING gmail_spot_transaction_id INTO v_id;

    IF v_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'replay');
    END IF;
    RETURN jsonb_build_object('outcome', 'created');
END;
$$;

CREATE OR REPLACE FUNCTION ops.set_gmail_watch(
    p_owner uuid,
    p_mailbox text,
    p_expires timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
BEGIN
    IF p_owner IS NULL OR p_expires IS NULL OR position('@' in lower(btrim(coalesce(p_mailbox, '')))) = 0 THEN
        RETURN;
    END IF;
    UPDATE core.gmail_connection
       SET watch_expires_at = p_expires, updated_at = clock_timestamp()
     WHERE owner_id = p_owner
       AND mailbox_address = lower(btrim(p_mailbox));
END;
$$;

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
    PERFORM pg_notify('gmail_ingest', p_connection::text);
    RETURN jsonb_build_object('outcome', lower(v_disposition), 'job_id', v_job);
END;
$fn$;

UPDATE core.gmail_connection
   SET initial_window_drained = false, updated_at = clock_timestamp()
 WHERE initial_window_drained = true;

REVOKE ALL ON FUNCTION ops.save_gmail_spot_transaction(uuid, uuid, text, text, text, numeric, text, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.set_gmail_watch(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.save_gmail_spot_transaction(uuid, uuid, text, text, text, numeric, text, text, text, text, timestamptz, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.set_gmail_watch(uuid, text, timestamptz) TO monytix_api;
GRANT SELECT ON core.gmail_spot_transaction TO monytix_api;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'GMAIL-SPOT-ALERT',
    'Gmail spot transaction alerts',
    'OQ-11-open',
    'gmail-spot-body',
    'Email alerts are staged. They still cannot become current ledger truth.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
