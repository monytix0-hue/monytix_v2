# F9H-089 v1.1 statement upload amendment

Status: **APPROVED**. Production configuration: **Pending**.

This amendment is approved for implementation. It does not change the F9 source file or migrations `0001` through `0006`. Production Cloudflare R2 credentials are not stored here. A local S3-compatible test does not verify the production bucket. Local ClamAV does not verify the production scanner.

Labels:

| Label | Meaning |
| --- | --- |
| FROZEN | Named by the F9 master contract and left unchanged |
| SOURCE_DERIVED | Required by D10-2 as already applied |
| CONDITIONALLY APPROVED | Approved as architecture. Not implemented, and not a vendor or retention choice |
| PROPOSED | Needed to keep statement bytes off the API process. Not in force until this amendment is approved |
| BLOCKED | Cannot be validated until a named source artifact exists |

## A. Frozen contract

Source: `frs/Monytix_F9_Master_UI_API_State_SQL_Implementation_Contract.docx`.

| Item | Value | Label |
| --- | --- | --- |
| Create method and path | `POST /v1/imports` | FROZEN |
| Create header | `Idempotency-Key` on retryable writes | FROZEN |
| Create auth | Authenticated user | FROZEN |
| Create body `file` | binary, required. Note: supported type and size, malware scan, sensitive | FROZEN |
| Create body `file_type` | string, required. `PDF`, `XLS`, `XLSX`, or `CSV` | FROZEN |
| Create body `source_metadata` | object, optional | FROZEN |
| Create screens | `POPUP_CSV_UPLOAD`, `POPUP_PDF_UPLOAD` | FROZEN |
| Create success UI state | `WRITE_COMMITTED` | FROZEN |
| Create response shell | `meta.request_id`, `meta.generated_at`, `meta.api_version`, `data` | FROZEN |
| Nested `data` | `PARTIAL — nested data schema TBD` | FROZEN |
| Optional response field | `meta.recompute_status` | FROZEN |
| Create service note | Validate type and size, malware scan, parser support, protect statement data | FROZEN |
| Create event named on the service row | `IMPORT_SESSION_CREATED` | FROZEN |
| Status method and path | `GET /v1/imports/{import_id}/status` (F9H-010) | FROZEN |
| Status fields | `error_code`, `error_message`, `supported_actions`, `imported_transaction_count`, progress, stage, and counts | FROZEN |
| Retry method and path | `POST /v1/imports/{import_id}/retry` (F9H-090) | FROZEN |
| Retry rule | Only when the error is retryable. Preserve idempotency | FROZEN |
| PDF popup copy | Max 10MB. Password-protected PDF is supported | FROZEN as display copy |
| CSV popup copy | Upload CSV or Excel | FROZEN as display copy |
| Workbook events | `IMPORT_STARTED`, `HISTORICAL_IMPORT_COMPLETED` (TRACE-09) | FROZEN at event-name level. Payloads were not copied into this repository |

F9 also names `spendsense.upload_batch` and `monytix.source_sync_runs` as adapter aliases. Those tables are not created. D10 `core.source_batch` is the batch record.

## B. Why the binary field cannot be implemented as written

D10 stores statement bytes outside PostgreSQL. The pointer is `core.source_document.object_reference`.

Sending `file` to `POST /v1/imports` would put the statement in the Node.js process. The security model for this phase forbids that. A client report that an upload finished is not evidence. The API must read the stored object itself.

OQ-12 is closed. The companion decision approves private Cloudflare R2. Production credentials are not in this file.

## C. Proposed request

`POST /v1/imports` authorizes an upload. It does not receive the file.

| Field | Type | Required | Rule | Label |
| --- | --- | --- | --- | --- |
| `file_type` | string | Yes | Exactly `PDF`, `XLS`, `XLSX`, or `CSV` | FROZEN |
| `byte_size` | integer | Yes | Greater than 0 and at most 10 MiB (10,485,760 bytes) | APPROVED |
| `sha256` | string | Yes | 64 lowercase hex characters. The client declaration. The server recomputes it from the object | APPROVED |
| `original_filename` | string | Yes | Display name only. It is not an object key. Control characters are rejected | APPROVED |
| `source_metadata` | object | No | Opaque bank or source hints. Not an authorization field and not an object path | FROZEN as optional |

