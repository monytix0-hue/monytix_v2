-- Record mission progress and return the phone mission contract.

BEGIN;

CREATE TABLE IF NOT EXISTS action.mission_progress_event (
    mission_progress_event_id uuid PRIMARY KEY DEFAULT ops.uuid_v7(),
    owner_id                  uuid NOT NULL REFERENCES core.owner(owner_id) ON DELETE RESTRICT,
    mission_id                uuid NOT NULL REFERENCES action.mission(mission_id) ON DELETE RESTRICT,
    amount                    numeric(14, 2) NOT NULL CHECK (amount > 0),
    note                      text,
    idempotency_key           text NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_mission_progress_idempotency UNIQUE (owner_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_mission_progress_mission ON action.mission_progress_event (mission_id, created_at DESC);

ALTER TABLE action.mission_progress_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_action_mission_progress ON action.mission_progress_event;
CREATE POLICY pol_action_mission_progress ON action.mission_progress_event
    FOR ALL USING (owner_id = ops.current_owner_id()) WITH CHECK (owner_id = ops.current_owner_id());

GRANT SELECT, INSERT ON action.mission_progress_event TO monytix_finance, monytix_api;

CREATE OR REPLACE FUNCTION ops.mission_progress_label(p_state text, p_current numeric, p_target numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $label$
    SELECT CASE
        WHEN p_state = 'COMPLETED' THEN 'Complete'
        WHEN coalesce(p_target, 0) > 0 THEN ops.format_inr(coalesce(p_current, 0)) || ' of ' || ops.format_inr(p_target)
        WHEN coalesce(p_current, 0) > 0 THEN ops.format_inr(p_current)
        ELSE 'Started'
    END;
$label$;

CREATE OR REPLACE FUNCTION ops.weight_display_names(p_codes text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $names$
    SELECT coalesce(array_agg(
        CASE code
            WHEN 'W01_TIME' THEN 'Time'
            WHEN 'W02_COMFORT' THEN 'Comfort'
            WHEN 'W03_RISK' THEN 'Risk'
            WHEN 'W04_OBLIGATIONS' THEN 'Obligations'
            WHEN 'W05_IDENTITY' THEN 'Identity'
            WHEN 'W06_RELATIONSHIPS' THEN 'Relationships'
            WHEN 'W07_OPPORTUNITY' THEN 'Opportunity'
            WHEN 'W08_ATTENTION' THEN 'Attention'
            WHEN 'W09_RESILIENCE' THEN 'Resilience'
            WHEN 'W10_LEGACY' THEN 'Legacy'
            ELSE code
        END
        ORDER BY ordinality
    ), '{}'::text[])
      FROM unnest(coalesce(p_codes, '{}'::text[])) WITH ORDINALITY AS weight(code, ordinality);
$names$;

CREATE OR REPLACE FUNCTION ops.phone_mission_definition(p_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ref, ops, pg_temp
AS $definition$
    SELECT jsonb_build_object(
        'code', m.canonical_mission_code,
        'title', m.display_name,
        'category', m.category,
        'basis', m.measurement_basis,
        'weights', to_jsonb(ops.weight_display_names(m.primary_weight_codes)),
        'decisions', coalesce((
            SELECT jsonb_agg(DISTINCT f.decision_family_code ORDER BY f.decision_family_code)
              FROM ref.mission_decision_orbit o
              JOIN ref.decision_family f ON f.decision_family_version_id = o.decision_family_version_id
             WHERE o.mission_definition_version_id = m.mission_definition_version_id
        ), '[]'::jsonb),
        'build', m.product_need_class
    )
      FROM ref.mission_definition m
     WHERE m.canonical_mission_code = p_code
       AND m.status = 'ACTIVE'
     ORDER BY m.definition_version DESC
     LIMIT 1;
$definition$;

CREATE OR REPLACE FUNCTION ops.create_user_mission(
    p_owner uuid,
    p_code text,
    p_reach numeric,
    p_current numeric
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = action, ref, ops, pg_temp
AS $create$
DECLARE
    v_def ref.mission_definition%ROWTYPE;
    v_id uuid;
    v_target jsonb;
BEGIN
    IF p_owner IS NULL OR p_code IS NULL OR coalesce(p_reach, 0) <= 0 THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_def
      FROM ref.mission_definition
     WHERE canonical_mission_code = p_code
       AND status = 'ACTIVE'
     ORDER BY definition_version DESC
     LIMIT 1;
    IF v_def.mission_definition_version_id IS NULL THEN
        RETURN NULL;
    END IF;
    v_target := jsonb_build_object(
        'default_target_inr', p_reach,
        'current_inr', coalesce(p_current, 0),
        'metric_basis', v_def.measurement_basis
    );
    INSERT INTO action.mission (
        owner_id, canonical_mission_definition_version_id, origin_type, state, title,
        target_definition, measurement_contract, completion_contract, current_progress_inr, idempotency_key
    ) VALUES (
        p_owner, v_def.mission_definition_version_id, 'USER_CREATED', 'ACTIVE', v_def.display_name,
        v_target, v_def.measurement_contract, v_def.completion_contract, coalesce(p_current, 0),
        'user-mission:' || p_code
    )
    ON CONFLICT (owner_id, idempotency_key) DO UPDATE
       SET target_definition = EXCLUDED.target_definition,
           current_progress_inr = GREATEST(action.mission.current_progress_inr, EXCLUDED.current_progress_inr),
           updated_at = clock_timestamp()
     WHERE action.mission.state NOT IN ('COMPLETED', 'CANCELLED')
    RETURNING mission_id INTO v_id;
    IF v_id IS NULL THEN
        SELECT mission_id INTO v_id
          FROM action.mission
         WHERE owner_id = p_owner
           AND idempotency_key = 'user-mission:' || p_code;
    END IF;
    RETURN v_id;
END;
$create$;

CREATE OR REPLACE FUNCTION ops.add_mission_progress(
    p_owner uuid,
    p_mission uuid,
    p_amount numeric,
    p_note text,
    p_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = action, ops, pg_temp
AS $progress$
DECLARE
    v_mission action.mission%ROWTYPE;
    v_event uuid;
    v_target numeric;
    v_next numeric;
    v_state text;
BEGIN
    IF p_owner IS NULL OR p_mission IS NULL OR coalesce(p_amount, 0) <= 0 OR coalesce(p_key, '') = '' THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_mission
      FROM action.mission
     WHERE mission_id = p_mission
       AND owner_id = p_owner
     FOR UPDATE;
    IF v_mission.mission_id IS NULL OR v_mission.state NOT IN ('ACTIVE', 'PAUSED') THEN
        RETURN NULL;
    END IF;
    INSERT INTO action.mission_progress_event (owner_id, mission_id, amount, note, idempotency_key)
    VALUES (p_owner, p_mission, p_amount, nullif(btrim(coalesce(p_note, '')), ''), p_key)
    ON CONFLICT (owner_id, idempotency_key) DO NOTHING
    RETURNING mission_progress_event_id INTO v_event;
    v_target := coalesce((v_mission.target_definition->>'default_target_inr')::numeric, 0);
    v_next := v_mission.current_progress_inr;
    v_state := v_mission.state;
    IF v_event IS NOT NULL THEN
        v_next := v_mission.current_progress_inr + p_amount;
        v_state := CASE WHEN v_target > 0 AND v_next >= v_target THEN 'COMPLETED' ELSE v_mission.state END;
        UPDATE action.mission
           SET current_progress_inr = v_next,
               state = v_state,
               completed_at = CASE WHEN v_state = 'COMPLETED' THEN clock_timestamp() ELSE completed_at END,
               updated_at = clock_timestamp()
         WHERE mission_id = p_mission;
    ELSE
        SELECT current_progress_inr, state INTO v_next, v_state
          FROM action.mission
         WHERE mission_id = p_mission;
    END IF;
    RETURN jsonb_build_object(
        'mission_id', p_mission::text,
        'state', v_state,
        'current_progress_inr', v_next,
        'progress', ops.mission_progress_label(v_state, v_next, v_target)
    );
END;
$progress$;

CREATE OR REPLACE FUNCTION ops.phone_mission_board(p_owner uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = action, ref, ops, pg_temp
AS $board$
    WITH cards AS (
        SELECT m.mission_id::text AS id,
               m.title,
               coalesce(d.measurement_basis, d.category) AS line,
               d.category,
               CASE WHEN m.state = 'COMPLETED' THEN 'completed' ELSE 'active' END AS state,
               m.state AS raw_state,
               ops.mission_progress_label(
                   m.state,
                   m.current_progress_inr,
                   coalesce((m.target_definition->>'default_target_inr')::numeric, 0)
               ) AS progress,
               CASE
                   WHEN coalesce((m.target_definition->>'default_target_inr')::numeric, 0) > 0
                       THEN least(1, m.current_progress_inr / (m.target_definition->>'default_target_inr')::numeric)
                   WHEN m.current_progress_inr > 0 THEN 1
                   ELSE 0
               END AS progress_fraction
          FROM action.mission m
          JOIN ref.mission_definition d ON d.mission_definition_version_id = m.canonical_mission_definition_version_id
         WHERE m.owner_id = p_owner
           AND m.state IN ('ACTIVE', 'PAUSED', 'COMPLETED')
    ),
    active AS (
        SELECT * FROM cards WHERE raw_state IN ('ACTIVE', 'PAUSED')
    )
    SELECT jsonb_build_object(
        'contract', 'ui-missions-v0.1',
        'empty_state', NOT EXISTS (SELECT 1 FROM cards),
        'active_mission_count', (SELECT count(*) FROM active),
        'summary', jsonb_build_object(
            'available', EXISTS (SELECT 1 FROM active),
            'headline', CASE
                WHEN (SELECT count(*) FROM active) = 1 THEN (SELECT title FROM active LIMIT 1)
                WHEN (SELECT count(*) FROM active) > 1 THEN (SELECT count(*) FROM active)::text || ' missions'
                ELSE NULL
            END,
            'line', CASE WHEN EXISTS (SELECT 1 FROM active) THEN 'The things you have chosen to make happen.' ELSE NULL END,
            'pills', coalesce((
                SELECT jsonb_agg(DISTINCT category) FROM active WHERE category IS NOT NULL
            ), '[]'::jsonb)
        ),
        'active', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'id', id, 'title', title, 'line', line, 'progress', progress,
                'state', state, 'progress_fraction', progress_fraction
            ) ORDER BY title)
              FROM active
        ), '[]'::jsonb),
        'completed', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'id', id, 'title', title, 'line', line, 'progress', progress,
                'state', state, 'progress_fraction', progress_fraction
            ) ORDER BY title)
              FROM cards WHERE raw_state = 'COMPLETED'
        ), '[]'::jsonb)
    );
