-- Supabase installs pgcrypto in the extensions schema. The ledger calls
-- public.digest and ops.uuid_v7 calls gen_random_bytes. Local Postgres keeps
-- those functions in public, so this file only fills the Supabase gap.

DO $compat$
BEGIN
  IF to_regnamespace('extensions') IS NOT NULL
     AND to_regprocedure('extensions.digest(bytea, text)') IS NOT NULL
     AND to_regprocedure('public.digest(bytea, text)') IS NULL THEN
    CREATE FUNCTION public.digest(data bytea, type text)
    RETURNS bytea
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $fn$ SELECT extensions.digest(data, type) $fn$;
    GRANT EXECUTE ON FUNCTION public.digest(bytea, text) TO PUBLIC;
  END IF;


  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NOT NULL
     AND to_regprocedure('public.gen_random_bytes(integer)') IS NULL THEN
    CREATE FUNCTION public.gen_random_bytes(length integer)
    RETURNS bytea
    LANGUAGE sql
    VOLATILE
    PARALLEL SAFE
    SECURITY DEFINER
    SET search_path = pg_catalog, extensions
    AS $fn$ SELECT extensions.gen_random_bytes(length) $fn$;
    GRANT EXECUTE ON FUNCTION public.gen_random_bytes(integer) TO PUBLIC;
  END IF;

  IF to_regprocedure('ops.uuid_v7()') IS NOT NULL THEN
    ALTER FUNCTION ops.uuid_v7() SET search_path = pg_catalog, public, extensions;
  END IF;
END
$compat$;
