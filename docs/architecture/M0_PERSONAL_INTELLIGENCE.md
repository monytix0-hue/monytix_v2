# M0 Personal Intelligence

Scope is the frozen personal chain. Repository modules under `services/intelligence/app/` are stubs. Pytest on 2026-10-10 proved only that they return `status == "stub"`. They are not these engines.

Labels: **SOURCE_REQUIREMENT**, **ARCHITECTURAL_PROPOSAL**, **OPEN_DECISION**.

Binding sources:

- Personal Master Functional Specification v1.0 (October 2026), sections 1–21
- F10A v1.3, F10B v2.0, F10C–F10L v1.2, each marked FINAL FREEZE in the personal bundle
- D10 v1.2 FINAL FREEZE for storage
- F10K for Live as a read model
- F9 / F9I for UI consumption
- Habits zip only as a conflicting reference (CF-08)

F10-0 is the legacy reconciliation note. It does not override a later FINAL FREEZE.

## Pipeline

```
F10A evidence of fact
  → F10B structure
  → F10C party
  → F10D event
  → F10E category and purpose
  → F10F semantic eligibility
  → F10G evidence and signals
  → F10H ten weights
  → F10J quiz / profile reconciliation
  → F10I decisions, missions, outcomes, M.I.L.E.
  → F10K Live projection
```

**SOURCE_REQUIREMENT (Personal Master §1):** Monytix Personal is a financial decision system. A feed of movements is not the product.

**SOURCE_REQUIREMENT (F10I):** activity does not earn M.I.L.E. One economic event mints one outcome even when several attribution paths exist.

## Evidence states that must not be collapsed

These are different predicates. Missing data is not a negative finding.

| Term | Where it is defined | Meaning |
| --- | --- | --- |
| `UNKNOWN` / `AMBIGUOUS` | F10D, F10F | Event or semantic dimension is not established. Valid output |
| `NOT_APPLICABLE` | F10F, F10G | The dimension does not apply. Not a quality defect |
| `INSUFFICIENT_EVIDENCE` | F10H AC-03 area in the weights extract | Not enough eligible evidence to assess a weight |
| `INSUFFICIENT_DATA` | F10G `signal_status` | Signal formula cannot be computed. Not a low result |
| `LIMITED` | F10G signal status and F10F eligibility | Usable only inside stated limitations |
| `OBSERVED` | F10G | Signal computed from sufficient eligible facts |
| `ABSENCE_NOT_PROVABLE` | F10G limitation | Coverage cannot prove that something did not happen |
| IGNORE / OBSERVE / WEIGHT / PROMOTE | F10 xlsx F2 column | Older test vocabulary. Do not treat as F10G status until CF-02 is closed |

**SOURCE_REQUIREMENT (F10G):** a coverage gap does not mean zero spend, and a due date overlapped by a gap does not mean unpaid. Do not divide by zero. A missing currency threshold does not borrow another currency's micro-spend rule.

**SOURCE_REQUIREMENT (F10H):** do not add the ten weights into one financial score. Do not infer values, religion, politics, personality, anxiety, or relationship type from a merchant. Risk appetite is not inferred from spending. Needs/Wants labels are retired as a weight ontology.

## Ten weights

**SOURCE_REQUIREMENT (F10H):** exactly W1–W10.

| Code | Name | Question the weight is allowed to represent |
| --- | --- | --- |
| W1 | Time | Timing and when money is needed |
| W2 | Comfort | Everyday flexibility. Not happiness or moral judgment |
| W3 | Risk | Exposure to loss. Not undeclared risk appetite |
| W4 | Obligations | Commitments already owed. NACH alone is not proof |
| W5 | Identity | Declared priorities. Not personality from a merchant |
| W6 | Relationships | Declared dependants and shared duties. Not inferred from a payee name |
| W7 | Opportunity | Room to act. Not an investment recommendation |
| W8 | Attention | Need for active management. Not a mental-state label |
| W9 | Resilience | Capacity to absorb a shock. Not a guarantee of safety |
| W10 | Legacy | Declared long horizon. Not an age assumption |

User priority (`LOW` / `MEDIUM` / `HIGH` / `CRITICAL` on `context.weight_user_priority`) is not the same field as financial strength (D10 AC-021, Personal Master §11).

## Quiz and profile

