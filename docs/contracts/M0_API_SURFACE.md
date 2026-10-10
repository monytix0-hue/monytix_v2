# M0 API Surface

Status meanings:

- **DEFINED_IN_SOURCE** — a supplied contract names the operation. The body remains the F9 or business workbook table, which this file does not rewrite.
- **PROPOSED** — required by the architecture and not named as a path in the extracts read during M0.
- **MISSING_SPECIFICATION** — the product needs the operation and no contract names it.
- **BLOCKED** — a source issue says the contract is open. Do not implement a guessed body.

The live OpenAPI file is a stub and is not this surface.

## Authentication

| Operation | Status | Authority |
| --- | --- | --- |
| Session establishment from a Firebase ID token | PROPOSED | Stack brief plus D10 actor mapping. No path string was extracted from F9 |
| Revoke / logout | PROPOSED | Security architecture. Token revocation is Firebase-side plus server rejection |
| `GET /auth` | Repository stub only | Not a financial contract |

Owner selection is OQ-01. No switch-owner payload is defined here.

## Onboarding

| Operation | Status | Authority |
| --- | --- | --- |
| Create owner profile after first sign-in | PROPOSED | D10 `core.owner`. Payload not copied from F9 §13 in this audit |
| Submit onboarding quiz | PROPOSED | F10J immutable quiz profile. Exact questions were not extracted as an API body |
| `POST /v1/imports` | DEFINED_IN_SOURCE | F10 workbook TRACE-09, ref F9H-089 |

## Accounts

| Operation | Status | Authority |
| --- | --- | --- |
| List and get financial accounts | DEFINED_IN_SOURCE as a domain | F9 account screens exist in the 83-screen contract. Exact path strings were not all extracted. Do not use stub `GET /accounts` as the contract |
| Account connection start | MISSING_SPECIFICATION | D10 `source_connection` includes AA, API, upload, email, manual. Consent fields were not extracted |

## Transactions

| Operation | Status | Authority |
| --- | --- | --- |
| `POST /v1/transactions/manual` | DEFINED_IN_SOURCE | TRACE-01, F9H-094 |
| List and get transactions | DEFINED_IN_SOURCE as Live/transaction read models | F9I `transactions_preview[]` and transaction screens. Full list path is in F9 §6 |
| `POST` category correction | BLOCKED | F9H-04, TRACE-08 TBD |
| Client-supplied SQL or filter language | Forbidden | Security architecture. Not an API |

## Statement upload

| Operation | Status | Authority |
| --- | --- | --- |
| Create upload session / signed URL | PROPOSED | D10 object-storage rule. Signing protocol is OQ-12 |
| Complete upload | PROPOSED | Binds object hash to `source_document` |
| Import status | DEFINED_IN_SOURCE at event level | `IMPORT_STARTED`, `HISTORICAL_IMPORT_COMPLETED` |

## Gmail ingestion

| Operation | Status | Authority |
| --- | --- | --- |
| Connect mailbox | MISSING_SPECIFICATION | Email is a D10 source type. OAuth scopes and message schema were not in the extracts read (OQ-11) |
| Disconnect mailbox | PROPOSED | F9 F10.4.21 discusses deletion and connection removal. Exact path not extracted |

Do not poll Gmail with a stored refresh token inside Postgres (D10 forbids provider secrets in the domain database).

## Classification

| Operation | Status | Authority |
| --- | --- | --- |
| Read current classification head | DEFINED_IN_SOURCE as part of transaction and Live reads | F10D–F10F. Not a separate guessed resource |
| Reprocess | MISSING_SPECIFICATION | D10 replay tables exist. No public path extracted |
| User event or taxonomy correction | BLOCKED for category. Event correction path not extracted | F9H-04 and F10D correction object |

## Personal state, memory, foresight

| Operation | Status | Authority |
| --- | --- | --- |
| `GET /v1/ui/live` | DEFINED_IN_SOURCE | F9I. Fields include `summary.available_balance`, `today_decisions[]`, `weight_summary[]`, `reflection_summary`, `active_mission`, `transactions_preview[]` |
| Current weight profile | DEFINED_IN_SOURCE inside Live and profile screens | F10J snapshot. Nested schema gap F9H-01 |
| Personal memory / baselines | PROPOSED | F10G is the store. A dedicated public route was not extracted |
| Foresight / cash projection | DEFINED_IN_SOURCE as decision behavior | D11 and D12 are decisions, not a free-form forecast API. Stub `GET /projections` is not that contract |

## Personal decisions and missions

| Operation | Status | Authority |
| --- | --- | --- |
| `GET /v1/ui/decisions` | DEFINED_IN_SOURCE | Workbook scenarios E2E-004 and others |
| `POST /v1/decisions/{decision_id}/actions` | BLOCKED | F9H-02 |
| `POST /v1/decisions/{decision_id}/reflection` | DEFINED_IN_SOURCE | TRACE-04, F9H-086 |
| `POST /v1/missions` | DEFINED_IN_SOURCE | TRACE-05, F9H-091 |
| `POST /v1/missions/{mission_id}/actions` | DEFINED_IN_SOURCE | TRACE-06, F9H-092 |
| Mission contribution | BLOCKED | F9H-03, TRACE-07 TBD |
| `POST /v1/human-context/transactions/{txn_id}/context-feedback` | DEFINED_IN_SOURCE | TRACE-02. Atomicity OPEN (F9H-09) |

## Business state and decisions

| Operation | Status | Authority |
| --- | --- | --- |
| Business screen APIs | DEFINED_IN_SOURCE inside the Step 4 workbook | Not transcribed here because CF-01 is open |
| Decision queue read | DEFINED_IN_SOURCE as a projection | `projection.vw_decision_presentation_queue` (B10Q v1.3). HTTP path must come from the Step 4 registry during M6 |
| Client-side eligibility | Forbidden | B10Q v1.3 §10 |

## Habits and nudges

| Operation | Status | Authority |
| --- | --- | --- |
| List nudges | BLOCKED | CF-08. Stub `GET /nudges` is not MoneyMoments and not an F9 contract extracted as approved |
| Habit scores | MISSING_SPECIFICATION | D10 retires the nudge runtime. No replacement API was frozen |

## MolyBot

| Operation | Status | Authority |
| --- | --- | --- |
| Ask a question | MISSING_SPECIFICATION | Business Master §20 and B10I §14 define the functional limit (authorized data, no invented causes). No request schema was extracted |
| Tool execution | PROPOSED | Allow-listed server functions only. No SQL tool |

## Notifications

| Operation | Status | Authority |
| --- | --- | --- |
| Register FCM device | PROPOSED | Stack brief. No payload in the extracts read |
| Notification preference | MISSING_SPECIFICATION | Not found in the M0 extracts |

## Platform

| Operation | Status | Authority |
| --- | --- | --- |
| `GET /platform/health` | EXISTING_WORKING | Tested 2026-10-10. Returns `{module: platform, status: ok}` |
| Intelligence `GET /health` | EXISTING_UNVERIFIED in this audit | Code exists. Not executed over HTTP during M0 |

## Common response rules already stated by F9

F9 section F10.2.9 calls for a common response envelope. F9H-01 says nested read-model schemas are incomplete. Implementations wait for those schemas rather than inventing `data` wrappers in OpenAPI ahead of F9 §13.

Idempotency and error states (conflict, rate limit, derived refresh pending) are required by F9 F10.3 and D10, even where the success body is still blocked.
