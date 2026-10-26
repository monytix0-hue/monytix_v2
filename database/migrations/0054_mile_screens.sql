-- Phone M.I.L.E. contract over the miles the outcomes sweeper already mints.

BEGIN;

CREATE OR REPLACE FUNCTION ops.mile_points_label(p_miles numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $label$
    SELECT CASE
        WHEN p_miles IS NULL THEN '0'
        WHEN p_miles = trunc(p_miles) THEN trunc(p_miles)::bigint::text
        ELSE trim(to_char(p_miles, 'FM999999990.99'))
    END;
$label$;

CREATE OR REPLACE FUNCTION ops.phone_mile_summary(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = action, ref, ops, pg_temp
AS $summary$
DECLARE
    v_end timestamptz;
    v_start timestamptz;
    v_year int;
    v_recent_miles numeric;
    v_recent_impact numeric;
    v_year_miles numeric;
    v_year_impact numeric;
    v_life_miles numeric;
    v_life_impact numeric;
    v_leader text;
    v_evolution text;
BEGIN
    IF p_owner IS NULL THEN
        RETURN jsonb_build_object(
            'contract', 'mile-summary-v0.1', 'empty_state', true,
            'period', jsonb_build_object('available', false),
            'distance', jsonb_build_object('available', false),
            'months', '[]'::jsonb,
            'impact', jsonb_build_object('available', false),
            'outcomes', '[]'::jsonb,
            'movement', jsonb_build_object('available', false),
            'report', jsonb_build_object('available', false),
            'lifetime', jsonb_build_object('available', false)
        );
    END IF;
    SELECT max(occurred_at) INTO v_end
      FROM action.mile_event
     WHERE owner_id = p_owner AND status = 'FINALIZED';
    IF v_end IS NULL THEN
        RETURN jsonb_build_object(
            'contract', 'mile-summary-v0.1', 'empty_state', true,
            'period', jsonb_build_object('available', false),
            'distance', jsonb_build_object('available', false),
            'months', '[]'::jsonb,
            'impact', jsonb_build_object('available', false),
            'outcomes', '[]'::jsonb,
            'movement', jsonb_build_object('available', false),
            'report', jsonb_build_object('available', false),
            'lifetime', jsonb_build_object('available', false)
        );
    END IF;
    v_start := date_trunc('month', v_end) - interval '2 months';
    v_year := EXTRACT(YEAR FROM v_end)::int;

    SELECT coalesce(sum(mile_awarded), 0) INTO v_recent_miles
      FROM action.mile_event
     WHERE owner_id = p_owner AND status = 'FINALIZED'
       AND occurred_at >= v_start AND occurred_at <= v_end;
    SELECT coalesce(sum(i.amount), 0) INTO v_recent_impact
      FROM action.financial_impact_event i
      JOIN action.mile_event e ON e.financial_outcome_id = i.financial_outcome_id AND e.owner_id = i.owner_id
     WHERE i.owner_id = p_owner AND i.status = 'FINALIZED' AND e.status = 'FINALIZED'
       AND e.occurred_at >= v_start AND e.occurred_at <= v_end;

    SELECT coalesce(sum(mile_awarded), 0) INTO v_year_miles
      FROM action.mile_event
     WHERE owner_id = p_owner AND status = 'FINALIZED' AND EXTRACT(YEAR FROM occurred_at) = v_year;
    SELECT coalesce(sum(i.amount), 0) INTO v_year_impact
      FROM action.financial_impact_event i
      JOIN action.mile_event e ON e.financial_outcome_id = i.financial_outcome_id AND e.owner_id = i.owner_id
     WHERE i.owner_id = p_owner AND i.status = 'FINALIZED' AND e.status = 'FINALIZED'
       AND EXTRACT(YEAR FROM e.occurred_at) = v_year;

    SELECT coalesce(sum(mile_awarded), 0) INTO v_life_miles
      FROM action.mile_event
     WHERE owner_id = p_owner AND status = 'FINALIZED';
    SELECT coalesce(sum(amount), 0) INTO v_life_impact
      FROM action.financial_impact_event
     WHERE owner_id = p_owner AND status = 'FINALIZED';

    SELECT f.title INTO v_leader
      FROM (
        VALUES
            ('MP', 'Safety'), ('DR', 'Debt'), ('MS', 'Savings'),
            ('WB', 'Wealth'), ('GF', 'Opportunity'), ('FC', 'Freedom')
      ) AS f(code, title)
      LEFT JOIN action.mile_event e
        ON e.outcome_family_code = f.code AND e.owner_id = p_owner AND e.status = 'FINALIZED'
       AND e.occurred_at >= v_start AND e.occurred_at <= v_end
     GROUP BY f.title
     ORDER BY coalesce(sum(e.mile_awarded), 0) DESC, f.title
     LIMIT 1;

    SELECT f.title INTO v_evolution
      FROM (
        VALUES
            ('MP', 'Safety'), ('DR', 'Debt'), ('MS', 'Savings'),
            ('WB', 'Wealth'), ('GF', 'Opportunity'), ('FC', 'Freedom')
      ) AS f(code, title)
      LEFT JOIN action.mile_event e ON e.outcome_family_code = f.code AND e.owner_id = p_owner AND e.status = 'FINALIZED'
       AND EXTRACT(YEAR FROM e.occurred_at) = v_year
      LEFT JOIN action.financial_impact_event i
        ON i.financial_outcome_id = e.financial_outcome_id AND i.owner_id = e.owner_id AND i.status = 'FINALIZED'
     GROUP BY f.title
     ORDER BY coalesce(sum(i.amount), 0) DESC, f.title
     LIMIT 1;

    RETURN jsonb_build_object(
        'contract', 'mile-summary-v0.1',
        'empty_state', false,
        'period', jsonb_build_object('available', true, 'label', 'Last 3 months'),
        'distance', jsonb_build_object('available', true, 'value', ops.mile_points_label(v_recent_miles), 'line', 'Across the last 3 months.'),
        'months', coalesce((
            SELECT jsonb_agg(jsonb_build_object('label', label, 'value', ops.mile_points_label(miles)) ORDER BY month_key)
              FROM (
                SELECT to_char(e.occurred_at, 'YYYY-MM') AS month_key,
                       to_char(e.occurred_at, 'Mon') AS label,
                       sum(e.mile_awarded) AS miles
                  FROM action.mile_event e
                 WHERE e.owner_id = p_owner AND e.status = 'FINALIZED'
                   AND e.occurred_at >= v_start AND e.occurred_at <= v_end
                 GROUP BY 1, 2
                HAVING sum(e.mile_awarded) > 0
              ) months
        ), '[]'::jsonb),
        'impact', jsonb_build_object(
            'available', v_recent_impact > 0,
            'amount', CASE WHEN v_recent_impact > 0 THEN ops.format_inr(v_recent_impact) ELSE NULL END,
            'line', 'Positive financial impact'
        ),
        'outcomes', coalesce((
            SELECT jsonb_agg(row_doc ORDER BY sort_key)
              FROM (
                SELECT f.sort_key,
                       jsonb_build_object(
                           'id', f.code,
                           'title', f.title,
                           'line', f.line,
                           'amount', CASE WHEN coalesce(sum(i.amount), 0) > 0 THEN ops.format_inr(sum(i.amount)) ELSE NULL END,
                           'miles', ops.mile_points_label(coalesce(sum(e.mile_awarded), 0)),
                           'share', CASE WHEN v_recent_impact > 0 THEN round(coalesce(sum(i.amount), 0) / v_recent_impact * 100)::int::text || '%' ELSE NULL END,
                           'drivers', coalesce(string_agg(DISTINCT m.title, ' · '), ''),
                           'recent', coalesce(to_char(max(e.occurred_at), 'DD Mon YYYY'), ''),
                           'actions', count(e.mile_event_id)::text
                       ) AS row_doc
                  FROM (
                    VALUES
                        (1, 'MP', 'Safety', 'Protection & resilience'),
                        (2, 'DR', 'Debt', 'Commitments reduced'),
                        (3, 'MS', 'Savings', 'Cash retained'),
                        (4, 'WB', 'Wealth', 'Future assets built'),
                        (5, 'GF', 'Opportunity', 'New capacity opened'),
                        (6, 'FC', 'Freedom', 'More financial flexibility')
                  ) AS f(sort_key, code, title, line)
                  JOIN action.mile_event e
                    ON e.outcome_family_code = f.code AND e.owner_id = p_owner AND e.status = 'FINALIZED'
                   AND e.occurred_at >= v_start AND e.occurred_at <= v_end
                  LEFT JOIN action.financial_impact_event i
                    ON i.financial_outcome_id = e.financial_outcome_id AND i.owner_id = e.owner_id AND i.status = 'FINALIZED'
                  LEFT JOIN action.mission m ON m.mission_id = e.mission_id
                 GROUP BY f.sort_key, f.code, f.title, f.line
                HAVING coalesce(sum(e.mile_awarded), 0) > 0 OR coalesce(sum(i.amount), 0) > 0
              ) built
        ), '[]'::jsonb),
        'movement', jsonb_build_object('available', true, 'line', coalesce(v_leader, 'Safety') || ' led this period.'),
        'report', jsonb_build_object(
            'available', true,
            'year', v_year::text,
            'distance', ops.mile_points_label(v_year_miles),
            'impact', ops.format_inr(v_year_impact),
            'line', 'Decisions, missions, and verified impact from this year.',
            'evolution', CASE WHEN v_year_impact > 0 THEN v_evolution ELSE NULL END,
            'numbers', jsonb_build_array(
                jsonb_build_object('label', 'Money protected', 'value', ops.format_inr(coalesce((
                    SELECT sum(i.amount) FROM action.mile_event e
                    LEFT JOIN action.financial_impact_event i ON i.financial_outcome_id = e.financial_outcome_id AND i.owner_id = e.owner_id AND i.status = 'FINALIZED'
                    WHERE e.owner_id = p_owner AND e.status = 'FINALIZED' AND e.outcome_family_code = 'MP' AND EXTRACT(YEAR FROM e.occurred_at) = v_year
                ), 0))),
                jsonb_build_object('label', 'Debt reduced', 'value', ops.format_inr(coalesce((
                    SELECT sum(i.amount) FROM action.mile_event e
                    LEFT JOIN action.financial_impact_event i ON i.financial_outcome_id = e.financial_outcome_id AND i.owner_id = e.owner_id AND i.status = 'FINALIZED'
                    WHERE e.owner_id = p_owner AND e.status = 'FINALIZED' AND e.outcome_family_code = 'DR' AND EXTRACT(YEAR FROM e.occurred_at) = v_year
                ), 0))),
                jsonb_build_object('label', 'Money saved', 'value', ops.format_inr(coalesce((
                    SELECT sum(i.amount) FROM action.mile_event e
                    LEFT JOIN action.financial_impact_event i ON i.financial_outcome_id = e.financial_outcome_id AND i.owner_id = e.owner_id AND i.status = 'FINALIZED'
                    WHERE e.owner_id = p_owner AND e.status = 'FINALIZED' AND e.outcome_family_code = 'MS' AND EXTRACT(YEAR FROM e.occurred_at) = v_year
                ), 0))),
                jsonb_build_object('label', 'Wealth built', 'value', ops.format_inr(coalesce((
                    SELECT sum(i.amount) FROM action.mile_event e
                    LEFT JOIN action.financial_impact_event i ON i.financial_outcome_id = e.financial_outcome_id AND i.owner_id = e.owner_id AND i.status = 'FINALIZED'
                    WHERE e.owner_id = p_owner AND e.status = 'FINALIZED' AND e.outcome_family_code = 'WB' AND EXTRACT(YEAR FROM e.occurred_at) = v_year
                ), 0))),
                jsonb_build_object('label', 'Decisions carried through', 'value', (
                    SELECT count(DISTINCT e.decision_id)::text FROM action.mile_event e
                    WHERE e.owner_id = p_owner AND e.status = 'FINALIZED' AND e.decision_id IS NOT NULL AND EXTRACT(YEAR FROM e.occurred_at) = v_year
                )),
                jsonb_build_object('label', 'Missions advanced', 'value', (
                    SELECT count(DISTINCT e.mission_id)::text FROM action.mile_event e
                    WHERE e.owner_id = p_owner AND e.status = 'FINALIZED' AND e.mission_id IS NOT NULL AND EXTRACT(YEAR FROM e.occurred_at) = v_year
                )),
                jsonb_build_object('label', 'Milestones reached', 'value', (
                    SELECT count(*)::text FROM action.mile_event e
                    WHERE e.owner_id = p_owner AND e.status = 'FINALIZED'
                      AND e.event_type IN ('MISSION_MILESTONE', 'MISSION_COMPLETION')
                      AND EXTRACT(YEAR FROM e.occurred_at) = v_year
                ))
            )
        ),
        'lifetime', jsonb_build_object(
            'available', true,
            'distance', ops.mile_points_label(v_life_miles),
            'impact', ops.format_inr(v_life_impact),
            'line', 'Your financial evolution doesn''t reset each year. It keeps building.',
            'years', coalesce((
                SELECT jsonb_agg(jsonb_build_object('label', yr, 'value', ops.mile_points_label(miles)) ORDER BY yr)
                  FROM (
                    SELECT EXTRACT(YEAR FROM occurred_at)::int::text AS yr, sum(mile_awarded) AS miles
                      FROM action.mile_event
                     WHERE owner_id = p_owner AND status = 'FINALIZED'
                     GROUP BY 1
                  ) years
            ), '[]'::jsonb),
            'built', coalesce((
                SELECT jsonb_agg(jsonb_build_object('label', built, 'value', ops.mile_points_label(miles)) ORDER BY sort_key)
                  FROM (
                    SELECT f.sort_key, f.built, sum(e.mile_awarded) AS miles
                      FROM (
                        VALUES
                            (1, 'MP', 'Safety & resilience'),
                            (2, 'DR', 'Debt & commitments'),
                            (3, 'MS', 'Saving & cash flow'),
                            (4, 'WB', 'Wealth building'),
                            (5, 'GF', 'Opportunity'),
                            (6, 'FC', 'Freedom')
                      ) AS f(sort_key, code, built)
                      JOIN action.mile_event e ON e.outcome_family_code = f.code AND e.owner_id = p_owner AND e.status = 'FINALIZED'
                     GROUP BY f.sort_key, f.built
                    HAVING sum(e.mile_awarded) > 0
                  ) built
            ), '[]'::jsonb)
        )
    );
END;
$summary$;

CREATE OR REPLACE FUNCTION ops.phone_mile_events(p_owner uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = action, ops, pg_temp
AS $events$
    SELECT jsonb_build_object(
        'contract', 'mile-events-v0.1',
        'events', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'id', e.mile_event_id::text,
                'title', coalesce(m.title, CASE e.outcome_family_code
                    WHEN 'MP' THEN 'Safety' WHEN 'DR' THEN 'Debt' WHEN 'MS' THEN 'Savings'
                    WHEN 'WB' THEN 'Wealth' WHEN 'GF' THEN 'Opportunity' WHEN 'FC' THEN 'Freedom'
                    ELSE 'Verified impact' END),
                'line', CASE WHEN i.amount > 0 THEN ops.format_inr(i.amount) ELSE 'Verified impact' END,
                'miles', ops.mile_points_label(e.mile_awarded)
            ) ORDER BY e.occurred_at DESC)
              FROM action.mile_event e
              LEFT JOIN action.mission m ON m.mission_id = e.mission_id
              LEFT JOIN LATERAL (
                SELECT sum(amount) AS amount
                  FROM action.financial_impact_event
                 WHERE financial_outcome_id = e.financial_outcome_id AND owner_id = e.owner_id AND status = 'FINALIZED'
              ) i ON true
             WHERE e.owner_id = p_owner AND e.status = 'FINALIZED'
        ), '[]'::jsonb)
    );
