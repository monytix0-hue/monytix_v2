# M0 Test Traceability

The F10 workbook is an acceptance catalogue. It is not evidence that those cases pass. On 2026-10-10 the only executed tests were stub suites: API 13 passed, intelligence 15 passed. They assert `status: stub` or health `ok`.

**SOURCE_REQUIREMENT (workbook `00_Summary`):** 50 end-to-end scenarios, 32 marked READY, 18 marked BLOCKED, 30 decision rows, 9 current blockers. Source of truth printed on that sheet is F0–F9, which conflicts with the later F10A–F10L freeze (CF-02). Where a workbook assertion depends on Journey or M-Points, the case stays blocked pending CF-02 even if the sheet says READY.

## Workbook map

| Sheet | What it holds | Phase |
| --- | --- | --- |
| `00_Summary` | Counts and pass standard | All gates |
| `01_Master_E2E_Scenarios` | F10-E2E-001 onward. 50 scenarios | M2–M8 as relevant |
| `02_D1_D30_Decision_Coverage` | One positive trigger and one guard per personal decision | M5 |
| `03_Transaction_Edge_Cases` | EDGE-01 onward. Duplicate, failed, transfer, refund, sweep, salary | M2–M4 |
| `04_Historical_Onboarding` | HIST-01 onward. `occurred_at` versus import time | M2, M4, M5 |
| `05_Journey_Rewards_Assertions` | JR-01 onward | Blocked by CF-02 |
| `06_API_Event_UI_Trace` | TRACE-01 onward | M2, M5, M8 |
| `07_Negative_Resilience_Tests` | NEG-01 onward | M1–M5 |
| `08_Test_Data_Pack` | Synthetic USER-A through missions. Not production data | Fixtures in M2+ |
| `09_Exit_Criteria` | EXIT-01 onward | Release gate |
| `10_Open_Issues_Blocked_Tests` | F9H-01 through F9H-09 | Blocks named phases |

D10 Table 23 DB01–DB38 is a second, database-level pack. It is required in addition to the workbook. B10Q T001–T009 is required for business. Neither pack was executed.

## Scenario phase assignment

| Cases | Intent | Phase | Gate |
| --- | --- | --- | --- |
| HIST-01, TRACE-09, E2E-001 historical import | Evidence retained, no fake acceptance | M2, M4 | Transaction correctness, parsing |
| EDGE-01, NEG-01, DB01, DB02 | Duplicate ingestion | M2 | Transaction correctness |
| EDGE-02, EDGE-03, EDGE-04 | Failed, verification debit, ATM unknown | M2, M3 | Do not invent meaning |
| EDGE-06, EDGE-08, EDGE-09, DB13 | Internal transfer and auto-sweep | M3 | No double counting |
| EDGE-07, NEG-09, DB14 | Refund link | M3 | Event correctness |
| EDGE-11, E2E-004 | Salary and D15 | M3, M5 | Classification and decision |
| EDGE-05, NEG-10 | Unknown P2P | M3 | No relationship inference |
| DB12, E2E-006 | Card bill versus purchases, D3 | M3, M5 | No double counting |
| E2E-005, TXN-EMI | EMI and D4 | M3, M5 | Event and decision |
| Sheet 02 D1–D30 | Decision coverage | M5 | Decision correctness |
| E2E-002 manual purchase, TRACE-01 | Canonical write then derived refresh | M2, M4, M8 | API reliability, UI state |
| TRACE-08, F9H-04 | Category correction | Blocked | Do not test a guessed API |
| TRACE-07, F9H-03 | Mission contribution | Blocked | Same |
| Sheet 05, EXIT-07, F9H-05 | Rewards | Blocked by CF-02 and F9H-05 | Not a release claim |
| NEG-06 | Reject weight code FUTURE | M4 | W1–W10 only |
| NEG-03, NEG-04 | Downstream outage after commit | M5 | Canonical write survives |
| DB26, T008 | Cross-owner read denied | M1, M6 | User isolation |
| B10Q v1.3 Table 11 | Business safety | M6 | Business financial safety |
| F9I high gaps | Dynamic copy | M8 | Dynamic UI content |
| MolyBot cross-owner | Not in the workbook as a row | M7 | MolyBot data isolation. Must be added as a test, not assumed from F10 |

## Release gates

A gate passes only with the evidence in the right column. Unit tests of pure functions are necessary and not sufficient.

| Gate | Pass condition | Minimum evidence |
| --- | --- | --- |
| Transaction correctness | One economic id, positive amount, separate direction, no duplicate on re-import, repeated micro-transactions without a strong id stay distinct | D10 DB01, DB02, DB05, DB29 against PostgreSQL with RLS on |
| Parsing correctness | v4 channels and error codes. Partial parse does not become READY | Fixture pack executed in CI. Quality counts match expected reasons |
| Classification correctness | F10D precedence and business safety boundary | Golden narrations, including salary, EMI, card payment, insurance, investment, refund, sweep |
| Financial event correctness | Components only when the source splits them. Corrections do not mutate source or original family | DB14, DB15 |
| User isolation | Actor A cannot read owner B source, transaction, weight, decision, or business visibility rows | DB26 and B10Q T008 or the mapped equivalent |
| Financial state computation | Signals use F10G statuses. Missing coverage is not zero and not "unpaid" | DB16 plus F10G cases for gap and single-month income |
| Decision correctness | Personal D1–D30 guards and business Table 11. Eligibility before mission boost | Sheet 02 plus business scenarios. Blocked F9H commands excluded |
| Business financial safety | Mission does not create a decision. Unsafe liquidity suppresses growth | Table 11 executed |
| Dynamic UI content | Each shipped number binds to an F9I computed field or a declared constant | Contract test. Screenshot of sample Figma text is not a pass |
| MolyBot data isolation | Context contains one owner. No SQL tool. Refusal or empty when data is absent | Adversarial prompts in a test tenant pair |
| API reliability | Idempotent POST, derived-pending when recompute fails, conflict on key reuse | NEG-01, NEG-03, F9 F10.3 |
| Mobile integration | Native app performs the certified flows on device or emulator against the real API | M8 script. Not the current Compose "Monytix" render |

## Exit criteria that cannot be claimed

Workbook EXIT-01 through EXIT-12 are not met. In particular:

- EXIT-05 mission contribution is open (F9H-03).
- EXIT-06 category correction is open (F9H-04).
- EXIT-07 rewards authority is open (F9H-05) and conflicts with D10.
- EXIT-08 decision command set is open (F9H-02).

D10 AC-001 through the freeze criteria in Table 24 are not met by `0001_init.sql`.

## How a future run should be recorded

Each gate needs the command, the database migration id, the policy version, the fixture ids, and the pass count. A stub test run does not move any gate to pass.
