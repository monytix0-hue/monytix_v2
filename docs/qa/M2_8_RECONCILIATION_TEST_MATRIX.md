# M2.8 reconciliation test matrix

Date: 2026-10-11. Database: local PostgreSQL 17 in `monytixv2-postgres-1`.

`services/api/tests/account-binding.integration.test.ts` ran against `postgres://monytix_api@127.0.0.1:5432/monytix`. The authenticated CSV run used the Docker network, MinIO, and ClamAV. Mock-only tests are not counted as that run.

| Id | Case | Result | Evidence |
| --- | --- | --- | --- |
| T01 | Upload with a valid owned account | Pass | `authorize_statement_upload` created one `RESOLVED` statement instance for that account |
| T02 | Upload with no account | Pass | No statement instance. Mapped row is `REVIEW_REQUIRED` / `ACCOUNT_UNRESOLVED` |
| T03 | Upload with another owner's account | Pass | Outcome `forbidden`. No document row |
| T04 | Binding survives extraction | Pass | After `save_statement_extraction`, the same account is still bound |
| T05 | Binding survives retry | Pass | Same idempotency key replayed the import. A second save returned `replay`. One instance remained |
| T06 | First valid source row maps | Pass | Outcome `MAPPED` |
| T07 | Strong duplicate links the existing row | Pass | Second row `LINKED_EXISTING` on the same logical transaction |
| T08 | Same reference, different account | Pass | Two `MAPPED` rows and two logical transactions |
| T09 | Same reference, different amount | Pass | Second row `REVIEW_REQUIRED` / `CONFLICTING_REFERENCE` |
| T10 | Same reference, different currency | Pass | `REVIEW_REQUIRED` / `CONFLICTING_REFERENCE` |
| T11 | Same reference, different date | Pass | `REVIEW_REQUIRED` / `CONFLICTING_REFERENCE` |
| T12 | Same amount and date, different reference | Pass | Two `MAPPED` logical transactions |
| T13 | Same amount and date, no reference | Pass | Second row `REVIEW_REQUIRED` / `WEAK_MATCH` |
| T14 | `select_account` reconciles | Pass | First review item `MAPPED`, second `LINKED_EXISTING` |
| T15 | `confirm_new` checks duplicates | Pass | Weak duplicate stayed `REVIEW_REQUIRED`. One logical transaction |
| T16 | Concurrent `select_account` | Pass | Outcomes `MAPPED` and `LINKED_EXISTING` |
| T17 | Concurrent `confirm_new` | Pass | Outcomes `MAPPED` and `LINKED_EXISTING` |
| T18 | Idempotent review replay | Pass | Same key returned `replay` and the same logical transaction |
| T19 | Stale review version | Pass | Outcome `stale` |
| T20 | Rebind after mapping | Pass | Update raised `statement account is already committed` |
| T21 | Cross-owner import access | Pass | Summary and review returned `forbidden` |
| T22 | Cross-owner transaction link | Pass | `link_existing` returned `forbidden` |
| T23 | Historical import preservation | Pass | Logical ids for account `01a12b2d-3324-71e2-8fbd-4faf2ec90b2a` were unchanged. The duplicate report still lists a group |
| T24 | Import count consistency | Pass | `mapped_count` 1, `linked_count` 1, `review_count` 0, `total_source_records` 2 |
| T25 | Canonical evidence uniqueness | Pass | Two evidence links, one primary. A repeated link insert failed |
| T26 | API restart persistence | Pass | After `docker restart monytixv2-api-1`, the fresh import was still `MAPPED`, `LINKED_EXISTING`, one logical transaction, two evidence links |
| T27 | Authenticated CSV import | Pass | Local Docker stack. Authorize 201, PUT 200, complete 201, anonymous object read 403 |
| T28 | No competing ledger | Pass | `spendsense.txn_fact`, `txn_parsed`, `txn_parse_stage`, and `txn_enriched` are absent |

Existing mapping, review, and manual-transaction integration tests were run again on the same database: 12 passed, 2 skipped because those files also require a host-published MinIO and ClamAV. The Docker E2E used the compose MinIO and ClamAV.

## Authenticated acceptance import

Import `01a12b3f-0626-7ef4-ac7e-ed9a473112ae`.

| Check | Observed |
| --- | --- |
| Outcomes | `MAPPED`, `LINKED_EXISTING` |
| `mapped_count` | 1 |
| `linked_count` | 1 |
| `review_count` | 0 |
| Logical transactions for the import | 1 |
| Evidence links | 2 |
| Distinct later import `01a12b3f-414d-77b5-9471-4d2f050a6a18` | `MAPPED` on a different logical transaction |
| Cross-owner account on `POST /v1/imports` | 403 |
| Sealed object, unauthenticated GET | 403 |
