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

for file in $(find /database/migrations -maxdepth 1 -type f -name '*.sql' | sort); do
  echo "Applying ${file}"
  psql -v ON_ERROR_STOP=1 -f "$file"
done

psql -v ON_ERROR_STOP=1 \
  -v api_password="$API_DB_PASSWORD" \
  -v intelligence_password="$INTELLIGENCE_DB_PASSWORD" \
  -f /database/bootstrap/passwords.sql

echo "Migrations applied"
