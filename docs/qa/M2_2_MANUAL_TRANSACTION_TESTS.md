# M2.2 manual transaction tests

Status: **PASS** on PostgreSQL 17.11.

Default `npm test --workspace services/api`, without `M2_TEST_DATABASE_URL` and `M2_TEST_ADMIN_URL`: 24 pass, 0 fail, 1 skipped. The skipped test is the Postgres integration file.

With both variables set to the disposable Postgres 17 database: 31 pass, 0 fail, 0 skipped.

`database/verification/d10_2_verify.sql` was run again after `0006` and printed `D10-2 verification passed`, then rolled back.

## Commands

Disposable server, host port 55434, container `monytix-m22`, image `postgres:17`. Reported version: `PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`.

```text
docker run -d --name monytix-m22 -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=monytix -p 55434:5432 -v g:\MOnytix+v2\database:/database:ro postgres:17
```

Migrations `0001` through `0006`, then `database/bootstrap/passwords.sql`, were applied with `psql -v ON_ERROR_STOP=1` as `postgres`.

```text
M2_TEST_DATABASE_URL=postgres://monytix_api:monytix_api_local@127.0.0.1:55434/monytix
M2_TEST_ADMIN_URL=postgres://postgres:verify@127.0.0.1:55434/monytix
npm test --workspace services/api
```

The API role executed the function. The superuser connection was used only to build fixtures and to assert rows.

## Security

| Case | Result |
| --- | --- |
| Anonymous request | PASS. 401 `unauthorized` |
| Invalid Firebase token | PASS. 401 `unauthorized` |
| Expired token | PASS. 401 `unauthorized` |
| Revoked token | PASS. 401 `revoked` |
| Invalid owner and denied business membership | PASS. 403 |
| Another owner's account | PASS. 403 `account_forbidden` |
| Other owner `SELECT` of the personal logical transaction | PASS. Count 0 |
| Invalid amount, including a direct call that is rolled back | PASS. 422, and no `rollback-key` row |
| Invalid currency `inr` | PASS. 422, store not called |
| Invalid direction | PASS. 422, store not called |
| Missing `Idempotency-Key` | PASS. 422 |
| SQL injection in `merchant_description` | PASS. Stored as `raw_description`. `core.owner` still present |
| Direct `INSERT` by `monytix_api` | PASS. Rejected |
| Direct `INSERT` by `monytix_intelligence` | PASS. Rejected |
| `EXECUTE` by `monytix_intelligence` | PASS. Rejected |

## Financial integrity

| Case | Result |
| --- | --- |
| Manual `OUT` `1250.50` INR | PASS. 201, version 1, `READY`, `is_current` |
| Manual `IN` `5000` | PASS. Separate `logical_transaction_id` |
| Authorized business membership | PASS. 201 |
| Same key and same payload | PASS. Same logical id and `request_id` |
| Same key and different amount | PASS. 409 `idempotency_conflict` |
| Two concurrent same-key calls | PASS. Both 201, one idempotency row for that owner |
| Outbox `TRANSACTION_CREATED` | PASS. One row for the logical id |
| Category, subcategory, and weights | PASS. Payload `taxonomy_verified` and `weights_verified` are false. No `ref.taxonomy_node` or `human_context.weight_master` |
| `public.transactions` | PASS. Count 0 |
| Response names | PASS. `canonical_transaction_version_id`, `version_no`, `meta.ui_state = WRITE_COMMITTED`. No `meta.recompute_status` |
