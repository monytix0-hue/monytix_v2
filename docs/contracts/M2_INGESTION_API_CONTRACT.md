# M2 ingestion API contract

No new path in this file is approved for implementation. Status words match `docs/contracts/M0_API_SURFACE.md`.

M2.1 adds no route. Existing module stubs stay stubs. `GET /platform/health` stays the only unauthenticated API route. Intelligence `GET /health` stays internal and returns no tenant data.

## Named by a source, not implemented

| Operation | Status | What the source actually names | M2 slice |
| --- | --- | --- | --- |
| `POST /v1/transactions/manual` | DEFINED_IN_SOURCE | TRACE-01 path, event `TRANSACTION_CREATED`, UI states `SUBMITTING` → `WRITE_COMMITTED` → `DERIVED_REFRESH_PENDING` → `READY`, contract ref F9H-094. Database authority is `core.logical_transaction`, not `public.transactions` | M2.2. Blocked until the F9H-094 body is extracted. Do not invent the JSON |
| `POST /v1/imports` | DEFINED_IN_SOURCE | F10 workbook TRACE-09, ref F9H-089. Body not copied into this repository | M2.3. Do not invent the JSON |
| Import events `IMPORT_STARTED`, `HISTORICAL_IMPORT_COMPLETED` | DEFINED_IN_SOURCE at event level | Event names only | M2.3 |

## Not named as an approved path

| Operation | Status | Why it stays unimplemented |
| --- | --- | --- |
| Create upload session / signed URL | PROPOSED | D10 requires bytes outside Postgres. Signing protocol is OQ-12. `object_reference` is the column that will hold the pointer |
| Complete upload | PROPOSED | Must bind the object hash to `source_document`. No path string was extracted |
| Connect mailbox | MISSING_SPECIFICATION | OQ-11. Gmail is out of every M2 slice until a field dictionary exists |
| Category correction `POST` | BLOCKED | F9H-04 |
| Reprocess | MISSING_SPECIFICATION | D10 replay exists. No public path was extracted |

## Persistence these operations must use when they are built

- Owner comes from membership, not from a client-supplied tenant that skips `core.actor_owner_membership`.
- Idempotency uses `ops.idempotency_record`. A retry does not insert a second logical transaction for the same owner, source, and provider or content identity.
- The outbox row is `ops.outbox_event`, written in the same database transaction as the canonical insert.
- Amount is `numeric(20,4)` and positive. Direction is `IN`, `OUT`, or `UNKNOWN`. READY cannot use `UNKNOWN`.
- A correction inserts a new `canonical_transaction_version` with `change_provenance` of `USER_CORRECTION` or `REVIEWER_CORRECTION`. It does not update amount or narration on the previous version.