$board$;

CREATE OR REPLACE FUNCTION ops.phone_mission_detail(p_owner uuid, p_mission uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = action, ref, ops, pg_temp
AS $detail$
    SELECT jsonb_build_object(
        'mission', jsonb_build_object(
            'id', m.mission_id::text,
            'title', m.title,
            'line', coalesce(d.measurement_basis, d.category),
            'progress', ops.mission_progress_label(m.state, m.current_progress_inr, coalesce((m.target_definition->>'default_target_inr')::numeric, 0)),
            'state', CASE WHEN m.state = 'COMPLETED' THEN 'completed' ELSE 'active' END,
            'matters', d.measurement_basis,
            'impact', ops.mission_progress_label(m.state, m.current_progress_inr, coalesce((m.target_definition->>'default_target_inr')::numeric, 0)),
            'intelligence', array_to_string(ops.weight_display_names(d.primary_weight_codes), ' · '),
            'recent', coalesce((
                SELECT coalesce(e.note, ops.format_inr(e.amount) || ' recorded')
                  FROM action.mission_progress_event e
                 WHERE e.mission_id = m.mission_id
                 ORDER BY e.created_at DESC
                 LIMIT 1
            ), 'No progress recorded yet.'),
            'changed', CASE WHEN m.state = 'COMPLETED' THEN 'The target you set has been reached.' ELSE 'Progress is still short of the reach amount.' END,
            'proof', ops.mission_progress_label(m.state, m.current_progress_inr, coalesce((m.target_definition->>'default_target_inr')::numeric, 0)),
            'unlocks', 'Keep building this the way you already chose. ' || coalesce(d.product_need_class, d.measurement_basis)
        )
    )
      FROM action.mission m
      JOIN ref.mission_definition d ON d.mission_definition_version_id = m.canonical_mission_definition_version_id
     WHERE m.owner_id = p_owner
       AND m.mission_id = p_mission;
$detail$;

CREATE OR REPLACE FUNCTION ops.phone_mission_journal(p_owner uuid, p_mission uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = action, ops, pg_temp
AS $journal$
    SELECT CASE WHEN m.mission_id IS NULL THEN NULL ELSE jsonb_build_object(
        'since', ops.mission_progress_label(m.state, m.current_progress_inr, coalesce((m.target_definition->>'default_target_inr')::numeric, 0)),
        'entries', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'title', ops.format_inr(e.amount),
                'detail', coalesce(e.note, 'Progress recorded')
            ) ORDER BY e.created_at DESC)
              FROM action.mission_progress_event e
             WHERE e.mission_id = m.mission_id
        ), '[]'::jsonb)
    ) END
      FROM action.mission m
     WHERE m.owner_id = p_owner
       AND m.mission_id = p_mission;
