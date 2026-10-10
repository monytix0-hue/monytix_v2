# M2 master plan

M2.0 and M2.1 are the only slices implemented with this document. M2.2 through M2.7 are specified so the next slice can start from a source, not from a guess.

Identity rule: `docs/decisions/M1_CF01_CANONICAL_IDENTITY.md`. Physical chain: `docs/architecture/M2_SOURCE_TO_LEDGER.md`.

## M2.0 — source contract reconciliation

| | |
| --- | --- |
| Source | D10-2 README and SQL, F10A as named by that README, M0 API surface, TRACE-01, CF-01, CF-03, OQ-11, OQ-12, OQ-17 |
| Scope | Record what is specified, what is blocked, and what M2.1 may create |
| Database objects | None |
| API | No new route |
| Python | None |
| Authorization | M1 Firebase gate and RLS stay |
| Errors | Unspecified bodies stay unimplemented |
| Idempotency | `ops.idempotency_record` already exists. No new key design is invented for an unspecified body |
| Events | TRACE-01 names `TRANSACTION_CREATED`. It is not emitted in this slice |
| Audit | This document and the mapping, contract, security, and test-matrix files |
| Dependencies | M1 applied |
| Tests | Review against the pack README. No runtime claim |
| Acceptance | Documents name D10-2 objects and refuse `txn_fact`, Gmail, and an invented manual JSON |
| Rollback | Delete only these new docs if the baseline is rejected. Do not drop database objects from M1 |

Open items recorded, not closed: CF-03 engines are not mounted. OQ-11 Gmail fields are missing. OQ-12 storage vendor is unnamed. OQ-17 has no parser lock because no parser runs. F9H-094 and F9H-089 bodies are not in the repository.

## M2.1 — D10-2 identity and evidence

| | |
| --- | --- |
| Source | `D10_2_source_intake_canonical_ledger.sql` and `D10_2_verify.sql` |
| Scope | Apply the pack unchanged, then SELECT grants only |
| Database objects | `0004_d10_2_source_intake_canonical_ledger.sql`, `0005_m2_1_read_grants.sql` |
| API | None added |
| Python | None added. Intelligence cannot insert the new tables |
| Authorization | Acquisition SELECT by `owner_id`. Ledger SELECT by active account ownership. No write policy |
| Errors | Pack checks reject READY without date, positive amount, `IN`/`OUT`, currency, and account. PARTIAL cannot be current |
| Idempotency | Pack uniqueness is provider batch reference inside owner and connection. Content hash is not globally unique. Amount, date, and narration are not a key |
| Events | No outbox insert in this slice. `ops.outbox_event` remains the only outbox |
| Audit | `ops.schema_migration` codes `D10-2` and `M2-1-GRANTS` |
| Dependencies | D10-1 and M1 roles |
| Tests | `d10_2_verify.sql`, `m2_1_rls.sql`, API suite |
| Acceptance | Verify sentence passes. Owner A cannot read owner B's logical transaction. `public.transactions` remains. `txn_fact` does not exist |
| Rollback | Forward-only. Do not edit `0004` after it is applied. A volume that has only M2.1 and no financial rows can be restored from the pre-M2 backup. Do not delete evidence once later slices write it |

## M2.2 — manual transaction and corrections

| | |
| --- | --- |
| Source | TRACE-01, F9H-094. Path `POST /v1/transactions/manual` |
| Scope | Not started. Extract the F9H-094 body before any schema |
| Database objects | Inserts into D10-2 logical and canonical tables, `ops.idempotency_record`, and `ops.outbox_event`. Requires a write policy that M2.1 deliberately omitted |
| API | DEFINED_IN_SOURCE, unimplemented |
| Python | No classification |
| Authorization | Firebase subject, membership, and account ownership. Client owner id remains a selector |
| Errors | 401 missing or rejected token, 403 owner or account not allowed, 409 idempotency conflict |
| Idempotency | One logical transaction per completed key. Retry returns the first result |
| Events | `TRANSACTION_CREATED` only if F9H-094 confirms that name on this write |
| Audit | Outbox in the same transaction. Correction is a new version with `USER_CORRECTION` or `REVIEWER_CORRECTION` |
| Dependencies | M2.1. F9H-094 extract |
| Tests | Matrix section M2.2 |
| Acceptance | Positive amount, explicit direction, currency, manual connection type, no row in `public.transactions` |
| Rollback | Disable the route. Keep committed versions |

## M2.3 — statement upload and source registration

