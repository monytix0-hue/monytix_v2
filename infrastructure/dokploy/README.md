# Dokploy

Deploy the root [docker-compose.yml](../../docker-compose.yml) from the repository root. Dokploy should build with the repo root as context so Dockerfiles can see `services/*` and `backend-monytix/*`.

Dokploy loads only `docker-compose.yml` (not `docker-compose.override.yml`).

## Services

| Service | Role | Port |
|--------|------|------|
| `migrator` | Apply `database/migrations` then exit | — |
| `api` | Public Fastify edge (Firebase auth) | expose `8080` |
| `scanner` / `gmail-worker` | Statement scan + Gmail poll | — |
| `clamav` | Malware scan | internal `3310` |
| `redis` | Celery broker + finance home cache | internal `6379` |
| `mongo` | Finance raw ingest + Gmail credentials | internal `27017` |
| `finance-api` | Decision OS (`backend-monytix/api`) | expose `8090` |
| `finance-intelligence` | Normalize / extract / evaluate | internal `8091` |
| `finance-celery-worker` / `finance-celery-beat` | Async Decision OS jobs | — |

Public `api` proxies Decision OS routes to `FINANCE_BACKEND_URL` (default `http://finance-api:8090`).

## Required Dokploy environment

Copy from [.env.example](../../.env.example). At minimum set:

- Postgres: `POSTGRES_*`, `DATABASE_URL`, `INTELLIGENCE_DATABASE_URL`, `API_DB_PASSWORD`, `INTELLIGENCE_DB_PASSWORD`
- Auth: `FIREBASE_PROJECT_ID` and either `GOOGLE_APPLICATION_CREDENTIALS` (mounted file) or `GOOGLE_CREDENTIALS_JSON`
- Object storage: `OBJECT_STORAGE_*`
- Decision OS: `INTERNAL_TOKEN` (long random secret shared by finance-api, finance-intelligence, and Celery)
- Optional Gmail / AA: `GMAIL_*`, `AA_*`, `AA_FIU_PRIVATE_KEY`

Do not commit real passwords. Generate `INTERNAL_TOKEN` once and keep it stable across redeploys so in-flight Celery jobs keep authenticating.

## Health checks

- Edge: `GET /platform/ready` on `api`
- Decision OS: `GET /health` on `finance-api` (`:8090`) and `finance-intelligence` (`:8091`)
