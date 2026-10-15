# M2.8 statement account binding

Status: adopted. Date: 2026-10-11.

Migrations `0001` through `0011` are unchanged. `core.logical_transaction` remains the only transaction identity. This milestone does not classify transactions and does not start M3.1.

## Root cause

`ops.map_statement_extraction` resolves an account only from `core.statement_instance` when `account_resolution_status` is `RESOLVED` and `financial_account_id` is set. The path is:

1. `POST /v1/imports` calls `ops.authorize_statement_upload`.
2. That function writes `core.source_batch` and `core.source_document`.
3. Confirmation seals the object. The scanner writes `core.extraction_run` and `core.source_record`.
4. `ops.map_statement_extraction` reads the extraction run and looks up `core.statement_instance`.

Upload and extraction never inserted `core.statement_instance`. The lookup count was zero, so every eligible row was stored as `REVIEW_REQUIRED` / `ACCOUNT_UNRESOLVED`. Reference matching did not run.

`select_account` and `confirm_new` then inserted a new `core.logical_transaction` whenever the financial fields were valid. They did not call the M2.6-v1 match. Two identical statement rows became two canonical transactions.

## Amendment

F9H-089 freezes `file_type` and optional `source_metadata`. It does not name a financial account. `source_metadata` is not an authorization field. This amendment adds one optional field. The frozen path, file types, idempotency header, and response shell stay.

| Field | Required | Rule |
| --- | --- | --- |
| `financial_account_id` | No | UUID of an `ACTIVE` account with an active, non-revoked `core.account_ownership` row for the authenticated owner |

A missing account is still a valid upload. Those rows stay `REVIEW_REQUIRED` until a review action binds an owned account. An unknown account, an inactive account, and another owner's account all return 403 `owner_forbidden`. The client does not send an owner id as authority.

One import binds one account. `core.statement_instance` remains the binding record, one resolved row per `source_document_id`. A document that already has more than one statement instance is not guessed. A second resolved account on the same document is rejected. A multi-account statement is not added here.

`select_account` and `confirm_new` may now return `LINKED_EXISTING` when M2.6-v1 finds a strong match, or stay `REVIEW_REQUIRED` when the match is weak or conflicting. `POST` review of a different account after a binding exists returns 409 `account_bound`.

## Binding lifecycle

1. The authenticated owner selects an existing account, or omits it.
2. The server checks membership, then account ownership. Narration is not used.
3. A valid account inserts one `core.statement_instance` with `account_resolution_status = RESOLVED`, `statement_status = PARTIAL`, and the account base currency.
4. Extraction does not update that row. A repeated extraction returns the existing run.
5. `ops.map_statement_extraction` reads the instance and applies M2.6-v1.
6. The same idempotency key and payload return the same import. The binding stays.
7. After any source row on that document is `MAPPED` or `LINKED_EXISTING`, a different `financial_account_id` is rejected by `core.guard_statement_account_binding`.

`select_account` uses the same bind function when the upload had no account. The same account is accepted again. A different account is rejected.

## Matching

The decision function is `ops.decide_statement_identity`. Mapping version remains `M2.6-v1`.

A strong link requires the same account, amount, direction, currency, transaction date, and non-empty reference. The reference is compared only inside that account. Amount and date alone do not link.

| Evidence | Result |
| --- | --- |
| Full strong match | `LINKED_EXISTING` |
| Same reference, any other stored difference | `REVIEW_REQUIRED` / `CONFLICTING_REFERENCE` |
| No reference, and the same account, amount, direction, and date already exist | `REVIEW_REQUIRED` / `WEAK_MATCH` |
| No match | `MAPPED` |

The mapper and both creating review actions take the same advisory locks before they read or insert. New current canonical rows are marked `strong_identity_guard`. A unique index on the guarded strong identity rejects a second current row. Rows that existed before this migration stay unguarded, so the historical pair is not rewritten and does not block the index.

## Review

| Action | After this change |
| --- | --- |
| `select_account` | Validates ownership, binds the document, then runs the decision above |
| `confirm_new` | Re-runs the decision in the same transaction before a new logical transaction is inserted |
| `link_existing` | Still requires the target logical transaction to be owned and to match amount, direction, currency, and date |
| `reject` | Unchanged |

A strong match links. A weak or conflicting match stays in review and does not insert a second transaction. The same idempotency key replays the stored body. A stale `review_version` writes nothing.

## Historical imports

`ops.statement_strong_duplicate_report` lists current ready rows that share a strong identity. It does not update them. The local import that mapped the same reference twice is still two logical transactions and is named in the implementation report. No canonical row was deleted. A corrective write needs a separate versioned contract.
