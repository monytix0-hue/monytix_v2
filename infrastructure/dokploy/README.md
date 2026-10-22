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

## Staging checklist (Celery Beat + Live Gmail)

Continuous Decision OS sweeps require these compose services up with a **shared** `INTERNAL_TOKEN`:

- [ ] `redis` healthy (`redis-cli ping`)
- [ ] `finance-api` + `finance-intelligence` healthy
- [ ] `finance-celery-worker` — `celery -A app.celery_app.celery worker` on queues `intake,cash,holdings,obligations,reconciliation,context,decisions` (`-c 2`)
- [ ] `finance-celery-beat` — `celery -A app.celery_app.celery beat` with schedule file on volume `monytix_celerybeat` (`/var/run/celery/celerybeat-schedule`)
- [ ] `gmail-worker` — Node Live poller (`dist/gmail/poll-worker.js`) with Gmail env vars

Calibrated beat entries (UTC) in `backend-monytix/intelligence/app/celery_app.py`:

| Beat key | Task | Schedule |
| --- | --- | --- |
| `renew-gmail-watch` | `app.tasks.renew_gmail_watch` | daily `22:30` |
| `fetch-fx-rates` | `app.tasks.fetch_fx_rates` | daily `23:00` |
| `periodic-forex-reconciliation-sweep` | `app.tasks.reconcile_forex_fees` | every `*/30` min |
| `periodic-outcomes-mile-sweep` | `app.tasks.reconcile_outcomes_mile` | every `*/15` min |
| `periodic-decision-expiry-check` | `app.tasks.sweep_expired_snoozes` | hourly at `:05` |

Local functional probe (no broker required for sync mode):

```bash
FINANCE_API_URL=http://127.0.0.1:8090 INTELLIGENCE_URL=http://127.0.0.1:8091 \
  PROBE_MODE=sync backend-monytix/intelligence/.venv/bin/python scripts/probe_celery_tasks.py
```

With Redis + worker running, set `PROBE_MODE=async` and `REDIS_URL=redis://127.0.0.1:6379/0`.

### Database notes for Decision OS apply path

- Migrations through `0043_financial_subcategories.sql` (and later) should be applied via `migrator`.
- `ops.uuid_v7` must call `public.gen_random_bytes` (SECURITY DEFINER wrapper in `database/bootstrap/pgcrypto_compat.sql`) so `monytix_api` can mint IDs without `USAGE` on schema `extensions`.
