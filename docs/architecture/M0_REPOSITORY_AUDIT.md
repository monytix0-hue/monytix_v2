# M0 Repository Audit

Status: audit only. No schema was applied, no engine was rewritten, and no mobile screen was changed.

Labels used below:

- **SOURCE_REQUIREMENT** — stated by a supplied specification.
- **ARCHITECTURAL_PROPOSAL** — a Monytix implementation choice that does not change the source rule.
- **OPEN_DECISION** — unresolved. See `M0_CONFLICT_REGISTER.md` and `M0_OPEN_QUESTIONS.md`.

Working status is not inferred from file existence. A subsystem is `EXISTING_WORKING` only where this audit executed a check or read an implementation that performs the claimed behavior. Stub modules that return `{status: "stub"}` are not financial engines.

## 1. Existing implementation inventory

Inventory date: 2026-10-10. Repository root: `g:\MOnytix+v2`.

209 project files were listed, excluding `node_modules`, Python virtualenv, pytest cache, `__pycache__`, `.git`, and egg-info. That count includes specification archives, generated `services/api/dist`, Gradle wrapper, and `.DS_Store` files.

### 1.1 Root

| Path | What it is | Classification |
| --- | --- | --- |
| `README.md` | States that mobile calls only the API, the API owns HTTP/auth/persistence, and intelligence owns parsing, classification, and scoring | EXISTING_WORKING as an orientation note; PARTIAL as an architecture |
| `package.json` | npm workspace containing only `services/api` | EXISTING_WORKING |
| `docker-compose.yml` | Postgres, API, intelligence | PARTIAL |
| `.env.example` | Local Postgres and port defaults. No Firebase, Redis, storage, or FCM variables | PARTIAL |
| `frs/` | Authoritative input archives and workbooks | EXISTING_WORKING as supplied inputs |
| `Monytix/` | Nested directory containing `.git` and `.DS_Store` only. No application source | MISSING as a product tree |
| `apk/` | `.DS_Store` only. No APK | MISSING |

### 1.2 Public API — `services/api`

Fastify 5 application (`services/api/src/app.ts`) registers thirteen route plugins. Each domain route returns a typed stub. Example: `GET /transactions` returns `{ module: "transactions", status: "stub" }` (`services/api/src/transactions/routes.ts`). `pg` is declared in `package.json` and is not imported by `src`. There is no Firebase token verification, no database repository, no idempotency key handling, and no call to the intelligence service.

Executed on 2026-10-10: `npm test --workspace services/api` — 13 passed, 0 failed. Every assertion checks the stub or health payload. This is evidence that the HTTP skeleton boots under `tsx`. It is not evidence of financial behavior.

Classification: **EXISTING_WORKING** as a stub HTTP process. **MISSING** as a financial API.

### 1.3 Intelligence — `services/intelligence`

FastAPI app exposes `GET /health` (`app/main.py`). Packages exist for parsing, UPI, rulebook, classification, counterparties, evidence, personal weights, decisions, missions, outcomes, M.I.L.E., habits, nudges, MolyBot, and business FIO. Each function ignores its payload and returns `ModuleResult(status="stub")` (`app/result.py`). `workers/runner.py` prints `intelligence worker stub`. `pyproject.toml` depends on FastAPI and Uvicorn only. Celery, Redis, Pydantic models, SQLAlchemy, and psycopg are not declared.

Executed on 2026-10-10: `pytest -q` — 15 passed. Each test asserts `status == "stub"`.

Classification: **EXISTING_WORKING** as a stub package layout. **MISSING** as parsing, classification, or intelligence.

### 1.4 Database — `database/`

`database/migrations/0001_init.sql` creates eight public tables (`users`, `accounts`, `transactions`, `sources`, `statements`, `decisions`, `missions`, `nudges`) with `id` and `created_at` only. No amount, direction, owner, provenance, or uniqueness constraints.

`database/seeds/001_dev.sql` is an empty comment. `database/reconciliation/001_placeholder.sql` and `database/verification/001_placeholder.sql` are comments, not checks.

D10 v1.2 and B10Q SQL packs are inside `frs/` archives. They are not installed as repository migrations.

Classification: **PARTIAL** scaffold. **CONFLICTING** with D10 v1.2 and B10Q. **BLOCKED** for execution until the conflict register is resolved. No migration was applied during M0.

