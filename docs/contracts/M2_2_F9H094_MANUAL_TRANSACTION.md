# M2.2 — F9H-094 manual transaction

Status: extracted. Reconciled against D10-2 as **conflicting**. This contract is **create-only**. It does not define a correction.

Source: `frs/Monytix_F9_Master_UI_API_State_SQL_Implementation_Contract.docx`.

| Source location | What it says |
| --- | --- |
| F9H catalog row F9H-094 | `WRITE`, `POST /v1/transactions/manual`, object Manual Transaction, request `F9H-094-REQ`, response `F9H-094-RESP` |
| F9H field catalog | Frozen request fields listed below |
| F9H response catalog | Response shell listed below. `data` is `PARTIAL — nested data schema TBD` |
| F9C.2 `SCREEN_MANUAL_ENTRY` | Action labels Log Decision Receipt and Cancel. Operations `CREATE` and `DISCARD_LOCAL` |
| F9E action `ACT-TXN-001` | `CREATE_MANUAL_TRANSACTION`, operation `CREATE` |
| F9F event `TRANSACTION_CREATED` | Create persists the canonical transaction. Idempotency key on create. The canonical transaction survives a downstream recompute failure |
| F9F event `TRANSACTION_CATEGORY_CORRECTED` | A different event. Not F9H-094 |

Authentication line on the F9H row: authenticated user unless the contract is explicitly public. This one is not public.

Idempotency line on the F9H row: retryable writes require the client header `Idempotency-Key`.

UI state on the response rows: `SCREEN_MANUAL_ENTRY`, `WRITE_COMMITTED`. TRACE-01 in `docs/contracts/M0_UI_API_TRACEABILITY.md` also names `SUBMITTING` → `WRITE_COMMITTED` → `DERIVED_REFRESH_PENDING` → `READY`. F9H-094 itself freezes `WRITE_COMMITTED` on this response.

## Create versus correction

F9H-094 creates a manual transaction. `ACT-TXN-001` says the write creates canonical manual financial evidence and emits `TRANSACTION_CREATED`.

It does not append a correction. Category correction is `TRANSACTION_CATEGORY_CORRECTED` and remains blocked by F9H-04. A correction, when a later contract allows it, must keep `logical_transaction_id` and insert a new `core.canonical_transaction_version`. It must not be an unrestricted update of the original version. That operation is not implemented in this slice.

## Frozen request

`POST /v1/transactions/manual`

Header `Idempotency-Key`: required for this canonical create. The F9H row does not define the header's format beyond the name.

| Field | In | Type | Required | Rule | Nullable | Freeze |
| --- | --- | --- | --- | --- | --- | --- |
| `amount` | body | number | Yes | Greater than 0 unless a signed-amount convention is explicitly adopted. It is not adopted | No | FROZEN |
| `currency` | body | string | Yes | ISO-4217 | No | FROZEN |
| `merchant_description` | body | string | Yes | Non-empty user-entered description | No | FROZEN |
| `occurred_at` | body | string / date-time | Yes | Valid occurred time. Preserve event time | No | FROZEN |
| `category_code` | body | string | Yes | Must exist in the transaction taxonomy | No | FROZEN |
| `subcategory_code` | body | string | Yes | Must belong to `category_code` | No | FROZEN |
| `user_selected_weights` | body | array of string | No | `W01` through `W10` only. Explicit user evidence, not system inference | No | FROZEN |

`ACT-TXN-001` adds: required amount and date, valid taxonomy codes, `source_type=MANUAL_ENTRY`, and an idempotency key.

No account field is in F9H-094-REQ. No direction field is in F9H-094-REQ. No owner field is in F9H-094-REQ.

## Frozen response shell

| Field | Type | Required | Nullable | Screen | UI state | Freeze |
| --- | --- | --- | --- | --- | --- | --- |
| `meta.request_id` | string | Yes | No | `SCREEN_MANUAL_ENTRY` | `WRITE_COMMITTED` | FROZEN |
| `meta.generated_at` | string / date-time | Yes | No | `SCREEN_MANUAL_ENTRY` | `WRITE_COMMITTED` | FROZEN |
| `meta.api_version` | string | Yes | No | `SCREEN_MANUAL_ENTRY` | `WRITE_COMMITTED` | FROZEN |
| `data` | object | Yes | Yes | `SCREEN_MANUAL_ENTRY` | `WRITE_COMMITTED` | PARTIAL — nested data schema TBD |
| `meta.recompute_status` | string | No | Yes | `SCREEN_MANUAL_ENTRY` | `WRITE_COMMITTED` | FROZEN |

The source says standard audit and provenance stay at the owning service. It does not list error status codes for this operation.

## Reconciliation with D10-2

These conflicts block a READY canonical commit. They are not resolved by a guessed body.

| F9 statement | D10-2 fact | Result |
| --- | --- | --- |
| No account in the request | `core.logical_transaction.financial_account_id` is required | Cannot choose an account from this contract |
| No direction in the request. Amount is positive. Signed amounts are not adopted | READY requires direction `IN` or `OUT`. `UNKNOWN` cannot be READY | Positive amount is not an expense and not income |
| `category_code` must exist in the taxonomy | No taxonomy table is loaded. F9 names `spendsense.category` and `monytix.categories`. `core.canonical_transaction_version` has no category columns | Cannot validate the required codes, and those legacy tables are not created |
| `user_selected_weights` must be canonical W01–W10 | Weight master tables are not in D10-1 or D10-2 | Cannot validate the codes |
| `source_type=MANUAL_ENTRY` | `core.source_connection.connection_type` allows `MANUAL`, not `MANUAL_ENTRY` | The names differ. This slice does not alter the check |
| F9D write targets `monytix.transactions`, `monytix.transaction_category_history`, and `intelligence.domain_events` | CF-01 and D10-2 use `core.logical_transaction`. `public.transactions` is not a write target | Those F9 table names are not created |
| Response `data` schema is TBD | A success body cannot be invented | The endpoint is not implemented |

Downstream recompute named by F9D (eligibility, weights, D1–D30) is out of this slice. The event contract says the canonical transaction survives that failure. No recompute is run here.
