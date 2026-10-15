# M3.1 financial-event architecture

Status: adopted for the personal rulebook slice. Date: 2026-10-11.

Migrations `0001` through `0012` are unchanged. `core.logical_transaction` and `core.canonical_transaction_version` remain the only transaction ledger. This slice does not assign an F10E category, mount UPI v3, or add a public classify route.

## Rulebook audit

The authority is F10D v1.2 FINAL FREEZE, read from `frs/Monytix_Personal_Deployment_Bundle.zip`. The catalogue is `frs/Rulebook Classification.zip`, v2 `Rulebook_schema.sql` and `Rulebook_seeds.sql`. That SQL writes `txn_enriched` and `txn_rulebook_output`. Those tables are not created. The SQL is a rule catalogue. It is not executed. `services/intelligence/app/rulebook/rules.py` is not called.

F10D section 5 names these families: `INCOME`, `BORROWING`, `LOAN_REPAYMENT`, `CREDIT_CARD_PAYMENT`, `INVESTMENT`, `INVESTMENT_PROCEEDS`, `INVESTMENT_INCOME`, `INSURANCE`, `INSURANCE_PAYOUT`, `TAX_GOVERNMENT`, `INTERNAL_TRANSFER`, `PERSON_TRANSFER`, `MERCHANT_PURCHASE`, `CASH_MOVEMENT`, `FEE_CHARGE`, `REFUND_REVERSAL`, `OTHER_FINANCIAL_EVENT`, and `UNKNOWN`. There is no `EXPENSE` family. A purchase is `MERCHANT_PURCHASE` only after higher bands are excluded and merchant evidence exists. Direction `OUT` is not that evidence.

Section 6 bands:

| Band | Families | What must be true |
| --- | --- | --- |
| P0 | `REFUND_REVERSAL`; proven `INTERNAL_TRANSFER` | Corrective or owned-endpoint evidence |
| P1 | `LOAN_REPAYMENT`, `CREDIT_CARD_PAYMENT`, `INSURANCE`, `TAX_GOVERNMENT` | Obligation evidence, not a generic debit |
| P2 | `BORROWING`, `INVESTMENT`, `INVESTMENT_PROCEEDS`, `INSURANCE_PAYOUT` | Facility, asset, or payout evidence |
| P3 | `INCOME`, `INVESTMENT_INCOME` | Economic-inflow evidence. A salary keyword is weak |
| P4 | `CASH_MOVEMENT` | ATM, CDM, or AePS structure |
| P5 | `MERCHANT_PURCHASE`, `FEE_CHARGE` | Only after higher bands fail, and with their own evidence |
| P6 | `PERSON_TRANSFER` | External person movement. It is not income or expense by itself |
| P9 | `OTHER_FINANCIAL_EVENT`, `UNKNOWN` | No direction fallback |

A lower band number does not win without its evidence threshold. Two strong families in the winning band stay unresolved. F10D also names `PROVISIONAL`, `NOT_APPLICABLE`, and `INVALIDATED`. This slice stores `RESOLVED`, `UNKNOWN`, and `AMBIGUOUS`. Evidence that F10D would leave as a candidate, including narration-only “self/own”, is stored as `UNKNOWN`.

Parser v4 fields already stored on `core.source_record.raw_record_payload` may be read: `channel_type`, `sub_type`, and `parse_format`. They are not parsed again into a SpendSense ledger.

## What was mounted

Rulebook version `F10D-v1.2`. A rule matches when its direction matches, its exclusion does not hit, and any clause matches. The winning band is the lowest `P` number with a match. One family in that band is `RESOLVED`, using the lowest `rule_code`. Two families are `AMBIGUOUS`. No match is `UNKNOWN`.

| Rule | Band | Family | Evidence copied from the freeze and the v2 catalogue |
| --- | --- | --- | --- |
| `EMI_001` | P1 | `LOAN_REPAYMENT` | Parser `sub_type` `EMI`, or the catalogue EMI token. Excludes sip, mutual fund, insurance, and premium |
| `EMI_002` | P1 | `LOAN_REPAYMENT` | Explicit loan repayment, loan payment, or loan installment. Disbursement is not this phrase |
| `CC_001` | P1 | `CREDIT_CARD_PAYMENT` | Parser `sub_type` `CC_PAYMENT`, channel `CARD_BILLPAY`, or explicit credit-card phrases. Excludes loan. Generic CRED and masked digits are not clauses |
| `INC_040` | P3 | `INCOME` | Parser `sub_type` `INTEREST_CREDIT`, or catalogue interest-credit phrases. Salary keywords are not this rule |
| `CASH_001` | P4 | `CASH_MOVEMENT` | Parser channel `ATM` or format `ATM_WDL_DASH`. The word atm alone is not a clause |
| `INC_050` | P0 | `REFUND_REVERSAL` | Canonical `reversal_indicator` plus refund, reversal, or chargeback. Cashback is excluded. The word refund alone does not resolve |

Catalogue `\b` is stored as a PostgreSQL word boundary. The legacy first-match engine is not used.

## Not mounted

These catalogue rows contradict F10D or need evidence this ledger does not have:

- `TRF_999` and `INC_999` force a transfer from direction. F10D forbids that.
- `TRF_001` treats self-transfer wording as a transfer. F10D section 8 keeps unverified “self/own” as a candidate.
- `INC_001` salary keywords. Section 10 demotes a company-like name and requires employer or payroll structure.
- `INC_003` employer-master match. No employer table is created.
- `MERCH_*` and UPI entity type. `MERCHANT_PURCHASE` needs F10C. UPI v3 stays unmounted (CF-15, OQ-05).
- Loan disbursement. No v2 rule emits `BORROWING`. The words “loan disbursement” and direction `IN` stay `UNKNOWN`.
- `CRED_004` and masked-digit card rules. F10D does not treat generic CRED or digits alone as a card-bill payment.
- Insurance, investment, fee, tax, and person-transfer keyword rows. Their F10D thresholds need insurer, broker, government, or person evidence that is not on the canonical row.

`FEE_CHARGE`, `INSURANCE`, `INVESTMENT`, `INVESTMENT_PROCEEDS`, `INVESTMENT_INCOME`, `TAX_GOVERNMENT`, `PERSON_TRANSFER`, `BORROWING`, `INTERNAL_TRANSFER`, `MERCHANT_PURCHASE`, and `OTHER_FINANCIAL_EVENT` stay in the allowed vocabulary. No seeded rule emits them in this version.

## Interpretation lifecycle

`ops.interpret_financial_event` is the only writer. `monytix_api` may execute it. `monytix_intelligence` may not. The API role cannot insert the resolution table. The function checks `ops.actor_can_access_owner` and active account ownership. A `BUSINESS` owner returns `business_isolated` and writes nothing.

It reads the current `READY` canonical version and same-owner rows in `core.transaction_evidence_link`. A source document owned by someone else is ignored. The same logical transaction, canonical version, and rulebook version returns `replay` and does not insert a second outbox row. A different rulebook version inserts a new `intel.financial_event_resolution` row, clears `is_current` on the previous interpretation, and leaves that previous family and rule code in place. Canonical amount, date, direction, currency, account, and description are not updated.

The manual store and the statement extract worker call this after the canonical write has committed. An interpretation failure does not roll back the money row. There is no HTTP classify route.

`FINANCIAL_EVENT_INTERPRETED` is written to the existing `ops.outbox_event` in the same transaction, deduped by logical transaction, canonical version, and rulebook version. The payload carries identifiers and the outcome. It does not carry narration.