### 1.5 Contracts — `packages/`

`packages/api-contracts/openapi.yaml` is OpenAPI 3.1 and mirrors the stub GET routes. It does not contain F9 payload dictionaries.

`packages/domain-events/` has six JSON Schemas (`transaction.ingested`, `statement.parsed`, `classification.completed`, `decision.issued`, `mission.updated`, `nudge.scheduled`). Payloads carry a single id. They are not the F9 or B10P event contracts.

`packages/test-fixtures/` contains two tiny JSON samples. They are not the F10 test-data pack.

`packages/design-tokens/tokens.json` is a small token file, not the F9I content contract.

Classification: **PARTIAL**.

### 1.6 Mobile — `apps/`

Android: Kotlin + Jetpack Compose shell. `MainActivity.kt` renders the text "Monytix". No navigation, auth, or API client.

iOS: SwiftUI shell. `ContentView.swift` and `MonytixApp.swift` are a starter view. Test files are Xcode templates. `xcuserdata` contains a local username path (`santoshmalla`); that is machine metadata, not a product identity.

No `pubspec.yaml`, no Dart sources, and no `mobile.zip`.

Classification: **PARTIAL** native shells. Flutter assets: **MISSING**.

### 1.7 Infrastructure and docs

| Path | Classification | Note |
| --- | --- | --- |
| `infrastructure/docker/api.Dockerfile` | PARTIAL | `node:22-bookworm-slim`. Stack brief asks for Node.js 24 |
| `infrastructure/docker/intelligence.Dockerfile` | PARTIAL | Python image builds the stub package |
| `docker-compose.yml` | PARTIAL | `postgres:16`. Stack brief asks for PostgreSQL 17. No Redis, object storage, or worker |
| `infrastructure/dokploy/README.md` | PARTIAL | Points at compose. No Dokploy application spec |
| `infrastructure/monitoring/README.md`, `backups/README.md` | MISSING | Orientation only |
| `docs/*/overview.md` | PARTIAL | Short ownership notes. They predate the frozen F10/B10 contracts |
| CI (`.github`, GitLab, or equivalent) | MISSING | No pipeline found |

## 2. Technology stack detected

| Layer | Requested | Detected in repository code | Classification |
| --- | --- | --- | --- |
| Public API | Node.js 24, TypeScript, Fastify or Express 5, OpenAPI 3.1 | Fastify 5.6, TypeScript 5.9, Node image 22, OpenAPI stub | PARTIAL |
| Auth | Firebase Authentication | Not referenced in source or `.env.example` | MISSING |
| Intelligence | Python 3.12+, FastAPI, Pydantic, SQLAlchemy/psycopg, Celery, Redis | Python 3.12 available on the audit machine. Package requires `>=3.12`, FastAPI, Uvicorn. No Pydantic domain models, SQLAlchemy, Celery, or Redis | PARTIAL |
| Database | PostgreSQL 17, versioned migrations, RLS, outbox, audit, idempotency | Compose uses Postgres 16. One unversioned-looking `0001_init.sql` with no RLS | CONFLICTING |
| Mobile | Kotlin/Compose and Swift/SwiftUI | Stubs of both. `mobile.zip` absent | PARTIAL / MISSING |
| Delivery | Docker, Compose, Dokploy, FCM, private object storage, structured logs, health checks | Compose and two Dockerfiles. API health route tested. Intelligence health not executed in this audit. No FCM, no object storage | PARTIAL |

**ARCHITECTURAL_PROPOSAL:** Keep Fastify 5 and FastAPI. Move the API image to Node 24 and Postgres to 17 when M1 starts, after confirming D10-1 (which states PostgreSQL 15+ for `security_invoker` views) still runs on 17. Do not change engines during M0.

## 3. Reusable modules

These are reusable as boundaries or as reference material. They are not reusable as financial logic.