$events$;

CREATE OR REPLACE FUNCTION ops.phone_mile_event(p_owner uuid, p_event uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = action, ops, pg_temp
AS $event$
    SELECT CASE WHEN e.mile_event_id IS NULL THEN NULL ELSE jsonb_build_object(
        'event', jsonb_build_object(
            'id', e.mile_event_id::text,
            'title', coalesce(m.title, 'Verified impact'),
            'line', CASE WHEN coalesce(i.amount, 0) > 0 THEN ops.format_inr(i.amount) ELSE 'Verified impact' END,
            'miles', ops.mile_points_label(e.mile_awarded),
            'when', to_char(e.occurred_at, 'DD Mon YYYY'),
            'changed', CASE
                WHEN coalesce(i.amount, 0) > 0 THEN ops.format_inr(i.amount) || ' counted toward ' || CASE e.outcome_family_code
                    WHEN 'MP' THEN 'Safety' WHEN 'DR' THEN 'Debt' WHEN 'MS' THEN 'Savings'
                    WHEN 'WB' THEN 'Wealth' WHEN 'GF' THEN 'Opportunity' WHEN 'FC' THEN 'Freedom'
                    ELSE 'this outcome' END || '.'
                ELSE ops.mile_points_label(e.mile_awarded) || ' miles recorded.'
            END,
            'decision_id', d.decision_id::text,
            'decision', d.title
        )
    ) END
      FROM action.mile_event e
      LEFT JOIN action.mission m ON m.mission_id = e.mission_id
      LEFT JOIN action.decision d ON d.decision_id = e.decision_id
      LEFT JOIN LATERAL (
        SELECT sum(amount) AS amount
          FROM action.financial_impact_event
         WHERE financial_outcome_id = e.financial_outcome_id AND owner_id = e.owner_id AND status = 'FINALIZED'
      ) i ON true
     WHERE e.owner_id = p_owner AND e.mile_event_id = p_event AND e.status = 'FINALIZED';
$event$;

REVOKE ALL ON FUNCTION ops.phone_mile_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.phone_mile_events(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.phone_mile_event(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.phone_mile_summary(uuid) TO monytix_api, monytix_finance;
GRANT EXECUTE ON FUNCTION ops.phone_mile_events(uuid) TO monytix_api, monytix_finance;
GRANT EXECUTE ON FUNCTION ops.phone_mile_event(uuid, uuid) TO monytix_api, monytix_finance;

DO $check$
DECLARE
    v_doc jsonb;
BEGIN
    v_doc := ops.phone_mile_summary('00000000-0000-0000-0000-000000000000');
    IF v_doc->>'contract' IS DISTINCT FROM 'mile-summary-v0.1' OR (v_doc->>'empty_state')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'empty mile summary failed';
    END IF;
    IF ops.mile_points_label(30) IS DISTINCT FROM '30' THEN
        RAISE EXCEPTION 'mile points label failed';
    END IF;
END;
$check$;

INSERT INTO ops.schema_migration (migration_code, migration_name, architecture_version, checksum_hint, notes)
VALUES (
    'MILE-SCREENS',
    'Return the phone M.I.L.E. contract from finalized outcomes',
    'OQ-11-open',
    'mile-screens',
    'Six frames share one summary. Miles come from finalized outcome events.'
)
ON CONFLICT (migration_code) DO UPDATE
SET migration_name = EXCLUDED.migration_name,
    architecture_version = EXCLUDED.architecture_version,
    checksum_hint = EXCLUDED.checksum_hint,
    notes = EXCLUDED.notes;

COMMIT;
