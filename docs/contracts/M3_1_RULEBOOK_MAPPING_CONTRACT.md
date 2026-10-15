# M3.1 rulebook mapping contract

Status: adopted amendment. Date: 2026-10-11.

This document versions the F10D v1.2 freeze onto the canonical ledger. It does not edit the freeze, F10E, or F10F. It does not approve a public classify operation.

## Amendment

| Item | This slice | Source |
| --- | --- | --- |
| Event vocabulary | Section 5 families only. `EXPENSE` is not a family | F10D v1.2 |
| Stored outcome | `RESOLVED`, `UNKNOWN`, `AMBIGUOUS` | This amendment. F10D also names `PROVISIONAL`, `NOT_APPLICABLE`, and `INVALIDATED`. Candidate-only evidence is stored as `UNKNOWN` |
| Winning band | Lowest `P0`–`P9` band whose evidence threshold matched | F10D section 6 |
| Conflict | Two families in that band: `AMBIGUOUS`, with no chosen family or rule | F10D precedence safeguard |
| No match | `UNKNOWN`. Direction alone is not a match | F10D section 5 and section 10 |
| Rulebook version | `F10D-v1.2` | Freeze version plus the mounted v2 catalogue rows |
| Identity | One row per logical transaction, current canonical version, and rulebook version | This amendment |
| Head pointer | `is_current`. A newer rulebook version inserts a row and does not rewrite the older interpretation | Same pattern as canonical `is_current` |
| Evidence | Canonical description, `reversal_indicator`, and same-owner parser `channel_type`, `sub_type`, `parse_format` | F10A facts and parser v4 fields already stored |
| Confidence | Not stored. The outcome is the uncertainty record | OQ-18 stays open |
| Owner | Personal owners only. Business owners are not evaluated | F10D personal scope |
| Route | None | No approved classify contract |

## Mounted predicates

A clause is an evidence predicate copied from a named v2 rule and an F10D threshold. Catalogue word boundaries are PostgreSQL `\y`, `\m`, and `\M`.

| Rule | Family | Predicate |
| --- | --- | --- |
| `EMI_001` | `LOAN_REPAYMENT` | Outflow, parser subtype `EMI` or the EMI token, excluding sip, mutual fund, insurance, and premium |
| `EMI_002` | `LOAN_REPAYMENT` | Outflow and an explicit loan-repayment phrase. “Loan disbursement” does not match |
| `CC_001` | `CREDIT_CARD_PAYMENT` | Outflow and parser subtype `CC_PAYMENT`, channel `CARD_BILLPAY`, or an explicit credit-card phrase, excluding loan |
| `INC_040` | `INCOME` | Inflow and parser subtype `INTEREST_CREDIT` or an explicit interest-credit phrase |
| `CASH_001` | `CASH_MOVEMENT` | Outflow and parser channel `ATM` or format `ATM_WDL_DASH` |
| `INC_050` | `REFUND_REVERSAL` | Inflow, `reversal_indicator` true, and refund, reversal, or chargeback. Cashback does not qualify |

## Explicit non-mappings

| Catalogue or habit | Stored result |
| --- | --- |
| Direction `OUT` | `UNKNOWN`, not `MERCHANT_PURCHASE` and not an expense code |
| Direction `IN` | `UNKNOWN`, not `INCOME` |
| Salary keyword | `UNKNOWN` |
| “Self” or “own” without a verified owned endpoint | `UNKNOWN`, not `INTERNAL_TRANSFER` |
| `TRF_999`, `INC_999` | Not seeded |
| Refund wording without `reversal_indicator` | `UNKNOWN` |
| The word atm without parser ATM structure | `UNKNOWN` |
| Business owner | No resolution row |

F10E taxonomy is the next milestone. This amendment does not start it.