| Asset | Reuse |
| --- | --- |
| `services/api` route registration | Keep the process boundary. Replace stub handlers in later phases |
| `services/intelligence` package names | Keep ownership folders. Do not treat stub functions as engines |
| `packages/api-contracts/openapi.yaml` | Keep the file. Replace stub schemas with F9 contracts when those contracts are transcribed under change control |
| `packages/domain-events` | Keep event names only as placeholders. F9/B10P event names win |
| D10 v1.2 table master and D10-1 SQL inside the personal bundle | Authoritative personal persistence target. Not yet a repository migration |
| B10Q v1.1 V001–V030 plus v1.3 V031–V040 | Authoritative business persistence lineage. Not yet a repository migration |
| Parsing framework v4 SQL and reference | Salvage candidate for format registry, token scoring, and error codes |
| UPI classifier v2 design and v3 SQL | Salvage candidate for VPA, provider, and signal weights |
| Rulebook SQL v1/v2 and classification rulebook | Salvage candidate for pattern catalogues, split across F10C/F10D/F10E |
| F9, F9I, personal UI workbook, business UI workbooks | Screen, widget, API, and copy contracts |
| F10 end-to-end workbook | Test traceability. It is not a second functional specification |

## 4. Deprecated or conflicting modules

**SOURCE_REQUIREMENT (D10 v1.2 §2, §15, Table 3, Table 19):** the supplied historical backend used overlapping products (`monytix`, `spendsense`, `moneymoments`, `budgetpilot`, `goalcompass`, `rewards`, `intelligence`, `experience`). D10 orders a clean vNext model and forbids treating those tables as runtime truth. Legacy deletion is prohibited until migration, reconciliation, and golden regression pass.

Inside this repository the conflict is smaller and still real:

| Current artifact | Conflict |
| --- | --- |
| `public.transactions` in `0001_init.sql` | A second, empty transaction identity beside D10 `core.logical_transaction` and B10Q `canonical` |
| Intelligence stub writers plus API `DATABASE_URL` | Both processes can reach Postgres. No write boundary is enforced |
| `docs/classification/overview.md` | Says the API stores classification records. Frozen ownership is: Node writes canonical financial facts; Python writes versioned interpretations |
| Parsing v4, UPI SQL, and rulebook SQL | Write `txn_fact`, `txn_parsed`, `txn_enriched`, `txn_rulebook_output`. D10 Table 19 marks that SpendSense stack REPLACE |
| MoneyMoments v2 SQL | Computes habits and nudges in `mm_*` tables. D10 Table 19 marks MoneyMoments nudges RETIRE and allows only selective salvage of measurements that match F10G |
| `0001_init.sql` `decisions` / `missions` / `nudges` | Unversioned public tables. They are not `action.decision` or B10Q `decision` |

None of these SQL engines are mounted in `database/migrations`. They are conflicting reference assets, not a live double ledger.

## 5. Missing components

Named inputs requested by the M0 brief:

| Input | Result |
| --- | --- |
| `Monytix_Personal_Deployment_Bundle.zip` | Present in `frs/`. Extracted. Personal Master, F10-0, F10A–F10L freezes, D10 v1.0 and v1.2, D10-1 SQL, D10-2 through D10-10 packs |
| `Monytix_Business_Deployment.zip` | Present. Master architecture, B10A–B10Q, two-source decision framework, UI workbooks, B10Q v1.1/v1.2/v1.3 |
| `Rulebook Classification.zip` | Present. Rulebook docx, UPI rulebook reference, `files/` and `v1/` and `v2/` SQL |
| `UPI Classifer files.zip` | Present. v2 design, `UPI_Classifier.txt`, `upi_classifier_v2.sql`, `upi_classifier_v3.sql` |
| `transaction parsing files 2.zip` | Present. v2 design, v3.1 RTF patch, SQL v2 through v4, v4 reference |
| `Habbits & Nudges.zip` | Present. MoneyMoments v2 FRD and SQL, habits/nudges reference |
| F9 master docx | Present in `frs/` |
| F9I xlsx | Present |
| F10 end-to-end xlsx | Present |
| `mobile.zip` | **MISSING.** No extracted equivalent. Dependent Flutter migration is stopped |

Also missing from the running tree: Firebase verification, RLS, outbox, audit log, object storage, Celery/Redis, OpenAPI operation set from F9, CI, production secrets management, and any non-stub financial calculation.

## 6. Security concerns

Observed, not theoretical:

1. Compose defaults are `monytix:monytix` on published port 5432 (`.env.example`, `docker-compose.yml`).
2. No authentication middleware. Every stub route is anonymous.
3. `0001_init.sql` has no `owner_id` and no RLS. Any future query against these tables would be cross-tenant by default.
4. API and intelligence share `DATABASE_URL`. A future intelligence bug can write canonical rows.
5. Logger on the API is `logger: false` (`app.ts`). No redaction policy exists.
6. iOS project stores local Xcode user state under `xcuserdata`.
7. Personal bundle paths contain `API:Technicals`. Windows extraction fails on the colon. That is an integrity risk for anyone applying D10 packs with `Expand-Archive`.
8. No rate limit, idempotency record, or signed upload URL exists.

