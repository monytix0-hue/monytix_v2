# M3.7 integration test matrix

Date: 2026-10-11. Database: local PostgreSQL 17 in `monytixv2-postgres-1`. Role: `monytix_api`.

`services/api/tests/intelligence-pipeline.integration.test.ts` passed in about 549 ms. No product code was changed after the run.

| Case | Result | What ran |
| --- | --- | --- |
| T01 Manual transaction | Pass | `ops.create_manual_transaction` then the four intelligence calls. User category `FOOD_DINING` was not stored as an F10E category. Event `UNKNOWN` |
| T02 Statement-imported transaction | Pass | `ops.map_statement_extraction` returned `mapped`, then the four run functions the worker calls. One logical transaction |
| T03 UPI structure, unknown VPA | Pass | Rail `UPI`, status `PARTIAL`, role `UNKNOWN_VPA`, party `UNKNOWN`, `entity_id` null, relationship `UNKNOWN`. Outbox text did not contain the handle |
| T04 EMI | Pass | Family `LOAN_REPAYMENT`. Category `NOT_APPLICABLE`. Category code null |
| T05 Credit-card repayment | Pass | Family `CREDIT_CARD_PAYMENT`. Category `NOT_APPLICABLE`. Category code null |
| T06 Interest income | Pass | Family `INCOME`. Category code null |
| T07 Cash movement | Pass | Family `CASH_MOVEMENT`. Rail `CASH`. Category `UNKNOWN`. Category code null |
| T08 Refund without an original | Pass | Family `REFUND_REVERSAL` with the reversal flag. Category `UNKNOWN`. Category code null |
| T09 Conflicting direction | Pass | Structure `CONFLICT`, reason `DIRECTION_MARKER_CONFLICT`. Canonical direction stayed `OUT` |
| T10 Multiple party observations | Pass | Two same-owner VPAs. Party `AMBIGUOUS`. `entity_id` null |
| T11 UNKNOWN event | Pass | Outcome `UNKNOWN`. Category `UNKNOWN` |
| T12 AMBIGUOUS event | Pass | EMI and credit-card phrases together. Outcome `AMBIGUOUS`. Family null. Category code null |
| T13 Same-version replay | Pass | Manual idempotency replay. Second pipeline call left one structure and one event |
| T14 New parser version | Executed as a boundary | Stored parser version is `v4`. The only narration function is `parse_narration_v4`. A second parser was not applied |
| T15 New F10B version | Pass | Second structure row. First row remains and is not current |
| T16 New F10C version | Pass | Second party row. First status unchanged |
| T17 New F10D rulebook version | Pass | Second event row. First family unchanged |
| T18 New F10E taxonomy version | Pass | Second category row. First status and null category code unchanged |
| T19 Cross-owner rejection | Pass | Another actor is `forbidden`. That owner's VPA produced no observation |
| T20 Business isolation | Pass | All four writers returned `business_isolated`. No event row |
| T21 Concurrent processing | Pass | Two callers left one structure and one event |
| T22 Atomic rollback | Pass | Rollback left no structure row |
| T23 Canonical immutability | Pass | Direction unchanged. `txn_fact`, `txn_parsed`, `txn_enriched`, `txn_categorized`, and `financial_entity` are absent. Historical account `01a12b2d-3324-71e2-8fbd-4faf2ec90b2a` was unchanged |
| T24 Historical interpretation | Pass | Prior F10B status, F10C status, F10D family, and F10E category stayed on the old rows |
| T25 No unsupported merchant category | Pass | Unknown narration and the new taxonomy row both kept a null category code. No `MERCHANT_PURCHASE` |

Object-storage upload and ClamAV were not part of this run. T02 starts at mapping, which is the worker's handoff into the intelligence calls.
