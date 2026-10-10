# F9H-094 v1.1 amendment

Status: **APPROVED**.

This document does not itself implement `POST /v1/transactions/manual`. Implementation is `database/migrations/0006_m2_2_manual_transaction.sql` and the authenticated route. It does not change the F9 source file, migrations `0001` through `0005`, or mobile screens.

Labels:

| Label | Meaning |
| --- | --- |
| FROZEN | Named by the F9 master contract and left unchanged |
| SOURCE_DERIVED | Required by D10-2 or D10-3 as already written |
| PROPOSED | Needed to reconcile the two contracts. Not in force until this amendment is approved |
| BLOCKED | Cannot be validated or written until a named source artifact exists |

## A. Frozen contract

Source: `frs/Monytix_F9_Master_UI_API_State_SQL_Implementation_Contract.docx`, extracted in `docs/contracts/M2_2_F9H094_MANUAL_TRANSACTION.md`.

| Item | Value | Label |
| --- | --- | --- |
| Method and path | `POST /v1/transactions/manual` | FROZEN |
| Operation | `ACT-TXN-001` `CREATE_MANUAL_TRANSACTION`, create only | FROZEN |
| Header | `Idempotency-Key` | FROZEN |
| Success UI state | `WRITE_COMMITTED` on `SCREEN_MANUAL_ENTRY` | FROZEN |
| Event | `TRANSACTION_CREATED` | FROZEN |
| Correction | Not this contract. `TRANSACTION_CATEGORY_CORRECTED` stays F9H-04 | FROZEN |

Frozen request fields: `amount`, `currency`, `merchant_description`, `occurred_at`, `category_code`, `subcategory_code`, optional `user_selected_weights`.

Frozen response shell: `meta.request_id`, `meta.generated_at`, `meta.api_version`, optional `meta.recompute_status`. Nested `data` is `PARTIAL — nested data schema TBD`.

## B. D10-2 requirements

`ck_canonical_ready_minimum_truth` in `database/migrations/0004_d10_2_source_intake_canonical_ledger.sql` requires, for `normalization_status = READY`:

| Requirement | Label |
| --- | --- |
| `financial_account_id` | SOURCE_DERIVED |
| `transaction_date` | SOURCE_DERIVED |
| `amount` greater than 0 | SOURCE_DERIVED |
| `direction` of `IN` or `OUT` | SOURCE_DERIVED |
| `currency_code` | SOURCE_DERIVED |
| `extraction_sequence` | SOURCE_DERIVED |

Category, subcategory, and weights are not columns on `core.canonical_transaction_version`. `UNKNOWN` direction cannot be READY. A canonical version is immutable after insert except `is_current`.

## C. Exact conflicts

| Topic | F9 | D10 | Conflict |
| --- | --- | --- | --- |
| Account | No account field on F9H-094 | Logical transaction requires `financial_account_id` | Cannot choose an account from the frozen body |
| Direction | No direction or transaction-type field | READY requires `IN` or `OUT` | Positive amount is not a direction |
| Taxonomy | `category_code` and `subcategory_code` must exist | Not part of READY truth. F10E nodes are not loaded | Required by the API, absent from the ledger columns and from the database |
| Weights | Optional `W01`–`W10` | No weight master in `0001`–`0005` | Codes cannot be checked |
| Source type | `MANUAL_ENTRY` | Connection check allows `MANUAL` | Names differ |
| Success `data` | Nested schema TBD | Identity is `logical_transaction_id` | Response body is unfinished |
| Persistence names | `monytix.transactions`, `spendsense.category` | `core.logical_transaction` | Legacy names are not created |

## D. Source-supported resolutions

**Account.** Searched the F9 master for a default account, a cash account used by manual entry, accountless pending, and account creation on this endpoint. None of those rules exist. `financial_account_id` does not appear in that document. `SCREEN_CONNECTED_BANKS` “Add Account” is `GET /v1/screen-connected-banks/context` and is marked `NEEDS CONTRACT DETAIL`. D10-1 allows `account_type` `CASH` and does not bind that type to a manual transaction. There is no source-supported account selector. The field below is proposed. The server must not pick the first account and must not insert an account.