| | |
| --- | --- |
| Source | D10 object-storage rule, `object_reference`, TRACE-09 / F9H-089 for `POST /v1/imports` |
| Scope | Not started. Upload session stays PROPOSED |
| Database objects | `source_connection` type `UPLOAD`, batch, document, statement instance |
| API | No approved signing path |
| Python | Not invoked |
| Authorization | Uploader actor and acquisition owner |
| Errors | Reject oversize and undeclared type before a document row is marked `AVAILABLE` |
| Idempotency | Provider or content identity scoped by owner and connection. A second upload links evidence; it does not invent a second economic id by hash uniqueness alone |
| Events | `IMPORT_STARTED` and `HISTORICAL_IMPORT_COMPLETED` are named. Payloads are not |
| Audit | Document status and reason codes already exist on `source_document` |
| Dependencies | OQ-12. F9H-089 body |
| Tests | Matrix section M2.3 |
| Acceptance | Bytes are outside Postgres. Hash is stored. Unresolved account is not READY |
| Rollback | Disable ingest routes. Keep document rows |

## M2.4 — parser v4 through Python

| | |
| --- | --- |
| Source | Parser v4 reference and SQL as algorithms. CF-03 forbids `txn_fact` as truth |
| Scope | Not started. Do not rewrite v4 as a generic expression parser |
| Database objects | `extraction_run` and `source_record`. Format registry seed into `ref` when the v4 registry is mapped. No legacy pipeline tables |
| API | None new |
| Python | Format detection, tokens, channel, bank patterns, UPI reference extraction, partial parsing, v4 error codes. Returns a result. Does not insert the canonical version |
| Authorization | Worker credential is separate from `monytix_intelligence` insert rights. Intelligence still cannot insert `core.logical_transaction` |
| Errors | Preserve the v4 taxonomy. `PARTIAL` and `FAILED` are document statuses the pack already allows |
| Idempotency | Batch lock uses owner, connection, and content hash (OQ-17). Two workers must not parse one batch into two logical transactions |
| Events | Outbox when Node commits the structure result |
| Audit | Extraction run timestamps. No raw narration in logs |
| Dependencies | M2.3 document row. CF-03 remains "do not mount the SpendSense tables" |
| Tests | One fixture per v4 channel family. No mock-only PASS |
| Acceptance | UPI classification and the rulebook are not executed |
| Rollback | Stop the worker. Keep extraction rows |

## M2.5 — normalization, reconciliation, deduplication

| | |
| --- | --- |
| Source | D10-2 duplicate policy and F10A identity logic as named by the README |
| Scope | Not started |
| Database objects | `duplicate_outcome`, `transaction_evidence_link` |
| API | None new |
| Python | Proposes match outcome. Node commits the version |
| Authorization | Same owner and account boundaries |
| Errors | Ambiguous match stores `REVIEW_REQUIRED`. It does not merge |
| Idempotency | Same content observed twice adds a link when identity holds. It does not collapse different merchants that share an amount |
| Events | None beyond the commit outbox |
| Audit | `identity_reason_codes` on the link |
| Dependencies | M2.4 observations, or a manual version from M2.2 |
| Tests | Matrix section M2.5, including two owners and two accounts |
| Acceptance | Direction and reversal stay separate. Amount stays positive |
| Rollback | Activate the previous READY version with `activate_canonical_transaction_version`. Do not delete the new version |

## M2.6 — review, partial parsing, corrections

| | |
| --- | --- |
| Source | D10-2 READY rules and immutability trigger |
| Scope | Not started |
| Database objects | New `canonical_transaction_version` rows. `is_current` is the only in-place change |
| API | Category correction stays BLOCKED (F9H-04) |
| Python | May return PARTIAL. It cannot activate PARTIAL |
| Authorization | Reviewer correction uses `REVIEWER_CORRECTION` only when that actor is allowed |
| Errors | READY plus `UNKNOWN` direction fails the check constraint |
| Idempotency | Reprocess creates a version. It does not replace `logical_transaction_id` |
| Events | Outbox in the activation transaction |
| Audit | `change_provenance` and `supersedes_version_id` |
| Dependencies | M2.5 |
| Tests | Matrix section M2.6 |
| Acceptance | Superseded version is not current. Exactly one current READY row |
| Rollback | Point `current_canonical_version_id` back at the prior READY version in one transaction |

## M2.7 — operational reliability and end-to-end verification

| | |
| --- | --- |
| Source | M0 test trace for intake scenarios, D10 DB01, DB02, DB03, DB05, DB06 as named by the phase plan |
| Scope | Not started |
| Database objects | None new |
| API | The routes that exist at that time |
| Python | The parser that exists at that time |
| Authorization | Repeat cross-owner and cross-account cases |
| Errors | Failed worker leaves the document in `FAILED` or `PARTIAL` with reason codes |
| Idempotency | Retry and concurrency from M2.5 |
| Events | Outbox rows match committed versions |
| Audit | Implementation report with commands and counts |
| Dependencies | M2.2 through M2.6 for a full ingest PASS. M2.1 alone is not that PASS |
| Tests | Matrix section M2.7. Real Postgres 17 and real parser fixtures |
| Acceptance | Two uploads of one matching file produce one logical transaction and two evidence links. Unresolved account is not READY |
| Rollback | Disable ingest routes. Keep documents and evidence |

## Stop

Implementation of this repository slice ends at M2.1. The next slice is M2.2, and only after F9H-094 is extracted.
