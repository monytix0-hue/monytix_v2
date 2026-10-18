-- Keep the app schemas off the Supabase Data API. anon and authenticated
-- exist only on Supabase, so those revokes are skipped when the role is absent.
-- public.deployed_sql and the early public stubs are revoked the same way.

DO $revoke$
DECLARE
  app_schema text;
  api_role text;
  public_table text;
BEGIN
  FOREACH app_schema IN ARRAY ARRAY[
    'core', 'intel', 'evidence', 'context', 'action', 'experience', 'ref', 'ops', 'marketing', 'spendsense'
  ]
  LOOP
    IF to_regnamespace(app_schema) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', app_schema);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC', app_schema);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC', app_schema);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC', app_schema);
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
        EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', app_schema, api_role);
        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', app_schema, api_role);
        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', app_schema, api_role);
        EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %I', app_schema, api_role);
      END IF;
    END LOOP;
  END LOOP;

  FOREACH public_table IN ARRAY ARRAY[
    'public.deployed_sql', 'public.users', 'public.accounts', 'public.transactions',
    'public.sources', 'public.statements', 'public.decisions', 'public.missions', 'public.nudges'
  ]
  LOOP
    IF to_regclass(public_table) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC', public_table);
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', public_table);
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE %s FROM %I', public_table, api_role);
      END IF;
    END LOOP;
  END LOOP;
END
$revoke$;
