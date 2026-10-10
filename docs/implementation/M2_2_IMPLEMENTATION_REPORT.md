# M2.2 implementation report

Date: 2026-10-10.

M2.2 status: **PASS**.

F9H-094 v1.1: **APPROVED** and implemented. The amendment is `docs/contracts/M2_2_F9H094_V1_1_AMENDMENT.md`.

## What was written

| Piece | Path |
| --- | --- |
| Manual create | `database/migrations/0006_m2_2_manual_transaction.sql` |
| Route | `POST /v1/transactions/manual` in `services/api/src/transactions/routes.ts` |
| Store | `services/api/src/transactions/manual.ts` |
| Auth tests | `services/api/tests/manual-transaction.auth.test.ts` |
| Postgres tests | `services/api/tests/manual-transaction.integration.test.ts` |
| Write authority | `docs/architecture/M2_2_WRITE_AUTHORITY.md` |
| Test record | `docs/qa/M2_2_MANUAL_TRANSACTION_TESTS.md` |

Migrations `0001_init.sql` through `0005_m2_1_read_grants.sql` were not edited. No taxonomy table, `txn_fact`, business schema, or `public.transactions` write was added. M2.3 was not started.

## Write path

`ops.create_manual_transaction` is `SECURITY DEFINER`, executable by `monytix_api` only. The route sends the raw amount text as `numeric`. Direction must be `IN` or `OUT`. The function does not infer direction and does not create an account.

Category, subcategory, and optional weights are stored on the source record with `taxonomy_verified: false` and `weights_verified: false`. The outbox event `TRANSACTION_CREATED` is the audit record. Idempotency uses `ops.idempotency_record`, scope `EXTERNAL_WRITE`.

Success is 201 with `meta.ui_state = WRITE_COMMITTED`, `data.canonical_transaction_version_id`, and `data.version_no`. `meta.recompute_status` is omitted.

## Commands and counts

Disposable PostgreSQL 17.11, container `monytix-m22`, host port 55434. Migrations `0001` through `0006` and `database/bootstrap/passwords.sql` applied with `ON_ERROR_STOP`.

`database/verification/d10_2_verify.sql`: `D10-2 verification passed`, then `ROLLBACK`.

```text
npm test --workspace services/api
```

Without `M2_TEST_DATABASE_URL` and `M2_TEST_ADMIN_URL`: 24 pass, 0 fail, 1 skipped.

```text
M2_TEST_DATABASE_URL=postgres://monytix_api:monytix_api_local@127.0.0.1:55434/monytix
M2_TEST_ADMIN_URL=postgres://postgres:verify@127.0.0.1:55434/monytix
npm test --workspace services/api
```

With those variables: 31 pass, 0 fail, 0 skipped.

Covered on Postgres: personal owner, wrong owner, business membership allowed and denied, cross-owner account, `IN` and `OUT`, unverified evidence, no taxonomy or weight rows, replay, conflicting key, concurrent same key, rollback, direct insert denied for both application roles, intelligence cannot execute the function, the other owner cannot select the logical transaction, and `public.transactions` stays empty.

## Next

M2.3 is not started.
