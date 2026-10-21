# Monytix

Mobile apps talk only to the API. The API owns HTTP, auth, and persistence. The intelligence service owns parsing, classification, and scoring, and is reachable only on the internal network.

```
apps/                 iOS and Android clients
services/api          Public HTTP API
services/intelligence Internal parsing, classification, and scoring
packages/             Shared contracts, events, tokens, and fixtures
database/             SQL migrations, seeds, and checks
infrastructure/       Docker, Dokploy, monitoring, and backups
docs/                 Ownership and boundary outlines
scripts/              Local development helpers
```

## Run locally

Copy `.env.example` to `.env`, then start Postgres, the API, and intelligence:

```powershell
.\scripts\dev.ps1
```

- API health: `http://localhost:8080/platform/health` (override publishes `8080`)
- Decision OS (`finance-api`): `http://localhost:8090/health` when compose override is loaded
- Legacy `intelligence` stays on the compose network; finance-intelligence is on `8091` locally
- Postgres: external Supabase (`DATABASE_URL`)

Dokploy: see `infrastructure/dokploy/README.md`. Set `INTERNAL_TOKEN` and keep `FINANCE_BACKEND_URL=http://finance-api:8090`.

Apply schema changes with `.\scripts\migrate.ps1`. `dev.ps1` runs that migrator as part of compose. The Postgres image does not auto-run `database/migrations`.

API tests, from the repo root:

```powershell
npm install
npm test --workspace services/api
```

Intelligence tests:

```powershell
cd services/intelligence
python -m pip install -e ".[dev]"
python -m pytest
```

Schema changes belong in `database/migrations`. Verification and reconciliation SQL are checks, not migrations.
