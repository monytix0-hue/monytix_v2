# M2 test matrix

Rows marked **Run in M2.1** are executed with this slice. Later rows are specified and are not a PASS claim.

## M2.1 — run now

| Check | Command or script | Expected |
| --- | --- | --- |
| D10-2 pack verify | `database/verification/d10_2_verify.sql` on Postgres 17 after `0001`–`0004` | `D10-2 verification passed` |
| Cross-owner ledger denial | `database/verification/m2_1_rls.sql` after `0005` | `M2.1 RLS verification passed` |
| Intelligence cannot insert the ledger | Same script | `insufficient_privilege` on `INSERT` into `core.logical_transaction` |
| Roles do not bypass RLS | Same script | `rolbypassrls` is false for both application roles |
| Stub ledger remains | Same script | `public.transactions` exists |
| SpendSense table absent | Same script | `txn_fact` is absent |
| API stubs and health | `npm test --workspace services/api` | Existing suite passes. Health payload unchanged. No financial POST |

## M2.2 — not run

| Check | Expected when built | Blocker |
| --- | --- | --- |
| Manual create | Authenticated owner, positive amount, explicit direction, currency, manual provenance, one logical transaction, outbox row, idempotency row | F9H-094 body is not extracted |
| Repeat the same idempotency key | One logical transaction | |
| Correction | New canonical version. Previous amount and narration unchanged | |
| Anonymous call | 401 | |
| Other owner's account | 403 | |

## M2.3 — not run

| Check | Expected when built | Blocker |
| --- | --- | --- |
| Upload initiation | Authenticated, owner-authorized, size and type checked, pointer in `object_reference` | OQ-12 signing protocol |
| `POST /v1/imports` | Body taken from F9H-089, not invented | Body not extracted |

## M2.4 — not run

| Check | Expected when built |
| --- | --- |
| Parser v4 fixture per channel family | Format detection, tokens, channel, bank patterns, UPI reference extraction, partial status, and v4 error codes preserved |
| Parser SQL | Not executed. No `txn_fact` |
| Python | Returns a structure version. Node commits it |

## M2.5 — not run

| Check | Expected when built |
| --- | --- |
| Same statement twice | One logical transaction and two evidence links when content matches, per the M0 acceptance line. Hash is not a global unique key; identity logic must decide |
| Same row twice in one worker | No second logical transaction |
| Worker retry | Idempotent |
| Concurrent workers on one batch | Lock from owner, connection, and content hash (OQ-17). Not from amount plus narration |
| Same amount, different merchants | `REVIEW_REQUIRED` or `DISTINCT`. No silent merge |
| Manual and imported possible duplicate | No silent merge |
| Two owners | Isolation holds |
| Two financial accounts | Isolation holds |
| Reversal | Direction unchanged as a substitute for `reversal_indicator` |

## M2.6 — not run

| Check | Expected when built |
| --- | --- |
| PARTIAL version | Cannot become current |
| READY with `UNKNOWN` direction | Rejected by the pack constraint |
| Correction | New version. `is_current` is the only update on the prior row |

## M2.7 — not run

| Check | Expected when built |
| --- | --- |
| Applicable F10 workbook scenarios for intake | Only scenarios whose expected tables are D10-2 objects |
| Failure recovery | Disable ingest routes. Keep documents. Do not delete evidence |
