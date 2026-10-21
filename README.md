# Monytix

Mobile apps talk only to the public API (`services/api`). Decision OS lives in `backend-monytix` and is reached through the API proxy (`FINANCE_BACKEND_URL`).

```
apps/                 iOS and Android clients
services/api          Public HTTP API (Firebase auth, Gmail, scanner workers)
backend-monytix/      Decision OS finance-api + finance-intelligence + Celery
packages/             Shared contracts, events, tokens, and fixtures
database/             SQL migrations, seeds, and checks
infrastructure/       Docker, Dokploy, monitoring, and backups
scripts/              Local development helpers
```

## Run locally

Copy `.env.example` to `.env`, then start the stack:

```powershell
.\scripts\dev.ps1
```

- API health: `http://localhost:8080/platform/health` (override publishes `8080`)
- Decision OS (`finance-api`): `http://localhost:8090/health`
- Finance intelligence: `http://localhost:8091/health`
- Postgres: external Supabase (`DATABASE_URL`)

Dokploy: see `infrastructure/dokploy/README.md`. Set `INTERNAL_TOKEN` and keep `FINANCE_BACKEND_URL=http://finance-api:8090`.

Apply schema changes with `.\scripts\migrate.ps1`. `dev.ps1` runs that migrator as part of compose. The Postgres image does not auto-run `database/migrations`.

API tests, from the repo root:

```powershell
npm install
npm test --workspace services/api
```

Schema changes belong in `database/migrations`. Verification and reconciliation SQL are checks, not migrations.
