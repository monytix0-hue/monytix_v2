# M2 implementation report

Date: 2026-10-10.

M2 plan status: READY WITH GAPS.

M2.1 status: PASS.

M2.2 through M2.7 were not implemented.

## What landed

| Item | Path |
| --- | --- |
| Workstream plan | `docs/implementation/M2_MASTER_PLAN.md` |
| Source chain | `docs/architecture/M2_SOURCE_TO_LEDGER.md` |
| CF-01 mapping | `docs/architecture/M2_D10_2_IDENTITY_MAPPING.md` |
| API contract | `docs/contracts/M2_INGESTION_API_CONTRACT.md` |
| Test matrix | `docs/qa/M2_TEST_MATRIX.md` |
| Security | `docs/security/M2_INGESTION_SECURITY.md` |
| D10-2 migration | `database/migrations/0004_d10_2_source_intake_canonical_ledger.sql` |
| Read grants | `database/migrations/0005_m2_1_read_grants.sql` |
| Pack verify | `database/verification/d10_2_verify.sql` |
| RLS verify | `database/verification/m2_1_rls.sql` |

`0001_init.sql`, `0002_d10_1_foundation.sql`, and `0003_m1_ops_roles.sql` were not edited. No API route, parser, or intelligence endpoint was added.

## Migrations

Applied on a disposable Postgres 17 database, in filename order, as the migration superuser:

1. `0001_init.sql`
2. `0002_d10_1_foundation.sql`
3. `0003_m1_ops_roles.sql`
4. `0004_d10_2_source_intake_canonical_ledger.sql`
5. `0005_m2_1_read_grants.sql`

`ops.schema_migration` contains `D10-1`, `D10-2`, `M1-OPS`, and `M2-1-GRANTS`.

## D10-2

The supplied verify script returned `D10-2 verification passed`.

Catalog after apply:

| Object | Present |
| --- | --- |
| `core.logical_transaction` | yes |
| `core.canonical_transaction_version` | yes |
| `core.transaction_evidence_link` | yes |
| `public.transactions` | yes |
| `public.txn_fact` | no |
| B10Q schemas `ingest`, `parse`, `normalize`, `canonical`, `party`, `classify` | no |

CF-01 compatibility: the logical transaction is the identity. Evidence links are a separate table. No second amount ledger was created.

## Security

`database/verification/m2_1_rls.sql` returned `M2.1 RLS verification passed`.

That script checks both application roles have `rolbypassrls = false`, owner A cannot read owner B's logical transaction, owner A can read its own row, and `monytix_intelligence` insert into `core.logical_transaction` raises `insufficient_privilege`.

## API tests

Command: `npm test --workspace services/api`

Result: 19 passed, 0 failed. `GET /platform/health` still returns the existing ok payload. No financial POST was added.

## Open conflicts

| ID | Effect on later slices |
| --- | --- |
| F9H-094 body not extracted | M2.2 must not invent `POST /v1/transactions/manual` JSON |
| F9H-089 body not extracted | M2.3 must not invent `POST /v1/imports` JSON |
| OQ-12 | No storage vendor or signing protocol. Upload stays PROPOSED |
| OQ-11 | Gmail stays out |
| CF-03 | Parser v4 is not mounted. `txn_fact` must stay absent |
| OQ-17 | Batch lock is specified as owner, connection, and content hash. It is not implemented because no worker exists |

## Next

M2.2 — manual transaction path, after the F9H-094 body is taken from the F9 contract.
