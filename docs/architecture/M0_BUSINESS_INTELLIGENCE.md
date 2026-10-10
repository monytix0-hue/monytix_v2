# M0 Business Intelligence

Business logic stays on the B10 lineage. It is not a copy of personal D1–D30 or W1–W10.

Labels: **SOURCE_REQUIREMENT**, **ARCHITECTURAL_PROPOSAL**, **OPEN_DECISION**.

Binding sources:

- Business Master Functional Architecture v1.0
- B10A v1.1, B10B v1.1, B10B.1, B10C v1.1, B10D v1.1, B10E v1.1 where a v1.1 file exists beside an unversioned sibling
- B10F, B10F1, B10G, B10H, B10I v1.0, B10J v1.0, B10K v1.0, B10L v1.0, B10M v1.0 regenerated, B10N v1.0 redesigned, B10O v1.0, B10P v1.0
- B10Q v1.1 SQL (V001–V030) and B10Q v1.3 document (V031–V040). Not the colliding v1.2 filenames (CF-09)
- Two-Source Decision Framework v1.0 and B10Q v1.3 presentation rules

Repository `app/business_fio/fio.py` is a stub. It is not B10J.

**OPEN_DECISION CF-01:** B10Q schemas are real and frozen. They must not be loaded beside a second canonical amount. The stage cards below name the B10 owner. Physical placement waits on the core-spine mapping.

## Safety gate

**SOURCE_REQUIREMENT (B10Q v1.3 §1, §11, Table 1, Table 6):**

Financial eligibility is evaluated before mission promotion. Mission association never creates a decision. A mission may raise relevance only after eligibility and safety checks pass. A severe liquidity or survival condition can suppress a growth decision even when a growth mission is active. Suppressed decisions stay auditable and are not executable. The UI and MolyBot do not recompute eligibility.

**SOURCE_REQUIREMENT (Business Master safety boundary):** UPI, NEFT, RTGS, or IMPS credit is not revenue. A debit is not an expense. A cash deposit is not revenue. A loan disbursement is not revenue. SELF or sweep movement is neither income nor cost.

## Stage cards

### B10A — source ingestion

| | |
| --- | --- |
| INPUTS | Business bank feeds, uploads, and other source connections owned by the same evidence rules as D10 `source_document` once CF-01 is mapped |
| OUTPUTS | Immutable acquisition batch and document pointer |
| DATA AUTHORITY | B10Q `ingest` until mapped; bytes in object storage (D10 §19) |
| DECISION RULES | Store what arrived. Do not classify in the ingest transaction |
| RECOMPUTATION | New batch. Duplicate provider id is idempotent |
| FAILURE STATES | Rejected file, unsupported layout, hash mismatch. The failure is a batch status, not a zero-revenue statement |
| TEST COVERAGE | B10Q tests exist inside the v1.1 pack (`T001`–`T009`) and were not executed |

### B10B / B10B.1 — parsing and narration

| | |
| --- | --- |
| INPUTS | Raw narration and channel |
| OUTPUTS | NAR01–NAR50 family candidate, tokens, parse evidence (B10Q v1.3 V031–V036) |
| DATA AUTHORITY | B10B.1 registries and interpretation tables |
| DECISION RULES | Parser hierarchy and confidence from B10B. A low-confidence line stays a candidate |
| RECOMPUTATION | New interpretation version. Supersession helper in V036 |
| FAILURE STATES | Unknown shape, truncated narration, conflicting candidates |
| TEST COVERAGE | Not ported into repository tests |

### B10C — normalization

| | |
| --- | --- |
| INPUTS | Parse candidates and account context |
| OUTPUTS | Normalized amount, direction, value date, currency |
| DATA AUTHORITY | B10Q `normalize`, required to point at one logical event after CF-01 |
| DECISION RULES | Positive amount and explicit direction, consistent with D10 Table 9, unless a mapped B10 column proves a different frozen type |
| RECOMPUTATION | New normalize version |
| FAILURE STATES | Unresolved account or currency. Not ready for canonical use |
| TEST COVERAGE | Not executed |

### B10D — canonical financial event

| | |
| --- | --- |
| INPUTS | Normalized observation |
| OUTPUTS | One canonical business financial event |
| DATA AUTHORITY | B10Q `canonical` |
| DECISION RULES | One economic identity. Re-import links evidence. It does not clone the event when identity matches |
| RECOMPUTATION | Version append |
| FAILURE STATES | Ambiguous match left unresolved rather than merged on weak similarity |
| TEST COVERAGE | Not executed. Personal D10 DB05 (do not collapse repeated micro amounts) is the related personal rule and should be honored for business identity too |

### B10E — party

| | |
| --- | --- |
| INPUTS | Narration parties, registry, owner corrections |
| OUTPUTS | Resolved party and role. Legal entity is not a counterparty by default (OQ-10) |
| DATA AUTHORITY | B10Q `party` |
| DECISION RULES | Global reference identity holds no owner-private observation (D10 FD-07) |
| RECOMPUTATION | New resolution on correction |
| FAILURE STATES | Unresolved party. Downstream must not invent a customer or vendor |
| TEST COVERAGE | Not executed |

