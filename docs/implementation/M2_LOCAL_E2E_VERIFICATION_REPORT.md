# M2 local end-to-end verification

Verdict: **PASS WITH GAPS**

The local Docker stack completed an authenticated statement import. Automatic duplicate linking did not run, so this is not a clean ingestion pass. M3.1 does not start.

## Environment configuration

The API and scanner read these names. Empty values leave authentication unconfigured and the scanner unable to start.

| Variable | Local value used |
| --- | --- |
| `FIREBASE_PROJECT_ID` | `monytix-test` |
| `MONYTIX_AUTH_PUBLIC_KEY_PEM` | Local RS256 public key mounted only for this stack |
| `OBJECT_STORAGE_ENDPOINT` | `http://minio:9000` |
| `OBJECT_STORAGE_REGION` | `us-east-1` |
| `OBJECT_STORAGE_BUCKET` | `statements` |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | Local MinIO access key already used by the integration tests |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | Local MinIO secret already used by the integration tests |
| `DATABASE_URL` | Compose default for `monytix_api` on database `monytix` |
| `CLAMAV_HOST` | `clamav` |
| `CLAMAV_PORT` | `3310` |

Production Cloudflare R2 credentials and the production Firebase project were not used. Dokploy still loads only `docker-compose.yml`. MinIO, the published API port, and the test public key are in `docker-compose.override.yml`.

Token checks use the existing verifier path: an RS256 JWT whose issuer and audience are `monytix-test`, checked with `MONYTIX_AUTH_PUBLIC_KEY_PEM`. No authentication bypass was added.

## Services verified

| Check | Result |
| --- | --- |
| Migrator | Exit 0 |
| API `GET /platform/health` | `{"module":"platform","status":"ok"}` |
| `POST /v1/imports` without a bearer token | 401 `unauthorized` |
| Scanner worker | Running, restart count 0 |
| ClamAV from the scanner | `PONG` |
| MinIO | Bucket `statements` created and used for the sealed object |
| Anonymous read of the sealed object | HTTP 403 |

## Nine-step results

The run created one owner, one savings account with base currency INR, one manual transaction, and one three-row CSV import.

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Authenticate | PASS | `GET /auth` returned 200. The session is authenticated for the test subject. |
| 2. Owned financial account | PASS | Account created and owned by that subject through an active primary-holder relationship. There is no account-create HTTP route; the existing ownership tables were used. |
| 3. Manual transaction | PASS | `POST /v1/transactions/manual` returned 201. Current canonical row is READY, amount `1250.5000`, direction OUT. |
| 4. Clean CSV upload | PASS | Authorize 201, presigned PUT 200, complete 201. |
| 5. Seal, scan, extract | PASS | Document `AVAILABLE`, reason `SCAN_CLEAN`, sealed flag true, sealed-object SHA-256 matches the uploaded bytes, extraction status `PARTIAL`. |
| 6. Mapping and duplicate detection | FAIL | Two eligible rows were `REVIEW_REQUIRED` / `ACCOUNT_UNRESOLVED`. Automatic links: 0. The upload path does not create a resolved statement account, so reference matching does not run. |
| 7. Resolve review | PASS WITH GAPS | Review queue returned 200 with 2 items. `select_account` returned 200 and outcome `MAPPED`. The second identical row was also mapped as a new transaction, not linked. The third row was `EXTRACTION_REJECTED` (`NO_FORMAT_MATCH`, `TRUNCATED_DESCRIPTION`) and was not a review item. |
| 8. Finalize and counts | PASS | Finalize 200. Status 200. `mapped_count` 2, `linked_count` 0, `review_count` 0, `invalid_count` 1, `pending_count` 0, `total_source_records` 3, `parser_version` `v4`, `completion_eligible` true. Logical transactions for the account: 3. Statement evidence links: 2. |
| 9. Persistence after API restart | PASS | After `docker restart` of the API, health returned ok and the same counts remained: 3 logical transactions, 2 evidence links, finalized at `2026-10-11T13:35:55.453Z`. |

Import id: `01a12b2d-3470-7812-8f13-66e3df583254`.

## Database persistence

Restarting the API did not change the finalized import, the logical-transaction count, or the evidence-link count.

## Test counts

One local end-to-end execution. Nine steps recorded: 6 PASS, 1 PASS WITH GAPS, 1 FAIL, 1 persistence PASS. No automated suite was re-run for this report.

## Remaining blockers

- Automatic duplicate detection did not link two rows that carried the same narration, amount, date, and direction. Both became separate mapped transactions.
- The upload path still has no resolved statement account before mapping, so reference matching stays in review.
- CSV extraction of a row with an empty description is `PARTIAL` and that row is invalid. PDF, XLS, and XLSX extraction were not part of this run.
- Production Cloudflare R2 and production ClamAV were not configured or verified.

## Final verdict

**PASS WITH GAPS.** Local authentication, private object storage, ClamAV scanning, sealing, review, finalization, and restart persistence worked. The ingestion gate is not a clean pass, because duplicate detection did not link the repeated statement row. M3.1 does not start.