**SOURCE_REQUIREMENT (Personal Master §11, F10J, D10 AC-020):** the onboarding quiz is an immutable hypothesis (`context.onboarding_quiz_profile`). The current profile is a separate snapshot of exactly ten assessments (`context.current_weight_profile_snapshot`). Quiz decay and source families S1–S5 are versioned policy (D10 Table 15). Historical quiz rows stay after evidence supersedes their relevance (D10 DB18). Expired context does not remain current by silence (DB19).

## Decisions, missions, outcomes, M.I.L.E.

**SOURCE_REQUIREMENT (F10I AC-02, AC-03, AC-04):**

- Decision families D1–D30 only. A child decision stays anchored to one family.
- Mission families M01–M48, or an explicit custom-extension contract.
- M.I.L.E. families: MP, MS (Money Saved), DR, WB, GF, FC. Six ledgers (Personal Master §16).

Names for D1–D24 were checked against F10I and workbook sheet 02 and they match. Primary weights do not always match. See CF-21. F10I is the functional authority for weight lineage until that conflict is closed.

| ID | Name | ID | Name |
| --- | --- | --- | --- |
| D1 | Emergency Fund Allocation | D16 | Bonus Allocation |
| D2 | Cash Buffer Top-Up | D17 | Emergency Fund Milestone Push |
| D3 | Credit Card Payment | D18 | SIP Continuity |
| D4 | Loan EMI Protection | D19 | Idle Cash to SIP |
| D5 | Insurance Renewal | D20 | Asset Drift Rebalance |
| D6 | Insurance Coverage Gap | D21 | Retirement Funding Gap |
| D7 | Idle Cash Deployment | D22 | Goal-Linked Investing |
| D8 | Income Surplus Allocation | D23 | Dining Optimization |
| D9 | Recurring Review | D24 | Shopping Control |
| D10 | Expense Spike Review | D25 | Entertainment reduction orbit (mission M27 cites D25) |
| D11 | Large Expense Warning | D26 | Travel spending orbit (mission M28 cites D26) |
| D12 | Cash Crunch Forecast | D27 | Discretionary reduction (mission M29 cites D27) |
| D13 | Savings Rate Lift | D28 | Mission acceleration overlay |
| D14 | Goal Contribution Catch-Up | D29 | Overlay (investment suitability path cited with D7, D18–D22) |
| D15 | Salary Day Allocation | D30 | Overlay |

D25–D27 names are taken from the mission orbit text in F10I (Reduce Entertainment Spend, Keep Travel Spending Under Control, Reduce Discretionary Spending) and from workbook USER-C "D23–D27". The precise D25–D30 display titles must be copied from F10I § decision catalogue at implementation time if a cell was truncated here. D28–D30 are overlays and must not manufacture a mission (F10I overlay rule).

**SOURCE_REQUIREMENT (Personal Master §13):** `FinancialEligible(D) = Trigger(D) AND EvidenceMinimum(D) AND NOT Suppressor(D)`. Mission reveal requires an active mission in the orbit, minimum evidence, permission, and no suppressor. Mission context changes relevance. It does not create financial truth. High weight alone is not sufficient (F10I).

**SOURCE_REQUIREMENT (F10I, D10 AC-024–AC-026):** outcome, rupee impact, and M.I.L.E. are separate ledgers. Finalized M.I.L.E. is corrected by `mile_adjustment_event`. One economic event does not create duplicate impact through multiple paths. A bonus split may create separate verified destination outcomes; the source decision does not book the impact again (F10I G08).

Products are downstream of a user choice (Personal Master §14). A no-product path remains valid.

## Memory, state, foresight

| Concern | Authority | Rule |
| --- | --- | --- |
| Memory of source facts | D10 `core` history and F10G baselines | Append-only. Live is not memory |
| Current state | D10 head / current pointers | Pointer and version commit together (FD-03) |
| Foresight | F10I decisions such as D11 and D12, which the workbook distinguishes from completed transactions | A projection is not a posted transaction and does not earn M.I.L.E. by itself |
| Live | F10K, D10 `experience.live_snapshot`, `live_item`, `live_reason_token` | Rebuildable. User actions write the owning domain, then Live refreshes (D10 Table 18) |
| Presentation copy | F9I | 313 dynamic values and 623 templates in the workbook summary. Do not hardcode figures. Missing value renders as unavailable, not zero |

Habits and nudges are not an F10G–F10K stage. D10 Table 19 retires MoneyMoments nudge runtime. See CF-08 before any habit score is stored.

## Engine cards