### B10F / B10F1 — category and purpose

| | |
| --- | --- |
| INPUTS | Canonical event and party |
| OUTPUTS | Business domain, purpose, category, subcategory |
| DATA AUTHORITY | B10Q `classify` |
| DECISION RULES | Safety boundary above. Purpose does not rewrite event economics |
| RECOMPUTATION | New classification version and policy id |
| FAILURE STATES | Unclassified. Not a default expense or revenue |
| TEST COVERAGE | Not executed |

### B10G — semantic enrichment and safety

| | |
| --- | --- |
| INPUTS | Classification and confidence |
| OUTPUTS | Semantic tags that passed safety rules |
| DATA AUTHORITY | B10Q `semantic` |
| DECISION RULES | Business Master: do not invent unsupported semantics. Explainability required |
| RECOMPUTATION | New semantic version |
| FAILURE STATES | Conflict or insufficient support leaves the tag off |
| TEST COVERAGE | Not executed |

### B10H — patterns and profiles

| | |
| --- | --- |
| INPUTS | Eligible semantic facts over a window |
| OUTPUTS | Patterns and analytical profiles |
| DATA AUTHORITY | B10Q `pattern` |
| DECISION RULES | A pattern is not a decision and not a weight |
| RECOMPUTATION | Windowed rebuild from facts |
| FAILURE STATES | Thin history stays unprofiled |
| TEST COVERAGE | Not executed |

### B10I — four business weights

**SOURCE_REQUIREMENT (B10I Table):**

| Code | Name | Direction |
| --- | --- | --- |
| BW01 | Obligation Pressure | Higher means greater commitment pressure. Not a synonym for expenses |
| BW02 | Risk Pressure | Higher means greater downside. Not a generic badness score |
| BW03 | Protection Adequacy | Higher means stronger adequacy against a stated basis. A reserve account alone is not adequacy |
| BW04 | Dependency Pressure | Higher means greater reliance. Concentration is an input, not the whole definition |

| | |
| --- | --- |
| INPUTS | Eligible facts, semantics, patterns. Comparable currency only |
| OUTPUTS | Weight evidence ledger and current four-weight profile with trend, level, confidence |
| DATA AUTHORITY | B10Q `weight` |
| DECISION RULES | The four weights are independent. They do not sum to 100. Internal 0–100 is not M.I.L.E., mission progress, or health |
| RECOMPUTATION | Economic effective time, not ingestion time. New snapshot supersedes |
| FAILURE STATES | Incomparable currencies are not summed. Insufficient evidence does not become a high pressure reading |
| TEST COVERAGE | B10I production test matrix is in the source document and was not executed |

MolyBot may explain BW drivers from the WI10 explanation structure only (B10I §14). It must not invent a cause.

### B10J — financial intelligence objects and derived state

| | |
| --- | --- |
| INPUTS | Weight snapshots, FIOs, patterns |
| OUTPUTS | Derived states named in B10I handoff: Liquidity, Flexibility, Resilience, Capacity, Exposure, and related states in B10J. Business Health, Operator, and Climate are downstream presentations in the Business Master §11 |
| DATA AUTHORITY | B10Q `state` |
| DECISION RULES | States consume weight truth. They do not replace it |
| RECOMPUTATION | New state version when inputs change |
| FAILURE STATES | Missing weight snapshot yields an unassessed state, not a failing health score |
| TEST COVERAGE | Not executed |

The word Resilience here is a business derived state. It is not personal W9.

### B10K — eighteen decisions

**SOURCE_REQUIREMENT (B10Q v1.3 Table 8):**

| ID | Name | Mission affinity in the v1.3 extract |
| --- | --- | --- |
| D01 | Allocate Available Surplus To Reserve | BM01, BM04 |
| D02 | Accelerate Reserve Growth | BM01 |
| D03 | Protect Cash Position | BM02 primary; BM01 prerequisite |
| D04 | Retain Cash Position | BM02, BM04 |
| D05 | Review Expense Growth | BM03 |
| D06 | Reduce Vendor Spend | BM03 primary; BM05 support |
| D07 | Optimize Software Spend | BM03 |
| D08 | Control Operational Leakage | BM03 primary; BM02 support |
| D09 | Reserve vs Growth Allocation | BM04 primary; BM01/BM06 support |
| D10 | Allocate Growth Budget | BM06, BM04 |
| D11 | Split Allocation Strategy | BM04 primary; BM01/BM06 support |
| D12 | Delay Allocation | BM04, BM02 |
| D13 | Increase Reserve Coverage | BM01 |
| D14 | Review Customer Concentration | BM05 |
| D15 | Review Vendor Concentration | BM05 |
| D16 | Improve Operational Efficiency | BM03 primary; BM06 support |
| D17 | Strengthen Business Stability | BM06 primary; BM02/BM05 support |
| D18 | Prepare For Growth | BM06 primary; BM04 support |

These codes are business codes. Personal D10 is Expense Spike Review. Do not join them (CF-06).

