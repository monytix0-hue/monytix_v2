# M3.2 F10E implementation mapping

Status: adopted for the eligibility gate. Date: 2026-10-11.

This is a versioned reading of F10E v1.2. It does not edit the freeze. It does not approve a public classify route, and it does not assign a spend category.

## Implemented

| Requirement | Contract | Input | Output |
| --- | --- | --- | --- |
| Eligibility gate | Section 14 step 1, section 31 | Current `intel.financial_event_resolution` | One category attempt and one purpose attempt |
| Event constraints | Section 8 | Family and outcome on that resolution | Behavior stored in `ref.category_event_constraint` |
| Category vocabulary | Section 7 | The 20 published codes | `ref.taxonomy_category` under `F10E-v1.2` |
| Purpose vocabulary | Section 10 | The published purpose codes | `ref.taxonomy_purpose`. A resolution with status `UNKNOWN` keeps a null purpose code |
| Separate dimensions | AC-02, AC-04, AC-20 | Independent constraint columns | `intel.category_resolution` and `intel.purpose_resolution` |
| Anchor | AC-03 | Event resolution id and taxonomy version | Both stored. Unique together, so a repeat replays |
| Card bill | AC-07 | `CREDIT_CARD_PAYMENT` | Category and purpose `NOT_APPLICABLE`. No category code |
| Cash | AC-09, AC-33, conflict C1 | `CASH_MOVEMENT` | Category `UNKNOWN`. No spend code |
| Unresolved event | AC-10, AC-33 | F10D `UNKNOWN` or `AMBIGUOUS` | Both dimensions `UNKNOWN`. No category code |
| Loan and income | Section 8 | `LOAN_REPAYMENT`, `INCOME` | Category `NOT_APPLICABLE`. Loan purpose stays `UNKNOWN`. Income purpose is `NOT_APPLICABLE` |
| Refund without a link | Section 18, AC-24 | `REFUND_REVERSAL` and no relationship row | `UNKNOWN`. Narration is not classified |
| Versioning | Section 20, AC-51, AC-52 | New taxonomy version, or a new event resolution | New rows. The earlier status and the earlier event family stay |
| Owner | Personal scope | Actor membership and account ownership | Business owner writes nothing |
| Writer | M0 `intel` authority | `ops.resolve_financial_use` | `SECURITY DEFINER`. Execute for `monytix_api` only |

`NOT_APPLICABLE` is stored only where section 8 says the dimension does not apply. Missing merchant evidence is `UNKNOWN`, not `NOT_APPLICABLE`.

Confidence columns exist and stay null. F10E requires a number and does not define the scale. No score is invented. Purpose `NOT_APPLICABLE` reuses reason code `CATEGORY_NOT_APPLICABLE` because section 16 has no purpose-specific code for that status.

## Deferred

| Requirement | Why it is blocked |
| --- | --- |
| AC-06 normal merchant classification | Mounted F10D rules do not emit `MERCHANT_PURCHASE`. F10C parties, aliases, and billers are absent. The constraint is `MERCHANT_BLOCKED` and assigns no code |
| Subcategories | Section 7 gives English examples, not stable codes. `ref.taxonomy_subcategory` is empty |
| `OTHER_MERCHANT` | Requires merchant-spend event truth. It is seeded as a code and never selected |
| `FINANCIAL_SERVICES`, `GOVERNMENT_CIVIC` | Section 8 allows them only with fee or tax detail this ledger does not store |
| Refund inheritance | No `REFUND_OF` relationship is implemented |
| Components, corrections, custom categories | No component, correction, or overlay tables exist |
| UPI merchant category | F10E section 23 sends it to F10C. UPI v3 stays unmounted |
| Workbook 26/145 | CF-10. Not seeded |
| F10F handoff beyond status and reason | Confidence scale and exception handling belong to F10F |

A lower evidence tier is not implemented, because there is no higher-tier merchant evidence to rank against. Keyword narration is not a category rule.
