# M2.3 upload test matrix

Status: local security and integration gate **PASS** for the cases marked Local pass. Production R2 and production ClamAV are **not verified**.

Command, from `services/api`, against disposable PostgreSQL 17 (`127.0.0.1:55434`), MinIO (`127.0.0.1:55435`), and ClamAV (`127.0.0.1:55436`):

`npm test`

Result on 2026-10-10: **37 pass, 0 fail**. The upload integration test is skipped when `M2_TEST_DATABASE_URL`, `M2_TEST_ADMIN_URL`, `M2_TEST_S3_ENDPOINT`, and `M2_TEST_CLAMAV_HOST` are unset.

## Authentication and ownership

| Case | Expected | This slice |
| --- | --- | --- |
| Anonymous initiation | 401 | Local pass |
| Invalid token | 401 | Local pass |
| Revoked token | 401 | Local pass |
| Owner the actor cannot access | 403 | Local pass |
| Confirm or read another owner's import | 403 | Local pass |
| Client-supplied object key | Rejected | Local pass. The client never sends the key. The sealed key is `owners/{owner_id}/imports/{import_id}/object` |

## Initiation

| Case | Expected | This slice |
| --- | --- | --- |
| `CSV` | 201 `UPLOAD_AUTHORIZED` and an upload-only grant | Local pass |
| `PDF`, `XLS`, `XLSX` | 201 `UPLOAD_AUTHORIZED` | Not run |
| Body contains `file` bytes | 422 | Local pass |
| Missing `Idempotency-Key` | 422 | Local pass |
| Size 0, negative, or above 10 MiB | 422 | Not run |
| `file_type` outside the four frozen values | 422 | Local pass |
| SHA-256 not 64 lowercase hex characters | 422 | Not run |
| Same key and same payload | Original body | Local pass |
| Same key and a different payload | 409 | Local pass |
| Two concurrent calls with one key | One batch | Not run |
| Database unavailable during initiation | 503 | Not run |
| Storage signer unavailable | 503 | Not run |

## Object checks

| Case | Expected | This slice |
| --- | --- | --- |
| Upload never confirmed | Sweeper sets `EXPIRED` | Local pass |
| Grant expired before confirmation | Status `EXPIRED` | Not run as a separate case |
| Client says the upload finished, object absent | Confirmation fails | Not run |
| Object larger than declared or larger than 10 MiB | `FAILED` | Not run |
| Signature does not match `file_type` | `FAILED` | Not run |
| SHA-256 does not match the declaration | `FAILED` | Local pass. `CHECKSUM_MISMATCH` |
| CSV contains a NUL or is not UTF-8 | `FAILED` | Not run |
| Second import of the same bytes under a new key | A second batch. No logical transaction | Not run |
| Object replaced through the old staging URL after confirmation | Sealed object unchanged | Local pass |
| Storage unavailable during confirmation | 503 | Not run |

## Confirmation concurrency

| Case | Expected | This slice |
| --- | --- | --- |
| Repeated confirmation after success | Original confirmation body | Local pass |
| Two concurrent confirmations | One document update | Local pass. One `IMPORT_SESSION_CREATED` row |
| Confirmation by a different owner | 403 | Local pass |

## Scan, parser, and retention

| Case | Expected | This slice |
| --- | --- | --- |
| Clean local ClamAV scan | `AVAILABLE`, `parser_eligible` true | Local pass |
| EICAR | `REJECTED`, object deleted | Local pass |
| Scanner process down | Document stays `RECEIVED` | Local pass. `parser_eligible` stays false |
| `extraction_run` and logical transaction from an upload | None | Local pass |
| `HISTORICAL_IMPORT_COMPLETED` | Not emitted | Local pass. The outbox event is `IMPORT_SESSION_CREATED` |
| Retention query before processing completes | No due rows | Local pass |
| Production R2 and production ClamAV | Verified only after infrastructure exists | Not run |
