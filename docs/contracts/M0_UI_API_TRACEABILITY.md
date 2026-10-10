# M0 UI and API Traceability

Payload fields are not restated beyond names that appear in F9I or the F10 workbook. F9 §13 is the payload dictionary. F9 §14 and workbook sheet 10 forbid silent closure of open items.

Labels: **SOURCE_REQUIREMENT**, **ARCHITECTURAL_PROPOSAL**.

## Chain

**SOURCE_REQUIREMENT (F9, section F10.1.2 inside the F9 master):**

```
Figma screen / widget
  → element
  → user action
  → API
  → canonical object
  → database authority
  → domain event
  → recomputation
  → read model
  → UI state
  → expected result
```

An item is covered only when a test checks that contract, not when a screen exists (F9 F10.1.3).

## Registers inspected

| Register | Source | Scale found |
| --- | --- | --- |
| Personal screens | F9 §4 and Appendix A | 83-screen state contract |
| Personal widgets | F9 §5 | 340 widgets covering 1,367 reconciled elements |
| Personal content | F9I `00_Summary` | 1,367 elements; 313 dynamic values; 623 templates; 68 state texts; 64 contextual narratives; 262 static; 274 gap rows; 164 high severity |
| Personal UI workbook | `Monytix_Personal_UI_Mapping_Master_v4.1_Step4_Gap_Resolved_Reconciled.xlsx` | Sheets include screen inventory, widget inventory, element inventory, decision patterns |
| Business widgets | `Monytix_Business_UI_Widget_Element_Inventory_Step2_v1.1_FIGMA_VERIFIED.xlsx` | Widget inventory and Figma reconciliation sheets |
| Business API map | `Monytix_Business_UI_API_SQL_Implementation_Mapping_Step4_v1.0.xlsx` | `01_UI_API_SQL_Mapping`, `02_API_Contract_Registry`, SQL object registry, write matrix, refresh matrix |
| Repository OpenAPI | `packages/api-contracts/openapi.yaml` | Stub GET routes only. Not the F9 dictionary |

M0 did not copy 1,367 element rows into this file. Implementation reads F9I by element id.

## Content rule

**SOURCE_REQUIREMENT (F9I summary):** a visible number is computed, user-supplied, or an explicit constant. Missing values render as unavailable. They are not shown as zero. State copy binds to canonical enums. Contextual narrative needs a trigger, evidence, and a fallback. Example amounts in F9I such as a balance figure on Live are sample bindings, not seed data and not production constants.

## Worked traces from the F10 workbook sheet 06

These traces are source rows. They are not proof the API exists. The repository does not implement them.

### TRACE-01 Manual transaction

| Step | Source value |
| --- | --- |
| User action | Create a manual purchase |
| API | `POST /v1/transactions/manual` |
| Canonical object | Manual transaction |
| Event | `TRANSACTION_CREATED` |
| Recomputation | Normalize, then eligibility, weights, decisions, and alignment as applicable |
| Read model | Transactions, Live, decision context |
| UI state | `SUBMITTING` → `WRITE_COMMITTED` → `DERIVED_REFRESH_PENDING` → `READY` |
| Contract ref | F9H-094 |
| Database authority | D10 `core.logical_transaction` after normalization. Not `public.transactions` |

### TRACE-02 Human context

| Step | Source value |
| --- | --- |
| API | `POST /v1/human-context/transactions/{txn_id}/context-feedback` |
| Objects | Weight feedback, decision mode, reflection |
| Events | `WEIGHT_FEEDBACK_RECORDED`, `DECISION_MODE_UPDATED`, `REFLECTION_SUBMITTED` |
| Recomputation | Effective context, then alignment and learning |
| UI | `WRITE_COMMITTED` → `DERIVED_REFRESH_PENDING` |
| Ref | F9H-087 |
| Note | F9H-09 questions whether weight, mode, and reflection are one atomic write. Still OPEN |

### TRACE-03 Decision action

