# M3.2 F10E test matrix

Date: 2026-10-11. Database: local PostgreSQL 17 in `monytixv2-postgres-1`.

`services/api/tests/f10e-taxonomy.integration.test.ts` ran as `monytix_api` against `127.0.0.1:5432/monytix`. One test, pass, about 313 ms. `services/api/tests/financial-event.integration.test.ts` passed again in the same run. `npx tsc -p tsconfig.json --noEmit` in `services/api` passed.

| Case | Contract | Result | Evidence |
| --- | --- | --- | --- |
| Section 7 registry | 20 category codes, no event names as categories | Pass | Count 20. `INCOME` and `EXPENSE` are absent |
| Subcategory codes | Section 9 examples are not stable codes | Pass | Zero subcategory rows |
| `MERCHANT_PURCHASE` | AC-06 | Pass as blocked | Constraint `MERCHANT_BLOCKED`. No category code is assigned |
| `INTERNAL_TRANSFER` | AC-08 | Pass as stored policy | Both behaviors `NOT_APPLICABLE`. No fabricated event row was classified |
| Use before an event exists | Section 2 | Pass | Outcome `ineligible`. No category row |
| `LOAN_REPAYMENT` | Section 8 | Pass | Category `NOT_APPLICABLE`. Purpose `UNKNOWN`. Family stays `LOAN_REPAYMENT` |
| Credit-card text that also mentions a restaurant | AC-07 | Pass | Event `CREDIT_CARD_PAYMENT`. Category and purpose `NOT_APPLICABLE`. Category code null |
| Interest income | Section 8 | Pass | Both `NOT_APPLICABLE`. Purpose code null. Family `INCOME` |
| ATM cash | AC-09 | Pass | Event `CASH_MOVEMENT`. Category `UNKNOWN`. No spend code |
| Refund with the reversal flag and no original link | Section 18 | Pass | Event `REFUND_REVERSAL`. Category `UNKNOWN` |
| Unrecognised merchant debit | AC-10 | Pass | Event `UNKNOWN`. Category `UNKNOWN`. Not `FOOD_DINING` |
| EMI and credit-card phrases together | AC-10 | Pass | Event `AMBIGUOUS`. Category `UNKNOWN` |
| Same event and taxonomy again | AC-51 | Pass | Outcome `replay`. One category row and one purpose row. Two outbox rows, not four |
| Second taxonomy version | Section 20 | Pass | New row is current. The first row stays `NOT_APPLICABLE` |
| New F10D resolution | AC-52 | Pass | New use row follows the new event. The first event stays `LOAN_REPAYMENT` and its category stays `NOT_APPLICABLE` |
| Two workers | Section 4 of the brief | Pass | Outcomes `created` and `replay`. One use pair |
| Rollback | Same transaction | Pass | No category row and no category outbox row |
| Other actor | Owner isolation | Pass | Outcome `forbidden` |
| Business owner | Personal taxonomy | Pass | Outcome `business_isolated`. No category row |
| Canonical money | AC-01 | Pass | Amount, date, direction, currency, and account unchanged |
| Direct insert | Least privilege | Pass | `monytix_api` insert failed. Intelligence cannot execute the writer |
| Competing tables | Section 23 | Pass | `txn_fact`, `txn_parsed`, `txn_enriched`, and `txn_categorized` are absent |
| Mounted F10D rules | M3.1 | Pass | `CASH_001`, `CC_001`, `EMI_001`, `EMI_002`, `INC_040`, `INC_050` |

Confidence is null on every attempt. Historical logical ids on account `01a12b2d-3324-71e2-8fbd-4faf2ec90b2a` were unchanged.
