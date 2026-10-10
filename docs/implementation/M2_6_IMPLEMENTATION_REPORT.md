# M2.6 implementation report

Date: 2026-10-10.

## Verdict

`PASS WITH GAPS`.

The duplicate, cross-owner, count, review, idempotency, concurrency, evidence, and atomicity checks passed on disposable PostgreSQL 17. The API suite was 42 pass and 0 fail. Production object storage, production malware scanning, tamper detection, and sealed-byte immutability remain open, so this is not a production pass.

## Current-state audit

M2.5 linked a reference without comparing date or currency. Disposition outcomes were already `MAPPED`, `LINKED_EXISTING`, `REVIEW_REQUIRED`, and `REJECTED`. F9H-010 names status counts and has no review write. The review routes are a versioned amendment. Upload confirmation is still not financial completion.

## Files changed

- `database/migrations/0010_m2_6_import_review.sql`
- `services/api/src/imports/store.ts`
- `services/api/src/imports/routes.ts`
- `services/api/tests/review.integration.test.ts`
- `docs/architecture/M2_6_RECONCILIATION_ARCHITECTURE.md`
- `docs/contracts/M2_6_IMPORT_REVIEW_CONTRACT.md`
- `docs/qa/M2_6_RECONCILIATION_TEST_MATRIX.md`

Migrations `0001`–`0009` were not edited. No second ledger was created. No event labels were assigned.

## Migration

`0010` adds `review_version` and `resolved_by_actor_id` on `core.source_record_disposition`. It replaces `ops.map_statement_extraction` so a new decision uses `M2.6-v1` and an existing disposition is replayed. Auto-link now requires account, amount, direction, currency, date, and reference. A conflicting reference stays in review. `ops.statement_import_summary`, `ops.statement_review_queue`, `ops.resolve_statement_review`, and `ops.finalize_statement_import` are executable only by `monytix_api`.

## Reconciliation and review

A full match links the existing logical transaction. A different account with the same reference becomes its own transaction. Amount and date alone do not merge. Review can select an owned account, confirm a new transaction, link a matching owned transaction, or reject the row. Missing source fields stay unresolved. Finalize is refused while a review row remains.

## API

Status includes the reconciliation counts. Review list, review item, review submit, and finalize are owner-scoped. The idempotency key is required on the writes.

## Security and tests

Cross-owner account and transaction actions returned `forbidden`. Another owner read zero disposition rows. Intelligence cannot execute the review function. Concurrent review created one primary evidence link. A rolled-back review left no logical transaction. Details are in the test matrix.

## Known gaps and production blockers

Production R2, production ClamAV, tamper detection, and sealed-byte immutability are not verified. Institution is not a match key because upload does not store one on the source record. The authenticated HTTP review write was not given its own route test beyond the database function and the anonymous 401.

## Next milestone

M2.7 operational reliability is not started.