The header `Idempotency-Key` stays required.

`file` is not accepted. A multipart body or a JSON field that contains statement bytes is rejected.

Owner comes from membership, the same way the manual-transaction route resolves `x-monytix-owner-id`. The client does not supply an owner that skips `core.actor_owner_membership`.

## D. Proposed initiation response

The frozen shell stays. `meta.recompute_status` is omitted. Parsing has not started, so there is no derived refresh.

`meta.ui_state` on initiation is `UPLOAD_AUTHORIZED`. `WRITE_COMMITTED` is reserved for confirmation. Using it here would claim the object had been verified.

Proposed `data`:

| Field | Meaning |
| --- | --- |
| `import_id` | `core.source_batch.source_batch_id` |
| `source_document_id` | The reserved document row |
| `upload.url` | Upload-only capability. Short-lived. Not a public object URL |
| `upload.expires_at` | UTC timestamp. Conditionally approved lifetime is 15 minutes |
| `upload.headers` | The headers the client must send, including content type and checksum |
| `object_key` | Server-generated key. Returned so the client can detect a mismatch. The client cannot choose it |

The signed URL is not written to logs.

## E. Proposed confirmation

`POST /v1/imports/{import_id}/complete`

This path is not in F9. It is the step that replaces trust in the client.

The handler:

1. Authenticates the actor and checks owner membership.
2. Loads the reserved batch and document for that owner.
3. Reads the object from storage. It does not trust a client-supplied etag, size, or checksum.
4. Rejects a missing object, a size other than the declared size, a size over 10 MiB, a content signature that does not match `file_type`, or a SHA-256 that does not match `sha256`.
5. Stores the observed size, observed MIME type, and hash on the document.
6. Leaves status `RECEIVED` with reason `MALWARE_SCAN_PENDING` until a scan passes. `AVAILABLE` is not set in this phase.
7. Inserts `ops.outbox_event` with `semantic_trigger_code = IMPORT_SESSION_CREATED` only after the object checks pass. The payload carries ids, byte size, file type, and hash. It does not carry the filename, the narration, or the signed URL.
8. Completes the idempotency record.

Success uses the frozen shell and `meta.ui_state = WRITE_COMMITTED`. Proposed `data` echoes `import_id`, `source_document_id`, `file_type`, `byte_size`, `sha256`, and `upload_status = RECEIVED`.

No category, merchant classification, weight, transaction count, or decision is returned.

## F. Status

`GET /v1/imports/{import_id}/status` stays F9H-010.

The frozen meta fields stay. Until a parser runs:

- `imported_transaction_count` is `0`
- progress, stage, and counts describe upload state only
- `error_code` and `error_message` are present only on a terminal upload failure
- `supported_actions` may include starting a new import. It does not include parse retry

Upload states returned in `data.upload_status`:

| State | Meaning | Recovery |
| --- | --- | --- |
| `UPLOAD_AUTHORIZED` | Grant issued. Object not yet verified | Client uploads, then confirms, before expiry |
| `RECEIVED` | Object verified. Scan has not passed | Wait for a scanner. Not eligible for parsing |
| `EXPIRED` | Grant expired or the upload never completed | New import. The unconfirmed object is deleted |
| `FAILED` | Terminal verification failure | New import |

## G. Cancellation and expiry

No cancel route is added. An unconfirmed import expires with the upload grant. The sweeper deletes the unconfirmed object and sets `EXPIRED`. A confirmed document is not deleted by that sweeper.

F9H-090 `POST /v1/imports/{import_id}/retry` is unchanged and is not implemented here. It is a retry of a retryable import error, not a second upload of a new file.

## H. Idempotency and duplicates

Scope is `EXTERNAL_WRITE` on `ops.idempotency_record`, unique for the owner, the scope, and the key.

| Case | Result |
| --- | --- |
| Same key and same initiation payload | The stored success body. No second batch |
| Same key and a different payload | 409. No second batch |
| Concurrent same key | One batch. The loser returns the winner's body |
| Confirmation repeated after success | The stored confirmation body |
| Concurrent confirmation | One document update. One outbox row |
| Same file bytes under a new key | A new import. The hash is not a global unique key |
| Failed initiation or confirmation | The in-progress idempotency row rolls back with the database writes |