| | |
| --- | --- |
| INPUTS | B10J evidence, four weights, derived states, health and climate, patterns, mission context |
| OUTPUTS | `decision.eligibility_result` and `decision.decision_visibility_evaluation` |
| DATA AUTHORITY | B10Q `decision` |
| DECISION RULES | Stage A financial condition, stage B mission context, stage C conflict and safety, stage D presentation (B10Q v1.3 Table 5). States: REQUIRED, MISSION_RELEVANT, AVAILABLE, SUPPRESSED (Table 7). Example: growth mission with weak liquidity suppresses business D10 and may require D03 (Table 11) |
| RECOMPUTATION | `decision.supersede_visibility_evaluation` creates a new version and closes the current row. Jobs J-K2 / J-O2 |
| FAILURE STATES | SUPPRESSED with reason codes. Low confidence cannot create a mandatory sequence |
| TEST COVERAGE | v1.3 §12 test contract. Not executed |

### B10L — missions and actions

| | |
| --- | --- |
| INPUTS | User-selected mission family, targets, decision affinity |
| OUTPUTS | Mission instance, `mission.mission_decision_priority` (P0–P5 is contextual priority, not a universal D01–D18 rank) |
| DATA AUTHORITY | B10Q `mission` |
| DECISION RULES | Mission remains visible even when a conflicting decision pauses execution (v1.3 §11). Actions cannot bypass B10K suppressors |
| RECOMPUTATION | Mission change triggers J-K2 |
| FAILURE STATES | Mission without a financially valid decision does not fabricate one (Table 11 last row) |
| TEST COVERAGE | Not executed. Business Master §15 holds the mission and sub-mission registry. This audit did not copy every M01–M34 row |

BM01–BM06 appear in the v1.3 affinity extract as the mission families used for ranking. Detailed sequencing stays in B10L.

### B10M — outcomes and impact

| | |
| --- | --- |
| INPUTS | Executed action and later financial evidence |
| OUTPUTS | Verified outcome. Success requires evidence of an actual state change (product mechanism notes in the Business Master extract) |
| DATA AUTHORITY | B10Q `outcome` |
| DECISION RULES | Recommendation acceptance is not an outcome |
| RECOMPUTATION | New outcome version when evidence arrives |
| FAILURE STATES | Unverified intent stays unearned |
| TEST COVERAGE | Not executed |

### B10N — M.I.L.E.

| | |
| --- | --- |
| INPUTS | Verified outcome |
| OUTPUTS | Business M.I.L.E. ledger |
| DATA AUTHORITY | B10Q `mile` |
| DECISION RULES | v1.1 tests include ledger immutability (`T004`, `T006`). Corrections follow the personal principle of adjustment rather than silent rewrite unless B10N states a different frozen mechanism. B10N is marked REDESIGNED and must be read before implementation chooses the adjustment shape |
| RECOMPUTATION | Append |
| FAILURE STATES | Missing verification does not mint distance |
| TEST COVERAGE | SQL tests in the pack. Not executed |

### B10O — projections

| | |
| --- | --- |
| INPUTS | Current visibility, mission relevance, capacity constraints |
| OUTPUTS | `projection.vw_decision_presentation_queue` ordered REQUIRED, then MISSION_RELEVANT, then AVAILABLE. SUPPRESSED excluded |
| DATA AUTHORITY | B10Q `projection` |
| DECISION RULES | Projection does not decide. v1.1 V027 covers dedup and capacity. T005 and T009 are the pack checks |
| RECOMPUTATION | J-O2 on `DECISION_VISIBILITY_UPDATED` |
| FAILURE STATES | Stale projection is labeled stale. It is not a second eligibility result |
| TEST COVERAGE | Not executed |

### B10P — jobs and end-to-end reconciliation

| | |
| --- | --- |
| INPUTS | Stage watermarks |
| OUTPUTS | Job ledger and reconciliation status |
| DATA AUTHORITY | B10Q `platform` |
| DECISION RULES | Formulas stay in services. SQL persists orchestration (V001 header comment) |
| RECOMPUTATION | Idempotent jobs |
| FAILURE STATES | `QUARANTINED` execution status exists in V001 enums |
| TEST COVERAGE | T001 smoke and later T-tests. Not executed |

## Eligibility examples that must survive implementation

From B10Q v1.3 Table 11:

| Situation | Required result |
| --- | --- |
| Growth mission, liquidity unsafe | Business D10 suppressed. D03 may be REQUIRED |
| Reserve gap and reserve mission | D13 REQUIRED or MISSION_RELEVANT by urgency |
| Software improvable but not critical, BM03 active | D07 MISSION_RELEVANT, not framed as urgent |
| Customer concentration, no mission | D14 from financial materiality alone |
| Mission active, decision not financially valid | Do not fabricate eligibility |

## Test coverage statement

Business SQL tests T001–T009 were inspected as files inside the v1.1 pack. They were not executed against a database. No repository pytest covers a business decision. Coverage of the B10 chain in this repository is **MISSING**.
