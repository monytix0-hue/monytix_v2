# M2.8 implementation report

Verdict: **PASS**

The local authenticated ingestion gate passed. Production Cloudflare R2 and production ClamAV remain separate blocked environment gates. M3.1 was not started.

## 1. Root cause

`POST /v1/imports` wrote a batch and a document and did not write `core.statement_instance`. Extraction preserved that gap. `ops.map_statement_extraction` treats a missing resolved instance as `ACCOUNT_UNRESOLVED`, so M2.6-v1 reference matching never ran. `select_account` then inserted a new logical transaction without looking for an existing strong match.

## 2. Files changed

- `database/migrations/0012_m2_8_account_binding.sql`
- `scripts/migrate.sh`
- `services/api/src/imports/routes.ts`
- `services/api/src/imports/store.ts`
- `services/api/package.json`
- `services/api/tests/account-binding.integration.test.ts`
- `scripts/m28-local-e2e.mjs`
- `docs/architecture/M2_8_ACCOUNT_BINDING_ARCHITECTURE.md`
- `docs/qa/M2_8_RECONCILIATION_TEST_MATRIX.md`

Migrations `0001` through `0011` were not edited.

## 3. Migrations added

`0012_m2_8_account_binding.sql`, registered as `M2-8-ACCOUNT-BINDING`.

It adds `core.canonical_transaction_version.strong_identity_guard`, a trigger that sets that flag on new inserts, a unique index for guarded current strong identities, and a unique resolved statement instance per document. It adds `ops.decide_statement_identity`, `ops.bind_statement_account`, and `ops.statement_strong_duplicate_report`. It replaces the mapper and the review function, and adds the account argument to `ops.authorize_statement_upload`. The previous eight-argument upload function remains and passes a null account.

Historical canonical rows keep `strong_identity_guard = false`. They are outside the new unique index.

## 4. Contract amendments

F9H-089 does not name an account. The versioned amendment adds optional `financial_account_id` on `POST /v1/imports`. The server accepts it only when the authenticated owner has an active relationship to an active account. A missing value remains valid. Another owner's account is 403 `owner_forbidden`.

One import binds one account through `core.statement_instance`. Multiple statement accounts on one document are not accepted.

`select_account` and `confirm_new` can return `LINKED_EXISTING`, or remain `REVIEW_REQUIRED`, when M2.6-v1 says so. Rebinding a different account after a canonical commit returns 409 `account_bound`.

## 5. Account binding lifecycle

The upload stores a resolved statement instance before the object is scanned. Extraction and a repeated save leave that row in place. The mapper reads it. Review can bind the same way when the upload omitted the account. A later change of account is rejected once a row from that document is `MAPPED` or `LINKED_EXISTING`.

## 6. Review reconciliation changes

Both creating review actions call `ops.decide_statement_identity` inside the review transaction, under the same advisory locks as automatic mapping. A strong match links. A conflicting reference or a weak amount-and-date match stays in review. A new logical transaction is inserted only when the policy returns `create`.

## 7. Test results

PostgreSQL 17 integration test `M2.8 binds an owned account and reconciles strong duplicates`: pass. That test covers T01 through T25 and T28.

Re-run of the existing mapping, review, and manual-transaction integration tests on the same database: 12 pass, 2 skip. The skipped files also require host-published MinIO and ClamAV. Those services were exercised by the Docker run instead.

## 8. Local E2E evidence

Fresh authenticated CSV import `01a12b3f-0626-7ef4-ac7e-ed9a473112ae` on the compose stack.

| Check | Result |
| --- | --- |
| `GET /auth` | 200 |
| Cross-owner account | 403 |
| Authorize, presigned PUT, complete | 201, 200, 201 |
| Statement instance | Resolved to the owned account |
| Document | `AVAILABLE`, sealed hash matches |
| Anonymous read of the sealed object | 403 |
| Row outcomes | `MAPPED`, `LINKED_EXISTING` |
| Counts | `mapped_count` 1, `linked_count` 1, `review_count` 0 |
| Canonical result | 1 logical transaction, 2 evidence links |
| Later distinct import `01a12b3f-414d-77b5-9471-4d2f050a6a18` | `MAPPED` on a different logical transaction |
| After API restart | Same outcomes, 1 logical transaction, 2 evidence links |
| Scanner | Running, restart count 0 |

## 9. Historical import impact

The earlier local import on account `01a12b2d-3324-71e2-8fbd-4faf2ec90b2a` still has the same logical transactions, including one strong-identity group of two. `ops.statement_strong_duplicate_report` still returns that group. No canonical row was deleted or updated. A financial correction needs its own versioned contract.

## 10. Remaining production blockers

Production object storage is still not configured for this local gate. The local run used MinIO. Production ClamAV was not used. The local scanner reached the compose ClamAV service. Neither production check is claimed.

CSV remains the only extraction carrier. PDF, XLS, and XLSX still stop at `UNSUPPORTED_FILE_LAYOUT`.

## 11. Final verdict

**PASS.** Owned-account binding reaches the mapper. A strong duplicate links. Review uses the same policy. Concurrent review calls produced one canonical transaction. Owner isolation held. Evidence remained immutable. Import counts reconciled. The authenticated local CSV import passed, including persistence across an API restart.

M3.1 was not started in this change. The local ingestion gate that blocked it has now passed.
