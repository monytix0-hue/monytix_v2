# M3.1 financial-event test matrix

Date: 2026-10-11. Database: local PostgreSQL 17 in `monytixv2-postgres-1`.

`services/api/tests/financial-event.integration.test.ts` ran as `monytix_api` against `127.0.0.1:5432/monytix`. One test, pass, about 409 ms. The API package typecheck passed. Historical logical ids on account `01a12b2d-3324-71e2-8fbd-4faf2ec90b2a` were unchanged.

| Id | Case | Result | Evidence |
| --- | --- | --- | --- |
| T01 | Merchant debit, direction `OUT` | Pass | `UNKNOWN`. No expense family was stored. Canonical money columns unchanged |
| T02 | Interest phrase, direction `IN` | Pass | `RESOLVED` `INCOME` by `INC_040` |
| T02 salary | Salary keyword, direction `IN` | Pass | `UNKNOWN`. The keyword is not mounted |
| T03 | Self-transfer wording | Pass | `UNKNOWN`. Not `INTERNAL_TRANSFER` |
| T04 | Explicit credit-card phrase | Pass | `RESOLVED` `CREDIT_CARD_PAYMENT` by `CC_001` |
| T05 | EMI token | Pass | `RESOLVED` `LOAN_REPAYMENT` by `EMI_001` |
| T06 | Loan-disbursement wording, direction `IN` | Pass | `UNKNOWN`. No seeded rule emits `BORROWING` |
| T07 | Refund wording | Pass | Wording alone is `UNKNOWN`. Wording plus `reversal_indicator` is `RESOLVED` `REFUND_REVERSAL` by `INC_050` |
| T08 | ATM | Pass | The word atm is `UNKNOWN`. Parser channel `ATM` is `RESOLVED` `CASH_MOVEMENT` by `CASH_001` |
| T09 | Unrecognised narration | Pass | `UNKNOWN` |
| T10 | EMI and credit-card phrases together | Pass | `AMBIGUOUS` at `P1`. Family and rule are null |
| T11 | No description and no linked evidence | Pass | `UNKNOWN` |
| T12 | Same canonical version and rulebook version | Pass | Outcome `replay`. One resolution row |
| T13 | Second rulebook version | Pass | A per-run test version inserted a new row. The `F10D-v1.2` row stayed `LOAN_REPAYMENT` / `EMI_001` |
| T14 | History | Pass | Both rows remain. They share the same canonical version. Only the new row is current |
| T15 | Canonical columns | Pass | Amount, date, direction, currency, account, and description were unchanged |
| T16 | Evidence ids | Pass | The same-owner source record id is stored on the resolution |
| T17 | Manual canonical input | Pass | `ops.create_manual_transaction` then interpretation resolved `LOAN_REPAYMENT` |
| T18 | Statement canonical input | Pass | `parse_narration_v4` output was mapped, then `ops.interpret_extraction_run` resolved `CASH_MOVEMENT` |
| T19 | Other actor or other owner | Pass | Outcome `forbidden`. No extra resolution row |
| T20 | EMI evidence on another owner's source record | Pass | `UNKNOWN`. That source id is not in `evidence_references` |
| T21 | Business owner | Pass | Outcome `business_isolated`. No resolution row |
| T22 | Two concurrent workers | Pass | Outcomes `created` and `replay`. One resolution row and one outbox row |
| T23 | Rollback | Pass | `BEGIN`, interpret, `ROLLBACK` left no resolution and no outbox row |
| T24 | Outbox | Pass | One `FINANCIAL_EVENT_INTERPRETED` row. Replay did not add another. Rollback left zero |
| T25 | Competing tables | Pass | `txn_fact`, `txn_parsed`, `txn_parse_stage`, `txn_enriched`, and `txn_rulebook_output` are absent |

Security checks in the same test: `monytix_api` can execute the writer and cannot insert `intel.financial_event_resolution`. `monytix_intelligence` cannot execute the writer. The function body does not update `core.canonical_transaction_version` and does not insert `core.logical_transaction`. A direct insert by `monytix_api` failed.

Seeded product rules are `CASH_001`, `CC_001`, `EMI_001`, `EMI_002`, `INC_040`, and `INC_050`. `EXPENSE`, `TRF_999`, `INC_999`, and `TRF_001` are not seeded. Each run inserts its own test rulebook version to prove history. That version is not a product rule.