### F10A — intake and canonical normalization

| | |
| --- | --- |
| INPUTS | Account connection, file, API observation, email, or manual entry (D10 `source_connection` examples: AA, API, upload, email, manual) |
| OUTPUTS | Immutable `source_document`, `source_record`, `logical_transaction`, `canonical_transaction_version` |
| DATABASE AUTHORITY | D10 schema `core` |
| TRIGGER | New batch, manual post, or replay of an adapter |
| RECOMPUTATION | New canonical version. Logical id stable unless audited split/merge |
| DEPENDENCIES | Owner, account, instrument |
| TESTS | D10 DB01–DB09, DB29–DB30. Not executed |
| UI CONSUMERS | Import and transaction surfaces in F9. Workbook TRACE-01 and TRACE-09 |

### F10B — payment rail and identity

| | |
| --- | --- |
| INPUTS | Canonical narration and typed source fields |
| OUTPUTS | `transaction_structure`, identifiers, tokens |
| DATABASE AUTHORITY | D10 `intel` |
| TRIGGER | New canonical version |
| RECOMPUTATION | New structure version. Amount and direction are not rewritten by a parser change (D10 DB09) |
| DEPENDENCIES | F10A version id. Parser v4 algorithm after CF-03 |
| TESTS | Parser error-code list in the parsing reconciliation. Not executed |
| UI CONSUMERS | Transaction detail, redacted |

### F10C — counterparty

| | |
| --- | --- |
| INPUTS | Tokens, VPA, account, merchant text, owner corrections |
| OUTPUTS | `financial_entity` (global, non-private), owner-scoped alias and `transaction_party_resolution` |
| DATABASE AUTHORITY | D10 `intel` plus `ref` |
| TRIGGER | Structure version or user entity correction |
| RECOMPUTATION | New party resolution (D10 DB10) |
| DEPENDENCIES | F10B |
| TESTS | D10 DB37 isolation of owner aliases. Not executed |
| UI CONSUMERS | Counterparty labels. Raw VPA is not a Live field (D10 AC-032) |

### F10D — financial event

| | |
| --- | --- |
| INPUTS | Structure, parties, narration evidence |
| OUTPUTS | `financial_event_resolution`, components, relationships, corrections |
| DATABASE AUTHORITY | D10 `intel` |
| TRIGGER | Party version, correction, or policy version change |
| RECOMPUTATION | Scoped replay (D10 DB11, DB14) |
| DEPENDENCIES | F10B, F10C, `ref` event rules |
| TESTS | D10 DB12–DB15. F10D precedence cases. Not executed |
| UI CONSUMERS | Event meaning on transaction and decision context |

### F10E — category, subcategory, purpose

| | |
| --- | --- |
| INPUTS | Event resolution and taxonomy policy |
| OUTPUTS | Separate `category_resolution` and `purpose_resolution` |
| DATABASE AUTHORITY | D10 `intel` |
| TRIGGER | Event version or taxonomy correction |
| RECOMPUTATION | New taxonomy rows. Event family unchanged (D10 AC-015) |
| DEPENDENCIES | F10D, F10E registry |
| TESTS | Workbook category-correction path is BLOCKED (F9H-04) |
| UI CONSUMERS | Category displays. Purpose is not implied by category (F10F leakage rule) |

### F10F — semantics and eligibility

| | |
| --- | --- |
| INPUTS | F10A–F10E versions |
| OUTPUTS | `transaction_semantic_resolution`, exceptions, per-use eligibility |
| DATABASE AUTHORITY | D10 `intel` |
| TRIGGER | Any upstream version change |
| RECOMPUTATION | New semantic version. A strong resolution must not silently fall to UNKNOWN without the owning rule (D10 Table 16) |
| DEPENDENCIES | F10A–F10E |
| TESTS | F10F matrix: ledger totals can be eligible while category analytics is ineligible by design. Not executed |
| UI CONSUMERS | Limitation badges. Not a single percent as authority |

### F10G — evidence and signals

| | |
| --- | --- |
| INPUTS | Eligible semantic uses, coverage, FX policy |
| OUTPUTS | `evidence_fact`, aggregates, baselines, `signal_observation`, obligation matches |
| DATABASE AUTHORITY | D10 `evidence` |
| TRIGGER | Semantic version, coverage change, signal parameter version |
| RECOMPUTATION | Versioned replay watermarked by semantic version (D10 §19) |
| DEPENDENCIES | F10F eligibility. Coverage gaps block absence signals |
| TESTS | D10 DB16, DB17. Not executed |
| UI CONSUMERS | Only signals whose status is allowed for explanation |

