# M0 Repository Structure

M0 does not move or delete files. The tree below is the target shape. Paths that already exist stay where they are until a later phase migrates them with a reviewed diff.

Labels: **SOURCE_REQUIREMENT** where a frozen pack dictates a home, otherwise **ARCHITECTURAL_PROPOSAL**.

## What exists today

```
g:\MOnytix+v2\
  apps\android\          Kotlin Compose shell
  apps\ios\              SwiftUI shell
  database\migrations\   0001_init.sql stub only
  database\seeds\        empty comment
  database\reconciliation\  placeholder
  database\verification\    placeholder
  docs\                  short overviews plus this M0 set
  frs\                   supplied zip, docx, and xlsx inputs (do not rewrite)
  infrastructure\docker\ two Dockerfiles
  infrastructure\dokploy\  readme
  infrastructure\monitoring\ readme
  infrastructure\backups\  readme
  packages\api-contracts\  stub OpenAPI
  packages\domain-events\  six placeholder schemas
  packages\design-tokens\
  packages\test-fixtures\
  scripts\dev.ps1
  services\api\          Fastify stubs
  services\intelligence\ FastAPI stubs
  Monytix\               nested git metadata only
  apk\                   empty of binaries
```

`mobile.zip` is not in the tree (CF-11).

## Target layout

```
apps/
  android/                         existing
  ios/                             existing
services/
  api/                             Node public API. Canonical write transaction
  intelligence/                    Python computation. No public mobile ingress
packages/
  api-contracts/                   OpenAPI 3.1 transcribed from F9 and business UI mapping
  shared-types/                    new, when generated types are needed
  generated-clients/               new, generated. Not hand-copied payloads
  domain-events/                   existing. Replace placeholder schemas from F9/B10P
  design-tokens/                   existing
  test-fixtures/                   existing. Add synthetic fixtures only, never live statements
database/
  migrations/                      future D10/B10Q files after CF-01. Do not drop 0001 in M0
  seeds/                           reference data only, from frozen registries
  reconciliation/                  count and amount checks from D10 §17
  verification/                    SQL acceptance checks
  reference/                       new home for parser/UPI/rulebook SQL kept as salvage, not auto-run
infrastructure/
  docker/
  dokploy/
  monitoring/
  backups/
docs/
  architecture/                    M0 architecture set
  contracts/                       API and UI traceability
  decisions/                       future decision records when an OPEN_DECISION closes
  implementation/                  phase plan and this audit's report
  qa/                              test traceability
  personal|business|classification|security|api|testing\  existing overviews
frs/                               immutable inputs
scripts/
```

**ARCHITECTURAL_PROPOSAL:** do not create a second `monytix/` root. The repository root is already the monorepo. The empty `Monytix/` directory is not a source tree.

## Ownership of code

| Path | Owns | Must not own |
| --- | --- | --- |
| `services/api` | HTTP, Firebase verification, idempotency, object pointers, the database transaction that commits canonical rows and outbox | Parsing algorithms, weight formulas, decision eligibility math |
| `services/intelligence` | Parse, classify, signals, weights, states, decision evaluation, habit proposals after CF-08, MolyBot context assembly | A private canonical ledger, raw SQL from clients |
| `apps/android`, `apps/ios` | Presentation and token storage | Eligibility, totals, or narrative numbers that F9I marks computed |
| `database/migrations` | Reviewed DDL | Historical engine SQL pasted in unchanged |
| `frs/` | Evidence of what was supplied | Runtime imports |

## Spec salvage map

| Supplied input | Future home when implementation is allowed | Not allowed |
| --- | --- | --- |
| D10-1 SQL | First reviewed migration after Postgres 17 check | Editing it inside the zip |
| D10-2…D10-10 packs | Later migrations in order | Skipping golden gates |
| B10Q v1.1 V001–V030 and v1.3 V031–V040 | Business migrations after CF-01 mapping | v1.2 files that reuse V026–V031 |
| Parser v4 | `database/reference/parsing/` plus Python port | `txn_fact` as canonical |
| UPI v2/v3 | `database/reference/upi/` until OQ-05 | Both versions live |
| Rulebook SQL | `database/reference/rulebook/` split into F10C/D/E seeds | First-match monolith as runtime |
| MoneyMoments SQL | `database/reference/habits/` archival | Auto-migration |
| F9, F9I, UI workbooks | `docs/contracts` indexes. Payloads stay sourced from the workbooks | Hardcoded sample rupee amounts from F9I examples |

## Generated and local files

Already ignored and should stay ignored: `.env`, `node_modules`, `dist`, `.venv`, `.pytest_cache`, Android `build`, iOS `DerivedData` and `xcuserdata`.

`services/api/dist` is present in the working tree from a prior compile. It is generated. Do not treat it as source. `.gitignore` already lists `dist/`.

## Docker and deploy

Keep root `docker-compose.yml` as the local and Dokploy entry, matching `infrastructure/dokploy/README.md`. M1 changes the Node image, the Postgres image, and published ports. Those edits are not part of M0.

No CI workflow exists. M1 should add a pipeline that runs the API tests, intelligence tests, and a migration lint that fails if a file contains `DROP TABLE` or `DROP SCHEMA` without an explicit later waiver. That pipeline is not created in M0.
