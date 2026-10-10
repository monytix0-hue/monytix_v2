# M2.3B implementation report

Date: 2026-10-10.

## Final report

M2.3B status: **PASS** on local disposable infrastructure.

OQ-12 architectural decision: **CLOSED_APPROVED**. Provider is Cloudflare R2 through the S3-compatible API. Infected objects are deleted. Confirmed statements are retained 90 days after successful processing. Abandoned uploads expire after 24 hours.

Deployment verified: **Local**. PostgreSQL 17, MinIO, and ClamAV on disposable containers. This is not a production deployment.

Production configuration: **Pending**. No private Cloudflare R2 bucket, endpoint, or credential was provisioned or verified. A local ClamAV pass does not show that the production scanner is deployed or receiving signature updates.

M2.4 parser integration: not started. A clean local scan sets `parser_eligible` and does not create an `extraction_run` or a logical transaction.

## What passed locally

| Check | Result |
| --- | --- |
| `POST /v1/imports` without a token, with an invalid token, or with a revoked token | 401 |
| Statement bytes in the body, a missing idempotency key, or an unsupported `file_type` | 422, and the store is not called |
| CSV authorize, PUT to the staging key, confirm | 201, then `RECEIVED` / `MALWARE_SCAN_PENDING` |
| ClamAV clean scan | `AVAILABLE`, `parser_eligible` true, no `extraction_run` |
| EICAR | `REJECTED` / `MALWARE_DETECTED`, final object deleted |
| PUT to the old staging URL after sealing | Final object hash unchanged |
| Declared SHA-256 does not match the object | 422, `CHECKSUM_MISMATCH` |
| Two concurrent confirmations | Both 201. One `IMPORT_SESSION_CREATED` row |
| Same idempotency key and payload | Replays the original import |
| Same key and a different payload | 409 |
| ClamAV unreachable | Document stays `RECEIVED`. `parser_eligible` stays false |
| Another owner reading the import | 403 |
| `monytix_intelligence` execute on `ops.authorize_statement_upload` | Denied |
| Abandoned upload older than 24 hours | `EXPIRED` |
| `ops.retention_due_statements(90)` immediately after upload | No rows. `processing_completed_at` is not set in this phase |

API suite with those services configured: **37 pass, 0 fail**.

## What this does not prove

- Production R2, Dokploy secrets, or a production bucket policy.
- Production ClamAV, freshclam, or signature freshness.
- Every row in `docs/qa/M2_3_UPLOAD_TEST_MATRIX.md`. Rows not listed above were not executed in this run.

## Implementation

| Piece | Location |
| --- | --- |
| Upload, scan, expiry, and retention functions | `database/migrations/0007_m2_3_statement_upload.sql` |
| Import routes | `services/api/src/imports/routes.ts` |
| S3-compatible adapter | `services/api/src/imports/storage.ts` |
| Scan worker | `services/api/src/imports/scan-worker.ts` |
| Local ClamAV and scanner services | `docker-compose.yml` |
| Empty secret names | `.env.example` |

Migrations `0001` through `0006` were not modified. No statement bytes are stored in PostgreSQL. `public.transactions` is not written.

## Next

Provision the private R2 bucket and the production ClamAV service through Dokploy, then repeat the upload, EICAR, and fail-closed checks against that infrastructure. M2.4 waits until that production verification passes.