**Direction.** No F9 field supplies a transaction type. `SCREEN_MANUAL_ENTRY` shows the static label “Amount Disbursed” and an example amount. That copy is not a mapping to `IN` or `OUT`. Direction is not inferred from amount, merchant text, category, subcategory, or weights.

**Taxonomy.** D10-3 README says category resolution sits on a READY canonical version and must not change amount, date, direction, or account. The same README says F10E master data is not seeded by D10-3. F9 still requires the two codes at submission and points `GET /v1/reference/transaction-taxonomy` at `spendsense` tables that are not in this database. The financial identity does not wait on classification. The existence check does.

**Weights.** `ACT-TXN-001` calls user-selected weights explicit user evidence, not system inference. The manual screen lists eight display names (Time, Comfort, Risk, Obligation, Identity, Opportunity, Attention, Resilience). The field rule says `W01`–`W10`. `human_context.weight_master` is named as new and is not in the applied migrations. CF-07 keeps personal weight names separate from UI text. These values do not change canonical amount or direction.

**Source type.** D10-2 already has connection type `MANUAL`. F9 names `MANUAL_ENTRY` on the action, not as a second physical enum.

## E. Proposed new fields

| Field | In | Type | Required | Rule | Label |
| --- | --- | --- | --- | --- | --- |
| `financial_account_id` | body | uuid | Yes | Active `core.account_ownership` for the selected owner | PROPOSED |
| `direction` | body | string | Yes | `IN` or `OUT` only on this create | PROPOSED |

`UNKNOWN` remains a D10 stored direction and is not accepted for this READY create.

## F. Request schema

`POST /v1/transactions/manual`

Header `Idempotency-Key` (FROZEN). Owner remains the M1 selector `x-monytix-owner-id`, accepted only through `core.actor_owner_membership`. That header is not an F9H-094 body field.

| Field | Required | Rule | Label |
| --- | --- | --- | --- |
| `amount` | Yes | Greater than 0. Decimal, not a float. Signed amounts are not adopted | FROZEN |
| `currency` | Yes | ISO-4217, three letters | FROZEN |
| `merchant_description` | Yes | Non-empty user text | FROZEN |
| `occurred_at` | Yes | Date-time. Stored as the event time. `transaction_date` is the date of that instant | FROZEN |
| `category_code` | Yes | User selection. Not a canonical amount column | FROZEN |
| `subcategory_code` | Yes | User selection. Belonging to `category_code` is not checked until F10E is loaded | FROZEN |
| `user_selected_weights` | No | Array of strings. Evidence only | FROZEN |
| `financial_account_id` | Yes | See section E | PROPOSED |
| `direction` | Yes | `IN` or `OUT` | PROPOSED |

## G. Response schema

UI state remains `WRITE_COMMITTED` (FROZEN).

| Field | Required | Label |
| --- | --- | --- |
| `meta.request_id` | Yes | FROZEN |
| `meta.generated_at` | Yes | FROZEN |
| `meta.api_version` | Yes | FROZEN |
| `meta.recompute_status` | No | FROZEN |
| `data.logical_transaction_id` | Yes | PROPOSED |
| `data.canonical_transaction_version_id` | Yes | PROPOSED |
| `data.version_no` | Yes | PROPOSED |
| `data.normalization_status` | Yes | PROPOSED. `READY` for a successful create |
| `data.amount` | Yes | PROPOSED. Echo of the submitted amount |
| `data.currency` | Yes | PROPOSED. Echo of the submitted currency |
| `data.direction` | Yes | PROPOSED. Echo of the submitted direction |
| `data.occurred_at` | Yes | PROPOSED. Echo of the submitted event time |

`data` does not include a category assignment, a merchant identity, a financial state, or a recommendation.

