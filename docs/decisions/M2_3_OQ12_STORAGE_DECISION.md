# M2.3A decision — OQ-12 statement storage

Status: **CLOSED_APPROVED**. Date: 2026-10-10. Production configuration: **Pending**.

OQ-12 is closed as an architectural decision. The production provider is Cloudflare R2 through the S3-compatible API. A private bucket, its endpoint, and its credentials are not provisioned by this repository. They are supplied later through Dokploy secrets. A local S3-compatible test does not verify production R2. A local ClamAV pass does not verify the production scanner or its signature updates.

This document does not add a bucket, a route, a migration, or a parser.

## Recommendation

Use private S3-compatible object storage with short-lived, upload-only signed URLs.

The storage API is the S3 API. A deployment may point that API at an object store on the same host as Dokploy or at an external S3-compatible service. Neither choice is named by D10, F9, or the current Compose file. Credentials stay in the Dokploy secret store. They are not committed.

The client uploads to the private store. Node.js does not receive the statement bytes. Python workers, when a later phase starts them, read the object with a separate short-lived grant. That grant is not issued in this phase.

## Findings

| Control | Status | Evidence |
| --- | --- | --- |
| Bytes live outside PostgreSQL | SOURCE_DEFINED | D10 §19, recorded in `docs/architecture/M0_SECURITY_ARCHITECTURE.md`. `core.source_document` stores `object_reference`, not the file |
| Object pointer column | IMPLEMENTED | `object_reference` in `database/migrations/0004_d10_2_source_intake_canonical_ledger.sql` |
| Content hash, size, declared and observed MIME | IMPLEMENTED | Same table. Hash algorithm is not constrained |
| Owner on the document and batch | IMPLEMENTED | `owner_id` plus RLS read policies. No write policy |
| Connection type `UPLOAD` | IMPLEMENTED | `ck_source_connection_type` |
| Batch file families | IMPLEMENTED | `BANK_STATEMENT_PDF`, `BANK_STATEMENT_XLS`, `BANK_STATEMENT_XLSX`, `BANK_STATEMENT_CSV`, `CREDIT_CARD_STATEMENT` |
| Allowed API file types | SOURCE_DEFINED | F9H-089 `file_type`: `PDF`, `XLS`, `XLSX`, `CSV` |
| Direct binary field `file` on `POST /v1/imports` | SOURCE_DEFINED | F9H-089. Conflicts with keeping bytes off the API process. Reconciled only by the v1.1 amendment |
| Maximum 10 MiB for PDF, XLS, XLSX, and CSV | CONDITIONALLY APPROVED | PDF popup copy says 10MB. The v1.1 amendment applies 10,485,760 bytes to every allowed type |
| Malware scan before processing | SOURCE_DEFINED as a control | F9H-089 field note and the import-service note |
| Malware scanner product and quarantine behavior | CLOSED_APPROVED | ClamAV, isolated worker. An infected object is deleted after a non-sensitive verdict. No quarantine bucket |
| Password-protected PDF is a supported user case | SOURCE_DEFINED as UI copy | `POPUP_PDF_UPLOAD`. D10 forbids storing the password on `source_document` |
| Document erasure leaves a reference | SOURCE_DEFINED | Status `ERASED_REFERENCE_ONLY` |
| Confirmed statement retention | CLOSED_APPROVED | 90 days after successful processing. The clock does not start at upload time |
| Abandoned upload retention | CLOSED_APPROVED | 24 hours, then the unconfirmed object is deleted |
| Storage vendor | CLOSED_APPROVED | Cloudflare R2. Production bucket and credentials are pending infrastructure setup |
| Bucket or container name | PENDING_CONFIGURATION | Named in Dokploy secrets. Not committed |
| Signed upload URL and its lifetime | CONDITIONALLY APPROVED | 15-minute upload-only grant. F9 does not define the URL. The product that signs it is not chosen |
| Signed download | PROPOSED | D10 AC-032: source download is not part of Live payloads. A later explicit grant may read one object. No permanent URL |
| Public-read storage | CONDITIONALLY APPROVED as forbidden | Not a source permission. The approved architecture forbids it |
| Client-chosen object path | CONDITIONALLY APPROVED as forbidden | The server generates `owners/{owner_id}/imports/{import_id}` |
| Object ownership | SOURCE_DEFINED for the database row | The batch and document `owner_id` is the owner. The storage key repeats that owner id. The storage principal is the API, not the user |
| Encryption in transit | SOURCE_DEFINED as a requirement class | M0 security requires TLS for object storage. The local Compose network is the documented local exception |
| Encryption at rest | PROPOSED | M0 proposes volume encryption on the VPS and treats application-level encryption as optional. No KMS product is named. The proposal requires the storage service to encrypt objects at rest |
| Upload verification independent of the client | PROPOSED | The confirmation handler reads the object. A client completion report is not evidence |
| Checksum algorithm | CONDITIONALLY APPROVED | SHA-256, stored in `content_hash` |
| Deletion of an unconfirmed object | PROPOSED | Expire the grant, delete the object, mark the import expired. Confirmed evidence is not deleted by that sweeper |
| Idempotency and outbox | IMPLEMENTED | `ops.authorize_statement_upload` and `ops.complete_statement_upload` in `database/migrations/0007_m2_3_statement_upload.sql` |
| Upload route | IMPLEMENTED | `POST /v1/imports`, `POST /v1/imports/{import_id}/complete`, `GET /v1/imports/{import_id}/status` |
| Dokploy object storage | PENDING_CONFIGURATION | Compose can start ClamAV and the scan worker. The R2 bucket and credentials are still supplied outside the repository |

## Approved decision

| Decision | Result |
| --- | --- |
| S3-compatible private storage | CLOSED_APPROVED. Provider is Cloudflare R2 |
| F9H-089 v1.1 upload-then-verify shape | APPROVED |
| 10 MiB limit, SHA-256, 15-minute upload grant | APPROVED |
| Production endpoint, bucket name, and credentials | PENDING_CONFIGURATION. Dokploy secrets only. Not in git |
| Malware scanner | CLOSED_APPROVED. Isolated ClamAV. Infected objects are deleted. No quarantine bucket |
| Scanner unavailable | Fail closed. The document stays blocked from parsing |
| Confirmed statement retention | 90 days after successful processing |
| Abandoned upload retention | 24 hours |
| Production deployment | Pending. Local tests do not verify production R2 or production ClamAV |

## OQ-12 result

**CLOSED_APPROVED** as architecture. Production configuration remains pending until the private R2 bucket and the production scanner are provisioned and verified.
