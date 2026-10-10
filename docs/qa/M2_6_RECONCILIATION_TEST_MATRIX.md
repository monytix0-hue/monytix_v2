# M2.6 reconciliation test matrix

Date: 2026-10-10. Database: disposable PostgreSQL 17 (`monytix-m23-pg`, port 55434). Migration `0010_m2_6_import_review.sql` applied with `ON_ERROR_STOP`.

Command, from `services/api`: `npm test`

Result: 42 pass, 0 fail, 0 skipped.

| Case | Result |
| --- | --- |
| T01 Same reference uploaded again | Pass. One logical transaction, second row `LINKED_EXISTING` |
| T02 Overlapping same date and reference | Pass. Same link as T01 |
| T03 Same reference, same account | Pass |
| T04 Same reference, different account | Pass. Second `MAPPED` logical transaction |
| T05 Same reference, different amount | Pass. `CONFLICTING_REFERENCE`, no second logical transaction |
| T06 Same reference, different currency | Pass. `CONFLICTING_REFERENCE` |
| T07 Same amount and date, different reference | Pass. Two `MAPPED` rows |
| T08 Same amount and date, no reference | Pass. `WEAK_MATCH` |
| T09 Two account legs | Pass. Two logical transactions, not linked |
| T10 Repeated payments on different dates | Pass. Two logical transactions |
| T11 Missing account, then select owned account | Pass. `MAPPED` |
| T12 Cross-owner account | Pass. `forbidden`, row stays in review |
| T13 Cross-owner transaction | Pass. `forbidden` |
| T14 Confirm new | Pass. A second logical transaction |
| T15 Link existing | Pass. `LINKED_EXISTING` on the owned transaction |
| T16 Reject | Pass. `REJECTED`, no logical transaction |
| T17 Concurrent review | Pass. One `ok`, one `stale`, one primary evidence link |
| T18 Idempotent replay | Pass. One `STATEMENT_REVIEW_RESOLVED` outbox row |
| T19 Stale review version | Pass. Version stays 1 |
| T20 Summary counts | Pass. 4 = 1 mapped + 1 linked + 1 review + 1 invalid |
| T21 Partial extraction with valid fields | Pass. `MAPPED` |
| T22 Unsupported layout | Pass. `ineligible`, one processing failure |
| T23 Document not `SCAN_CLEAN` | Pass. `ineligible` |
| T24 Rolled-back review | Pass. No logical transaction remains |
| T25 Replay does not add a second outbox row | Pass |
| T26 Other owner under RLS | Pass. Zero disposition rows |
| T27 Finalize while review remains | Pass. `review_pending`, then finalize after reject |
| T28 Parser version | Pass. Stays `v4` |
| T29 Historical evidence | Pass. `M2.5-v1` disposition and narration unchanged |
| T30 Primary evidence uniqueness | Pass. One link after concurrent review |

`monytix_intelligence` cannot execute `ops.resolve_statement_review`. `GET /v1/imports/{id}/review` without a token returns 401.

## Not run

Production Cloudflare R2, production ClamAV, tamper detection, and sealed-byte immutability. An authenticated HTTP round trip of the review write was not exercised separately from the PostgreSQL function.
