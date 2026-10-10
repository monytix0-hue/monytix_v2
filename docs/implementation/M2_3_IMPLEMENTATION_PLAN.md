# M2.3A implementation plan

Date: 2026-10-10.

## Final report

M2.3A status: **READY_FOR_APPROVAL**.

OQ-12: unresolved. No source document names a vendor or a bucket.

Storage provider: **proposed**. Private S3-compatible object storage. Not source-defined and not approved.

Upload contract: **amended**. F9H-089 remains the frozen create path, file types, idempotency header, and response shell. `docs/contracts/M2_3_STATEMENT_UPLOAD_CONTRACT.md` proposes v1.1 because the frozen binary `file` field would send statement bytes through Node.js.

Database: no migration in this phase. The later writer maps onto D10 rows that already exist.

| Record | D10 home |
| --- | --- |
| Upload session, `import_id` | `core.source_batch` |
| Source object | `core.source_document.object_reference` |
| Owner | `owner_id` on the connection, batch, and document |
| File metadata | `original_filename`, `declared_mime_type`, `observed_mime_type`, `size_bytes` |
| Checksum | `content_hash` |
| Upload state | `core.source_document.status` and `reason_codes` |
| Ingestion job | `ops.outbox_event` `IMPORT_SESSION_CREATED` |
| Retry tracking | Outbox attempt columns. F9H-090 is not this slice |
| Audit | The same outbox row. No new audit table |
| Idempotency | `ops.idempotency_record` scope `EXTERNAL_WRITE` |

Security controls required before a byte is accepted: private bucket, server-generated owner-scoped key, 15-minute upload-only grant, 10 MiB limit, content signature check, SHA-256 computed by the server, TLS, encryption at rest by the storage service, no public read, no permanent URL, no client-chosen path, malware gate before `AVAILABLE`, orphan deletion only for unconfirmed objects, and the logging denylist in `docs/architecture/M2_3_STORAGE_SECURITY.md`.

## Open decisions

M2.3B stays stopped until these are approved:

1. Private S3-compatible storage as the OQ-12 interface, without naming a vendor product.
2. F9H-089 v1.1: initiation without `file`, confirmation at `POST /v1/imports/{import_id}/complete`, `UPLOAD_AUTHORIZED` then `WRITE_COMMITTED`.
3. 10 MiB as the maximum for PDF, XLS, XLSX, and CSV.
4. SHA-256 as `content_hash`.
5. 15-minute upload grant.
6. A malware scanner product, or an explicit acceptance that verified objects remain `RECEIVED` with `MALWARE_SCAN_PENDING` and are not parsed.
7. A retention period for confirmed statements. Until then, only unconfirmed objects are deleted.

## What was written

| Document | Path |
| --- | --- |
| OQ-12 decision | `docs/decisions/M2_3_OQ12_STORAGE_DECISION.md` |
| Upload contract | `docs/contracts/M2_3_STATEMENT_UPLOAD_CONTRACT.md` |
| Storage security | `docs/architecture/M2_3_STORAGE_SECURITY.md` |
| Test matrix | `docs/qa/M2_3_UPLOAD_TEST_MATRIX.md` |
| This plan | `docs/implementation/M2_3_IMPLEMENTATION_PLAN.md` |

## What was not written

No route. No storage client. No change to `docker-compose.yml` or Dokploy. No migration. Migrations `0001` through `0006` are unchanged. No parser, classifier, or M2.4 work. The test matrix was not executed.

## M2.3B, after approval

One forward migration adds a security-definer writer, executable by `monytix_api` only, following the M2.2 grant boundary. The API adds the three import operations behind the existing Firebase guard. Tests run on disposable PostgreSQL 17 and a private S3-compatible test bucket. PASS still requires those runs. The matrix in `docs/qa/M2_3_UPLOAD_TEST_MATRIX.md` is the case list.

## Next

M2.3B — secure upload implementation, after the approvals above.

M2.4 is not started.