Content deduplication of logical transactions is M2.5. This amendment does not create `core.logical_transaction`.

## I. Errors

The envelopes match the manual-transaction route.

| Condition | HTTP | Body |
| --- | --- | --- |
| Missing, invalid, expired, or revoked token | 401 | `unauthorized` or `revoked` |
| Actor cannot access the owner, or the import belongs to another owner | 403 | `owner_forbidden` |
| Idempotency key reused with a different payload | 409 | `idempotency_conflict` |
| Missing key, bad `file_type`, bad size, bad hash, bad filename, or a body that includes file bytes | 422 | `invalid_request` |
| Grant expired, object missing, signature mismatch, checksum mismatch, or object identity changed after confirmation | 422 | `invalid_request` on confirmation. Status becomes `EXPIRED` or `FAILED` as specified in the security document |
| Storage or database unavailable | 503 | `unavailable` |

A forbidden response for a missing import and for another owner's import is the same, so the other owner's id is not revealed.

## J. Database mapping

No second evidence store. No write to `public.transactions`. No taxonomy table.

| Record | Home |
| --- | --- |
| Upload session and `import_id` | `core.source_batch`. Status `REGISTERED` until confirmation, then `COMPLETED` for the upload registration. Parsing is not `PROCESSING` yet |
| Source object | `core.source_document.object_reference` |
| Owner | `core.owner` through membership and `account` is not required at upload |
| Connection | Reuse the owner's active `UPLOAD` connection, or insert one |
| File metadata | `original_filename`, `declared_mime_type`, `observed_mime_type`, `size_bytes` |
| Checksum | `content_hash`, SHA-256 hex, written only after the server reads the object |
| Upload state | Document status plus reason codes |
| Ingestion job | `ops.outbox_event` `IMPORT_SESSION_CREATED`. The scan worker consumes it. Parsing does not run |
| Retry tracking | Existing outbox attempt columns. F9H-090 is not this slice |
| Audit | The outbox row. D10-1 and D10-2 define no separate audit table |
| Idempotency | `ops.idempotency_record` |

`HISTORICAL_IMPORT_COMPLETED` is not emitted. `statement_instance` and `extraction_run` are not written. A password is not accepted and is not stored. `PASSWORD_REQUIRED` remains a later parser status.

Batch `source_type` maps `PDF` to `BANK_STATEMENT_PDF`, `XLS` to `BANK_STATEMENT_XLS`, `XLSX` to `BANK_STATEMENT_XLSX`, and `CSV` to `BANK_STATEMENT_CSV`. `CREDIT_CARD_STATEMENT` is not selected by this request. `file_type` does not distinguish a card statement from a bank statement.

## K. Acceptance criteria

These apply only after this amendment and the OQ-12 recommendation are approved.

- An authenticated initiation commits a batch, a document pointer, and an idempotency row, and returns an upload-only grant.
- Confirmation reads the object and rejects a client-only success claim.
- The same key and payload replay. A different payload returns 409.
- Owner isolation holds.
- No statement bytes are stored in PostgreSQL or written to logs.
- No logical transaction, classification, or parser run is created.
- M2.4 is not started.

## Decision summary

| Topic | Resolution |
| --- | --- |
| Contract status | APPROVED. Production R2 and production ClamAV are pending infrastructure |
| Binary `file` on the API | Removed. Signed upload and server-side confirmation |
| `import_id` | `source_batch_id` |
| Initiation UI state | `UPLOAD_AUTHORIZED` |
| Confirmation UI state | `WRITE_COMMITTED` after object verification |
| Size | 10 MiB for PDF, XLS, XLSX, and CSV |
| Hash | SHA-256 |
| Grant lifetime | 15 minutes |
| Malware product | ClamAV. Infected objects are deleted. No quarantine bucket. Scanner failure stays blocked |
| Retention period | 90 days after successful processing. Abandoned uploads expire after 24 hours |
| Storage vendor | Cloudflare R2. Credentials stay in Dokploy secrets |
| Next | Local upload gate is implemented. Production R2 and production ClamAV stay pending. M2.4 waits until that verification passes |