| Step | Source value |
| --- | --- |
| API | `POST /v1/decisions/{decision_id}/actions` |
| Events | `DECISION_ACCEPTED`, snoozed, or reminder |
| Gap | F9H-02. Final command set is not frozen. Status BLOCKED |

### TRACE-05 Mission create

| Step | Source value |
| --- | --- |
| API | `POST /v1/missions` |
| Event | `MISSION_CREATED` |
| Database | D10 `action.mission` for personal. Business missions use B10Q `mission` and must not share an unscoped id with personal D-codes |

### TRACE-07 Mission contribution

| Step | Source value |
| --- | --- |
| API | Workbook says TBD |
| Ref | F9H-03 |
| Status | BLOCKED. No payload is invented |

### TRACE-08 Category correction

| Step | Source value |
| --- | --- |
| API | Workbook says TBD |
| Event named by the sheet | `TRANSACTION_CATEGORY_CORRECTED` |
| Ref | F9H-04 |
| Database rule already frozen | F10E correction row. New resolution. Event family unchanged |
| Status | BLOCKED until F9 names the command |

### TRACE-09 Import

| Step | Source value |
| --- | --- |
| API | `POST /v1/imports` |
| Events | `IMPORT_STARTED`, `HISTORICAL_IMPORT_COMPLETED` |
| UI | `LOADING` → `READY` |
| Ref | F9H-089 |
| Database | D10 source batch and document. Historical rows keep `occurred_at` distinct from import time (workbook HIST-01) |

## Live element example

**SOURCE_REQUIREMENT (F9I sheet 02, element F9B2-0003):**

| Step | Value |
| --- | --- |
| Screen | `LIVE_HOME` |
| Figma node | `867:3541` |
| Widget | Balance / Story Hero |
| Element | Metric |
| Action | Display |
| API | `GET /v1/ui/live` |
| Canonical object | Financial state |
| Response field named by F9I | `summary.available_balance` |
| Fallback | Show unavailable. Do not invent 0 |
| Database | A current balance projection from `core.balance_snapshot` or a governed aggregate. Not a hardcoded figure |
| Recomputation | On API refresh after canonical balance or transaction commit |
| UI state | Ready only when the read model is current. Otherwise stale or loading, per F9 §12 |

The same read serves `today_decisions[]`, `weight_summary[]`, `active_mission`, `reflection_summary`, and `transactions_preview[]` (F9I sheet 02). Each of those is a projection. Writing from Live goes to the owning domain (D10 Table 18).

## Business trace shape

The business Step 4 workbook has `01_UI_API_SQL_Mapping` and `02_API_Contract_Registry`. M0 did not transcribe that registry into new paths, because CF-01 is open and copying paths without the SQL object column would split business UI from B10Q.

**ARCHITECTURAL_PROPOSAL:** M6 binds each business widget row to a B10Q object and to `projection.vw_decision_presentation_queue` for decision lists. The client displays REQUIRED, MISSION_RELEVANT, and AVAILABLE. It does not display SUPPRESSED as an action (B10Q v1.3 Table 7). The client does not recompute scores.

## State families the tests already name

From F9 section F10.3, the workbook expects tests for loading, empty, partial, stale, offline read, offline write, authentication failure, permission failure, conflict, rate limit, canonical write succeeding while recomputation fails, and unknown write result.

Those states are UI contracts. The stub API returns none of them.

## Dynamic content gaps that block a pixel-perfect Live build

F9I sheet 03 marks several Live narratives as medium gaps because trigger, evidence, and fallback are not frozen at element level (for example F9B2-0006 Comfort narrative). High-severity gaps are 164 at summary level. M8 cannot mark dynamic copy done by pasting Figma text.

## Repository gap

`openapi.yaml` paths (`/transactions`, `/personal`, and the other stub GETs) are not the `/v1/...` operations above. They are a skeleton. Replacing them is later work and must follow F9 rather than extend the stub schema.
