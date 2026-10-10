# M2.6 import review contract

Status: ADOPTED as a versioned amendment. Date: 2026-10-10.

This amendment does not edit the F9 source file. F9H-089 and F9H-010 stay the upload and status paths. `WRITE_COMMITTED` still means the object was confirmed. It does not mean the import is financially reconciled. `POST /v1/imports/{import_id}/retry` stays unimplemented.

Disposition words stay `MAPPED`, `LINKED_EXISTING`, `REVIEW_REQUIRED`, and `REJECTED`. A run that cannot be mapped returns `ineligible`. `MAPPED` is a new transaction. `REJECTED` is an invalid record. No expense, income, loan, or repayment label is assigned.

## Read model

`GET /v1/imports/{import_id}/status` keeps the upload fields and adds `data.reconciliation` from `ops.statement_import_summary`. Counts come from source records and the latest disposition. `imported_transaction_count` is the mapped count. `completion_eligible` is true only when the review count and the pending count are both zero and the extraction run is `COMPLETED` or `PARTIAL`.

`GET /v1/imports/{import_id}/review` lists `REVIEW_REQUIRED` rows. `GET /v1/imports/{import_id}/review/{source_record_id}` returns one of them. Each item has `source_record_id`, `review_version`, `reason_codes`, amount, date, direction, and reference. Narration is not returned.

## Review write

`POST /v1/imports/{import_id}/review/{source_record_id}` requires `Idempotency-Key` and `review_version`.

| Action | When it commits |
| --- | --- |
| `select_account` | The reason is `ACCOUNT_UNRESOLVED` or `ACCOUNT_AMBIGUOUS`, the date, positive amount, and direction are already stored, and the account is active and owned |
| `confirm_new` | The account is already resolved, the same financial fields are present, and the reason is not `CONFLICTING_REFERENCE` |
| `link_existing` | The target logical transaction is owned and its current READY version matches amount, direction, currency, and date |
| `reject` | The row is `REVIEW_REQUIRED` |

A missing financial field stays unresolved and is not invented. A stale `review_version` returns 409 and writes nothing. The same key and payload replay the stored body. A different payload with that key returns 409.

`POST /v1/imports/{import_id}/finalize` sets `import_finalized_at` only when `completion_eligible` is true. Otherwise it returns 409 `review_pending` and the unresolved count.

Owner is taken from membership. A client-supplied owner id is not accepted as authority.
