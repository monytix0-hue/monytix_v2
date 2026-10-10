-- M1 operational tables and application roles.
-- ops.outbox_event matches the D10-8 physical outbox so a later apply does not
-- create a second outbox. ops.idempotency_record is the D10 idempotency object.
-- This file does not create core.logical_transaction and does not load B10Q.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monytix_api') THEN
        CREATE ROLE monytix_api NOLOGIN NOINHERIT NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monytix_intelligence') THEN
        CREATE ROLE monytix_intelligence NOLOGIN NOINHERIT NOBYPASSRLS;
    END IF;
END $$;

ALTER ROLE monytix_api NOLOGIN NOINHERIT NOBYPASSRLS;
ALTER ROLE monytix_intelligence NOLOGIN NOINHERIT NOBYPASSRLS;

CREATE TABLE IF NOT EXISTS ops.outbox_event (
    outbox_event_id       uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id              uuid REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    semantic_trigger_code text NOT NULL,
    aggregate_type        text NOT NULL,
    aggregate_id          uuid,
    aggregate_version_ref text,
    event_payload         jsonb NOT NULL,
    trace_context         jsonb NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key            text NOT NULL,
    status                text NOT NULL DEFAULT 'PENDING',
    attempt_count         integer NOT NULL DEFAULT 0,
    available_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
    published_at          timestamptz,
    last_attempt_at       timestamptz,
    next_attempt_at       timestamptz,
    last_error_code       text,
    last_error_detail     text,
    created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (status IN ('PENDING','PUBLISHING','PUBLISHED','FAILED','DEAD_LETTER','CANCELLED')),
    CHECK (attempt_count >= 0),
    CHECK (btrim(semantic_trigger_code) <> '' AND btrim(aggregate_type) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_event_dedupe
    ON ops.outbox_event (COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), dedupe_key);
CREATE INDEX IF NOT EXISTS ix_outbox_publish_queue
    ON ops.outbox_event (status, available_at, next_attempt_at)
    WHERE status IN ('PENDING', 'FAILED');
CREATE INDEX IF NOT EXISTS ix_outbox_owner_created
    ON ops.outbox_event (owner_id, created_at DESC)
    WHERE owner_id IS NOT NULL;

COMMENT ON TABLE ops.outbox_event IS
'Physical D10-8 name for the conceptual ops.domain_event_outbox. Do not create a second outbox table.';

CREATE TABLE IF NOT EXISTS ops.idempotency_record (
    idempotency_record_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id              uuid REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    actor_id              uuid REFERENCES core.authenticated_actor(actor_id) ON DELETE RESTRICT,
    scope                 text NOT NULL,
    idempotency_key       text NOT NULL,
    request_hash          text NOT NULL,
    status                text NOT NULL DEFAULT 'IN_PROGRESS',
    response_code         integer,
    response_body         jsonb,
    created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at          timestamptz,
    CONSTRAINT ck_idempotency_scope CHECK (scope IN ('EXTERNAL_WRITE', 'JOB', 'CONSUMER')),
    CONSTRAINT ck_idempotency_status CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'CONFLICT')),
    CONSTRAINT ck_idempotency_key_nonblank CHECK (btrim(idempotency_key) <> '' AND btrim(request_hash) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_owner_scope_key
    ON ops.idempotency_record (
        scope,
        COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid),
        idempotency_key
    );

COMMENT ON TABLE ops.idempotency_record IS
'D10 idempotency object for external writes, jobs, and consumers. Extend this table; do not create another.';

ALTER TABLE ops.outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.idempotency_record ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_outbox_event_owner ON ops.outbox_event;
CREATE POLICY pol_outbox_event_owner
ON ops.outbox_event
FOR ALL
USING (owner_id = ops.current_owner_id())
WITH CHECK (owner_id = ops.current_owner_id());

DROP POLICY IF EXISTS pol_idempotency_owner ON ops.idempotency_record;
CREATE POLICY pol_idempotency_owner
ON ops.idempotency_record
FOR ALL
USING (owner_id = ops.current_owner_id())
WITH CHECK (owner_id = ops.current_owner_id());

CREATE OR REPLACE FUNCTION ops.provision_authenticated_actor(
    p_provider text,
    p_subject text,
    p_email text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
DECLARE
    v_actor uuid;
BEGIN
    IF p_provider IS NULL OR btrim(p_provider) = '' OR p_subject IS NULL OR btrim(p_subject) = '' THEN
        RAISE EXCEPTION 'provider and subject are required';
    END IF;

    INSERT INTO core.authenticated_actor (
        auth_provider,
        auth_subject,
        email,
        last_authenticated_at
    ) VALUES (
        btrim(p_provider),
        btrim(p_subject),
        NULLIF(btrim(COALESCE(p_email, '')), ''),
        clock_timestamp()
    )
    ON CONFLICT (auth_provider, auth_subject) DO UPDATE
        SET last_authenticated_at = clock_timestamp(),
            email = COALESCE(EXCLUDED.email, core.authenticated_actor.email)
    RETURNING actor_id INTO v_actor;

    RETURN v_actor;
END;
$$;

CREATE OR REPLACE FUNCTION ops.actor_can_access_owner(
    p_actor uuid,
    p_owner uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM core.actor_owner_membership
        WHERE actor_id = p_actor
          AND owner_id = p_owner
          AND membership_status = 'ACTIVE'
          AND effective_to IS NULL
          AND effective_from <= clock_timestamp()
    );
$$;

CREATE OR REPLACE FUNCTION ops.default_owner_for_actor(p_actor uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
    SELECT owner_id
    FROM core.actor_owner_membership
    WHERE actor_id = p_actor
      AND membership_status = 'ACTIVE'
      AND effective_to IS NULL
      AND effective_from <= clock_timestamp()
    ORDER BY is_default_owner DESC, created_at
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION ops.provision_authenticated_actor(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.actor_can_access_owner(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.default_owner_for_actor(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION ops.provision_authenticated_actor(text, text, text) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.actor_can_access_owner(uuid, uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.default_owner_for_actor(uuid) TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.uuid_v7() TO monytix_api;
GRANT EXECUTE ON FUNCTION ops.current_actor_id() TO monytix_api, monytix_intelligence;
GRANT EXECUTE ON FUNCTION ops.current_owner_id() TO monytix_api, monytix_intelligence;

GRANT USAGE ON SCHEMA core, ref, ops TO monytix_api;
GRANT USAGE ON SCHEMA core, ref, ops TO monytix_intelligence;

GRANT SELECT, INSERT, UPDATE ON
    core.authenticated_actor,
    core.owner,
    core.actor_owner_membership,
    core.financial_account,
    core.financial_account_instrument,
    core.account_ownership,
    core.account_currency_bucket
TO monytix_api;

GRANT SELECT ON ref.institution TO monytix_api, monytix_intelligence;
GRANT SELECT ON
    core.v_active_actor_owner_membership,
    core.v_active_account_ownership,
    core.v_current_owner_account
TO monytix_api;

GRANT SELECT, INSERT, UPDATE ON ops.outbox_event, ops.idempotency_record TO monytix_api;

REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core FROM monytix_intelligence;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ops FROM monytix_intelligence;

INSERT INTO ops.schema_migration (
    migration_code,
    migration_name,
    architecture_version,
    checksum_hint,
    notes
) VALUES (
    'M1-OPS',
    'Outbox, idempotency, and application roles',
    'D10 v1.2 FINAL FREEZE',
    'm1-ops-outbox-event-idempotency',
    'ops.outbox_event is the D10-8 physical outbox. Application roles do not bypass RLS.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