$journal$;

CREATE OR REPLACE FUNCTION ops.phone_mission_completion(p_owner uuid, p_mission uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = action, ref, ops, pg_temp
AS $completion$
    SELECT jsonb_build_object(
        'mission', jsonb_build_object(
            'title', m.title,
            'changed', CASE WHEN m.state = 'COMPLETED' THEN 'The target you set has been reached.' ELSE 'Progress is still short of the reach amount.' END,
            'proof', ops.mission_progress_label(m.state, m.current_progress_inr, coalesce((m.target_definition->>'default_target_inr')::numeric, 0)),
            'unlocks', 'Keep building this the way you already chose. ' || coalesce(d.product_need_class, d.measurement_basis)
        )
    )
      FROM action.mission m
      JOIN ref.mission_definition d ON d.mission_definition_version_id = m.canonical_mission_definition_version_id
     WHERE m.owner_id = p_owner
       AND m.mission_id = p_mission;
$completion$;

REVOKE ALL ON FUNCTION ops.phone_mission_definition(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.create_user_mission(uuid, text, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.add_mission_progress(uuid, uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.phone_mission_board(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.phone_mission_detail(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.phone_mission_journal(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.phone_mission_completion(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.phone_mission_definition(text) TO monytix_api, monytix_finance;
GRANT EXECUTE ON FUNCTION ops.create_user_mission(uuid, text, numeric, numeric) TO monytix_api, monytix_finance;
GRANT EXECUTE ON FUNCTION ops.add_mission_progress(uuid, uuid, numeric, text, text) TO monytix_api, monytix_finance;
GRANT EXECUTE ON FUNCTION ops.phone_mission_board(uuid) TO monytix_api, monytix_finance;
GRANT EXECUTE ON FUNCTION ops.phone_mission_detail(uuid, uuid) TO monytix_api, monytix_finance;
GRANT EXECUTE ON FUNCTION ops.phone_mission_journal(uuid, uuid) TO monytix_api, monytix_finance;
GRANT EXECUTE ON FUNCTION ops.phone_mission_completion(uuid, uuid) TO monytix_api, monytix_finance;

DO $check$
DECLARE
    v_def jsonb;
BEGIN
    v_def := ops.phone_mission_definition('M01');
    IF v_def->>'title' IS DISTINCT FROM 'Build an Emergency Buffer' THEN
        RAISE EXCEPTION 'mission definition failed: %', v_def;
    END IF;
    IF ops.mission_progress_label('ACTIVE', 1000, 4000) IS DISTINCT FROM '₹1,000 of ₹4,000' THEN
        RAISE EXCEPTION 'mission progress label failed';
    END IF;
END;
$check$;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'MISSION-SCREENS',
    'Return the phone mission contract and record progress against a reach amount',
    'OQ-11-open',
    'mission-screens',
    'M01-M48 share one setup and detail flow. Progress is an amount and a note, not a product score.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
