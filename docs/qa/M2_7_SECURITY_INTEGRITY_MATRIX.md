# M2.7 security and integrity matrix

Date: 2026-10-10. Database: disposable PostgreSQL 17 (`monytix-m23-pg`, port 55434). Object bytes: local MinIO. Scanner for the upload path: local ClamAV. Migration `0011_m2_7_parser_version.sql` applied with `ON_ERROR_STOP`.

Command, from `services/api`: `npm test`

Result: 44 pass, 0 fail, 0 skipped.

| Case | Result |
| --- | --- |
| T01 Historical M2.5 links | Pass. 2 `LINKED_EXISTING` rows, both strong. 0 conflicting |
| T02 Historical evidence | Pass. `M2.5-v1` row count and narration unchanged inside the test. No remap |
| T03 Authenticated review | Pass. HTTP 200 and `MAPPED` |
| T04 Missing and invalid token | Pass. HTTP 401 |
| T05 Cross-owner import | Pass. HTTP 403 |
| T06 Cross-owner account | Pass. HTTP 403, row stays in review |
| T07 Cross-owner transaction | Pass. HTTP 403 |
| T08 Idempotent HTTP replay | Pass. Same logical transaction, one review outbox row |
| T09 Stale review version | Pass. HTTP 409, version stays 1 |
| T10 Concurrent HTTP review | Pass. 200 and 409, one primary evidence link |
| T11 Sealed object | Pass. Unsigned PUT to the sealed key is rejected and the hash stays the uploaded hash |
| T12 Staging overwrite | Pass. Unsigned PUT to the staging key does not change the sealed hash |
| T13 Checksum mismatch | Pass. Replaced sealed bytes become `OBJECT_TAMPERED` and create no logical transaction |
| T14 Extraction reads the sealed object | Pass. The clean sealed CSV becomes one `COMPLETED` run |
| T15 Concurrent extraction save | Pass. One created and one replay for the test adapter |
| T16 Worker crash lease | Pass. A due failed event is reclaimed, then the transaction rolls back |
| T17 Duplicate save | Pass. The third save is `replay` |
| T18 Save replay | Pass |
| T19 Mapping retry | Pass. A second map does not replace the current version |
| T20 Parser version v4 | Pass. `worker_metadata.parser_version` is `v4` |
| T21 Test adapter | Pass. `test-only`, `ADAPTER_UPGRADE`, original canonical version still current |
| T22 Institution | Pass as an audit. `financial_account.institution_id` is nullable. No new column |
| T23 Finalize race | Pass. Finalize is HTTP 409 while review remains. Two later finalizes leave one timestamp |
| T24 Outbox | Pass. One `STATEMENT_REVIEW_RESOLVED` row |
| T25 RLS | Pass. The other owner reads zero disposition rows |
| T26 Production R2 | `BLOCKED_ENVIRONMENT`. No production credentials |
| T27 Production ClamAV | `BLOCKED_ENVIRONMENT`. No production scanner host |
| T28 Retention | Pass. `retention_due_statements(90)` returns nothing for the sealed import. `processing_completed_at` was not set |
| T29 Failed job | Pass. `finish_statement_extraction` leaves `FAILED` and the rolled-back claim adds no logical transaction |
| T30 One canonical transaction | Pass. The strong match and the test-adapter rerun leave one current logical transaction |

Local MinIO and local ClamAV are not production evidence. There is no automatic `DEAD_LETTER` transition. A failed extraction stays `FAILED` until its lease is due.