## H. Error behavior

F9H-094 lists no error status codes. The following are proposed.

| Situation | Status | Label |
| --- | --- | --- |
| Missing, invalid, expired, or revoked token | 401 | PROPOSED |
| Owner not in the actor's membership, or account not actively owned by that owner | 403 | PROPOSED |
| Same `Idempotency-Key` and same payload | Original success body | PROPOSED |
| Same `Idempotency-Key` and a different payload | 409 | PROPOSED |
| Invalid amount, currency, direction, or `occurred_at` | 422 | PROPOSED |

A failed write leaves no logical transaction, version, evidence link, outbox row, or completed idempotency row.

## I. Source-type mapping

| API name | Physical value | Label |
| --- | --- | --- |
| `MANUAL_ENTRY` | `core.source_connection.connection_type = MANUAL` | PROPOSED |

No new value is added to the D10-2 check constraint.

## J. Taxonomy dependency

| Item | Label |
| --- | --- |
| `category_code` and `subcategory_code` remain on the request | FROZEN |
| They are not economic truth and are not columns of `core.canonical_transaction_version` | SOURCE_DERIVED |
| Submitted codes may be stored on the source record as evidence | PROPOSED |
| Existence and parent checks against `ref.taxonomy_node` | BLOCKED until the frozen F10E artifact is loaded |
| Placeholder taxonomy tables, SpendSense tables, and applying D10-3 in this amendment | Not proposed |

Once this amendment is approved, a missing taxonomy does not block creating the financial identity. It blocks claiming that the codes were validated.

## K. Weight dependency

| Item | Label |
| --- | --- |
| Optional `user_selected_weights` | FROZEN |
| Explicit user evidence, not a computed weight | SOURCE_DERIVED from `ACT-TXN-001` |
| Persist the array on the source record without a weight-master insert and without a calculation | PROPOSED |
| Checking each code against `human_context.weight_master` or treating the values as W1–W10 intelligence | BLOCKED |

## L. Compatibility analysis

Approving this amendment does not change the frozen F9 fields or `WRITE_COMMITTED`. It adds two required body fields, so an unmodified F9 client that omits account and direction cannot call the amended endpoint. That incompatibility is intentional. Silent defaults would invent financial facts.

The canonical row stays D10-2. Personal and business interpretation stay off this write. Category correction is still a later version, not an update of the first version. `public.transactions` is not a write target.

## M. Open decisions

Approval is still required for:

1. Required `financial_account_id`.
2. Required `direction` of `IN` or `OUT`.
3. Mapping `MANUAL_ENTRY` to `MANUAL`.
4. Storing category codes as evidence and deferring F10E validation.
5. Storing weights as evidence without `human_context.weight_master`.
6. The proposed `data` fields and the proposed error statuses.

No decision here authorizes selecting the first account, creating an account, or inferring direction.

## N. Implementation acceptance criteria

These apply only after this amendment is approved. They are not met by this document.

- One authenticated create commits evidence, `core.logical_transaction`, version 1, the evidence link, `ops.outbox_event`, and `ops.idempotency_record` together.
- The same key and payload replay the first response and do not insert a second logical transaction.
- A different payload for the same key returns 409.
- Owner and account isolation hold under RLS.
- No row is written to `public.transactions`.
- No correction route is added.
- M2.3 is not started.

## Decision summary

| Topic | Resolution |
| --- | --- |
| Contract status | APPROVED |
| Account | Approved required `financial_account_id`. Not source-supported as a selector |
| Direction | Approved required `IN` or `OUT`. Not source-supported as a mapping |
| Taxonomy | Request fields frozen. Validation blocked until F10E is loaded. Not a READY-column prerequisite |
| Weights | Evidence only. Master validation blocked |
| Source type | Approved map `MANUAL_ENTRY` to `MANUAL` |
| Success response | Frozen meta shell plus proposed identity and echo fields |
| Next | M2.2 write path implemented. M2.3 is not started |
