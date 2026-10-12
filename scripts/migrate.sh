#!/bin/bash
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${API_DB_PASSWORD:?API_DB_PASSWORD is required}"
: "${INTELLIGENCE_DB_PASSWORD:?INTELLIGENCE_DB_PASSWORD is required}"

until pg_isready -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE"; do
  sleep 1
done

psql_value() {
  psql -tA -v ON_ERROR_STOP=1 -c "$1" | tr -d '[:space:]'
}

psql -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS public.deployed_sql (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);"

mark_applied() {
  psql -v ON_ERROR_STOP=1 -c "INSERT INTO public.deployed_sql (filename) VALUES ('$1') ON CONFLICT (filename) DO NOTHING;"
}

migration_registered() {
  local code="$1"
  if [ "$(psql_value "SELECT to_regclass('ops.schema_migration') IS NOT NULL")" != "t" ]; then
    return 1
  fi
  [ "$(psql_value "SELECT EXISTS (SELECT 1 FROM ops.schema_migration WHERE migration_code = '${code}')")" = "t" ]
}

if [ "$(psql_value "SELECT to_regclass('public.users') IS NOT NULL")" = "t" ]; then
  mark_applied "0001_init.sql"
fi

for file in $(find /database/migrations -maxdepth 1 -type f -name '*.sql' | sort); do
  name="$(basename "$file")"
  case "$name" in
    0002_d10_1_foundation.sql) code="D10-1" ;;
    0003_m1_ops_roles.sql) code="M1-OPS" ;;
    0004_d10_2_source_intake_canonical_ledger.sql) code="D10-2" ;;
    0005_m2_1_read_grants.sql) code="M2-1-GRANTS" ;;
    0006_m2_2_manual_transaction.sql) code="M2-2-MANUAL" ;;
    0007_m2_3_statement_upload.sql) code="M2-3-UPLOAD" ;;
    0008_m2_4_parser_v4_adapter.sql) code="M2-4-PARSER-V4" ;;
    0009_m2_5_statement_mapping.sql) code="M2-5-STATEMENT-MAPPING" ;;
    0010_m2_6_import_review.sql) code="M2-6-IMPORT-REVIEW" ;;
    0011_m2_7_parser_version.sql) code="M2-7-PARSER-VERSION" ;;
    0012_m2_8_account_binding.sql) code="M2-8-ACCOUNT-BINDING" ;;
    0013_m3_1_financial_event.sql) code="M3-1-FINANCIAL-EVENT" ;;
    0014_m3_2_f10e_taxonomy.sql) code="M3-2-F10E-TAXONOMY" ;;
    0015_m3_3_party_evidence.sql) code="M3-3-F10C-PARTY" ;;
    0016_m3_6_f10b_structure.sql) code="M3-6-F10B-STRUCTURE" ;;
    0017_m3_11_registry_foundation.sql) code="M3-11-REGISTRY-FOUNDATION" ;;
    0018_m3_15_temporal_collision_enforcement.sql) code="M3-15-TEMPORAL-COLLISION" ;;
    0019_m3_18_registry_write_integrity.sql) code="M3-18-WRITE-INTEGRITY" ;;
    0020_scan_claim_lease.sql) code="M3-19-SCAN-LEASE" ;;
    0021_canonical_current_date_index.sql) code="M3-20-CURRENT-DATE-INDEX" ;;
    *) code="" ;;
  esac

  if [ -n "$code" ] && migration_registered "$code"; then
    echo "Skipping ${name}; ${code} is already registered"
    mark_applied "$name"
    continue
  fi

  if [ "$(psql_value "SELECT EXISTS (SELECT 1 FROM public.deployed_sql WHERE filename = '${name}')")" = "t" ]; then
    echo "Skipping ${name}"
    continue
  fi

  echo "Applying ${file}"
  psql -v ON_ERROR_STOP=1 -f "$file"
  mark_applied "$name"
done

psql -v ON_ERROR_STOP=1 \
  -v api_password="$API_DB_PASSWORD" \
  -v intelligence_password="$INTELLIGENCE_DB_PASSWORD" \
  -f /database/bootstrap/passwords.sql

echo "Migrations applied"