### F10H — weights

| | |
| --- | --- |
| INPUTS | F10G signals, context facts, user priority |
| OUTPUTS | Contributions, per-weight assessments, ten-weight snapshot |
| DATABASE AUTHORITY | D10 `context` |
| TRIGGER | New eligible signals or context |
| RECOMPUTATION | New snapshot. Prior snapshot retained |
| DEPENDENCIES | F10G, F10H policy version |
| TESTS | F10H guardrails (no cross-weight sum, no identity from one merchant). Not executed |
| UI CONSUMERS | F9I `weight_summary[]` on `GET /v1/ui/live`. Render codes W1–W10, never a hardcoded Comfort×3 |

### F10J — reconciliation

| | |
| --- | --- |
| INPUTS | Quiz profile, S1–S5 observations, weight snapshots, conflicts |
| OUTPUTS | `weight_reconciliation_run`, `current_weight_profile_snapshot`, change events |
| DATABASE AUTHORITY | D10 `context` |
| TRIGGER | New snapshot, new declaration, expiry |
| RECOMPUTATION | New current pointer. Quiz row immutable |
| DEPENDENCIES | F10H, onboarding profile |
| TESTS | D10 DB18, DB19. Not executed |
| UI CONSUMERS | Current profile read model. Quiz answers are not silently rewritten |

### F10I — decisions, missions, outcomes, M.I.L.E.

| | |
| --- | --- |
| INPUTS | Current weight profile, evidence minimums, mission orbit, suppressors |
| OUTPUTS | `decision_evaluation`, `decision`, mission, measurement snapshot, outcome, impact, `mile_event`, adjustment, attribution |
| DATABASE AUTHORITY | D10 `action` |
| TRIGGER | Profile change, new evidence, user action, policy version |
| RECOMPUTATION | Idempotent evaluation (D10 DB20). Mission progress cannot exceed its measurement contract (DB21) |
| DEPENDENCIES | F10H/J, F10G. Eligibility before rank |
| TESTS | Workbook sheet 02 covers D1–D30 triggers on paper. 18 scenarios blocked. Not executed |
| UI CONSUMERS | `GET /v1/ui/decisions`, decision actions. Action set is incomplete (F9H-02) |

### F10K — Live, and foresight as projection

| | |
| --- | --- |
| INPUTS | Current heads and action state |
| OUTPUTS | `live_snapshot`, `live_item`, reason tokens |
| DATABASE AUTHORITY | D10 `experience` |
| TRIGGER | Outbox after domain commit, or rebuild |
| RECOMPUTATION | Drop and rebuild without losing domain truth (D10 DB24) |
| DEPENDENCIES | All upstream current pointers |
| TESTS | D10 DB25, DB27, DB38. Not executed |
| UI CONSUMERS | F9 83-screen state contract and F9I Live elements |

### Habits and nudges

| | |
| --- | --- |
| INPUTS | Not approved | 
| OUTPUTS | None in the personal freeze |
| DATABASE AUTHORITY | None. MoneyMoments tables are not runtime (D10 Table 19) |
| TRIGGER | Blocked by CF-08 |
| RECOMPUTATION | n/a |
| DEPENDENCIES | Product answer OQ-04 |
| TESTS | Habits SQL not run |
| UI CONSUMERS | Do not bind nudge copy until a contract exists that respects F10G insufficiency |

MolyBot, if later attached to personal data, may explain from reason tokens and weight explanations. It may not invent a cause, and it may not read another owner (B10I §14 states the same rule for business weights; personal Live tokens are the personal equivalent, D10 Table 11 tier 3).

## UI consumers (cross-cutting)

**SOURCE_REQUIREMENT (F9 §5, F9I summary):** 340 widgets represent 1,367 elements. Dynamic numbers come from API fields. F9I fallback is to show unavailable, never a fabricated 0.

Known Live bindings from F9I sheet 02, all `GET /v1/ui/live`:

- `summary.available_balance`
- `today_decisions[]`
- `weight_summary[]`
- `reflection_summary`
- `active_mission`
- `transactions_preview[]`

Those field names are source bindings. They are not a license to invent the rest of the payload. F9 §13 is the dictionary. F9H-01 says nested schemas are still incomplete.