Details and required controls are in `M0_SECURITY_ARCHITECTURE.md`.

## 7. Database migration risks

| Risk | Why it matters |
| --- | --- |
| Applying `0001_init.sql` and later D10/B10Q | Creates a public stub ledger that must not become canonical. Compose mounts `database/migrations` into `docker-entrypoint-initdb.d`, so the stub DDL runs on first Postgres start |
| Applying every historical SQL version | Parser v2–v4, UPI v2 and v3, rulebook v1 and v2, MoneyMoments, and B10Q v1.0–v1.3 overlap. D10 forbids destructive replacement and forbids executing competing truth |
| B10Q filename collision | B10Q v1.3 §2 states v1.1 already uses V026–V030 and the standalone v1.2 pack reused V026–V031. v1.3 moves narration and visibility to V031–V040 |
| Personal versus business physical models | D10 freezes eight schemas. B10Q v1.1 creates `platform`, `ingest`, `parse`, `normalize`, `canonical`, `party`, `classify`, `semantic`, `pattern`, `weight`, `state`, `decision`, `mission`, `outcome`, `mile`, `projection`. Loading both unchanged creates two ledgers |
| D10-1 is idempotent and non-destructive toward legacy schemas | Safe to review. Not safe to treat as the whole database. It does not create the canonical transaction chain (that is D10-2) |
| UUIDv7 versus `gen_random_uuid()` | `0001_init.sql` uses `gen_random_uuid()`. D10 FD-02 requires UUIDv7 for new vNext keys |

No migration was executed.

## 8. Current test status

| Suite | Command | Result | What it proves |
| --- | --- | --- | --- |
| API | `npm test --workspace services/api` on 2026-10-10 | 13 passed | Stub JSON for 12 modules and `{module: platform, status: ok}` |
| Intelligence | `pytest -q` on 2026-10-10 | 15 passed | Each engine function returns `status == "stub"` |
| Database verification SQL | Not run | No database was started | Placeholders are comments |
| D10 / B10Q SQL tests | Not run | Packs are inside archives | Not evidence of a migrated database |
| F10 workbook scenarios | Not run | No product implementation | 50 scenarios, 32 marked READY, 18 BLOCKED in sheet `00_Summary` |

Production readiness is not claimed.

## 9. Recommended implementation order

Follow `docs/implementation/M0_TO_M8_MASTER_PLAN.md`.

1. M0 — this audit. Stop here for implementation.
2. M1 — infrastructure, Firebase auth, and one canonical identity spine. Do not import parser or rulebook DDL.
3. M2 — ingestion and parsing as a versioned interpretation of immutable evidence.
4. M3 — UPI signals and rulebook catalogues under F10C/F10D/F10E precedence, not as a first-match monolith.
5. M4–M5 — personal evidence, weights, states, decisions, missions, outcomes, M.I.L.E.
6. M6 — business lineage on the same evidence spine, with B10 eligibility gates.
7. M7 — habits, nudges, MolyBot, notifications, only after D10's retirement of MoneyMoments-as-authority is reconciled.
8. M8 — native clients against F9. Flutter work stays stopped until `mobile.zip` is supplied.

## Subsystem classification summary

| Subsystem | Status |
| --- | --- |
| Repository skeleton and health stubs | EXISTING_WORKING |
| Fastify module routes as financial APIs | MISSING |
| Python intelligence engines | MISSING |
| `0001_init.sql` ledger | CONFLICTING |
| D10 / B10Q / parser / UPI / rulebook SQL in `frs/` | EXISTING_UNVERIFIED (not executed) |
| F9 / F9I / F10 workbook contracts | EXISTING_WORKING as documents |
| Firebase auth, RLS, outbox, object storage, CI | MISSING |
| Android and iOS shells | PARTIAL |
| Flutter / `mobile.zip` | MISSING |
| Habits and nudges runtime | MISSING; reference SQL CONFLICTING with D10 |
| Dual-write risk (API and intelligence share Postgres) | BLOCKED until M1 ownership is enforced |
