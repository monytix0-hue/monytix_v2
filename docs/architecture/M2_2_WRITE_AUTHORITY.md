# M2.2 write authority

Status: implemented. One `SECURITY DEFINER` function writes the manual transaction. `monytix_api` can execute that function. It still has no `INSERT` grant on the ledger tables.

## Grant boundary

`database/migrations/0005_m2_1_read_grants.sql` is unchanged. `monytix_api` remains `SELECT`-only on the D10-2 tables. `monytix_intelligence` remains revoked from `INSERT`, `UPDATE`, and `DELETE`. Both roles stay `NOINHERIT` and `NOBYPASSRLS`.

`database/migrations/0006_m2_2_manual_transaction.sql` adds `ops.create_manual_transaction`. The function is owned by the migration role, so its inserts bypass row security. It checks membership and active account ownership itself. A missing account and another owner's account return the same forbidden result. `REVOKE` removes `PUBLIC`. `GRANT EXECUTE` is limited to `monytix_api`. There is no dynamic SQL. `search_path` is `core, ref, ops, pg_temp`.

The route does not `SET ROLE`. It calls the function with the actor and owner already resolved by the Firebase guard.

## What one call writes

`ref.adapter_registry` gets one row, `monytix.manual` / `F9H-094-v1.1` / source type `MANUAL`. That row is an adapter version, not a category. The API value `MANUAL_ENTRY` is stored as connection type and batch source type `MANUAL`.

Each create:

1. Reuses the owner's active `MANUAL` connection, or inserts one.
2. Inserts a batch, document, extraction run, and source record for that call.
3. Stores `category_code`, `subcategory_code`, and optional `user_selected_weights` in `core.source_record.raw_record_payload` with `taxonomy_verified: false` and `weights_verified: false`. `merchant_description` is `raw_description`.
4. Inserts `core.logical_transaction` and version 1 with `normalization_status = READY`, a positive `numeric(20,4)` amount, direction `IN` or `OUT`, currency, and `extraction_sequence = 1`.
5. Calls `core.activate_canonical_transaction_version` so `is_current` and the current pointer commit together.
6. Inserts `core.transaction_evidence_link` as `PRIMARY_VERSION_SOURCE`.
7. Inserts `ops.outbox_event` with `semantic_trigger_code = TRANSACTION_CREATED`. That row is the audit record. D10-1 and D10-2 define no separate audit table. The payload carries ids, amount, currency, and direction. It does not carry the narration.
8. Completes `ops.idempotency_record` in scope `EXTERNAL_WRITE`.

No taxonomy table, weight-master row, `txn_fact`, or `public.transactions` row is written.

## Idempotency

The existing unique index is `(scope, owner, key)`. The function takes a transaction advisory lock for the owner, then locks any existing row. The same hash and `COMPLETED` status return the stored success body. A different hash returns conflict. A failure rolls the in-progress row back with the ledger rows.

## Commit-time checks

`core.activate_canonical_transaction_version` updates `is_current` and the pointer before commit. The deferred consistency triggers then run as the session user. `0006` makes those two check functions `SECURITY DEFINER` so row security cannot hide the version they are checking. The logical-transaction check reads the pointer at commit time. The insert event still carries a null pointer even after activation in the same transaction.

`ops.uuid_v7()` now sets `search_path = public, pg_temp` so `gen_random_bytes` remains visible when a caller, including `ops.provision_authenticated_actor`, uses a narrower path. Migrations `0001` through `0005` are not edited.
