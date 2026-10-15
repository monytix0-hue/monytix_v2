# M3.2 implementation report

Verdict: **PASS WITH GAPS**

F10E v1.2 is the use-classification layer. It says what a resolved financial event was for. This slice implements the eligibility gate for the events M3.1 can actually produce. It does not assign a spend category. Merchant classification, refund inheritance, and subcategory codes stay blocked on evidence the freeze names and this database does not have.

## F10E scope discovered

The freeze's job is category, subcategory, and purpose, after F10D has named the event. Income, loan, transfer, investment, insurance, cash, and credit-card payment are not spend categories. `UNKNOWN` stays unknown. `NOT_APPLICABLE` means the dimension does not apply. `OTHER_MERCHANT` is a governed leaf for known merchant spend, not a fallback.

## Contract coverage

The audit is `docs/architecture/M3_2_F10E_CONTRACT_AUDIT.md`. The mapping is `docs/contracts/M3_2_F10E_IMPLEMENTATION_MAPPING.md`. Section 7's 20 category codes and section 10's purpose codes are loaded. Section 8's event behaviors are loaded as constraints. Category and purpose are separate rows, each anchored to the current F10D resolution and taxonomy version `F10E-v1.2`.

## Rules implemented

No narration-to-category rule was added. The implemented behavior is the eligibility gate:

- `LOAN_REPAYMENT` and `INCOME` do not receive a spend category
- `CREDIT_CARD_PAYMENT` stays `NOT_APPLICABLE` even when the narration also sounds like a merchant
- `CASH_MOVEMENT` stays `UNKNOWN`
- `REFUND_REVERSAL` without a verified original stays `UNKNOWN`
- An F10D `UNKNOWN` or `AMBIGUOUS` result is not forced into a category
- A new taxonomy version or a new event resolution inserts a new attempt and leaves the previous one

## Rules deferred

`MERCHANT_PURCHASE` classification, subcategories, `OTHER_MERCHANT` assignment, fee and tax reporting labels, refund inheritance, components, corrections, custom categories, and the UPI merchant hint. The workbook count of 26 categories and 145 subcategories remains CF-10 and was not seeded.

## Database changes

Forward migration `database/migrations/0014_m3_2_f10e_taxonomy.sql`, code `M3-2-F10E-TAXONOMY`, registered in `scripts/migrate.sh`. Applied to local PostgreSQL 17. Migrations `0001` through `0013` were not edited.

New objects: `ref.taxonomy_version`, `ref.taxonomy_category`, `ref.taxonomy_subcategory`, `ref.taxonomy_purpose`, `ref.category_event_constraint`, `intel.category_resolution`, `intel.purpose_resolution`, and `ops.resolve_financial_use`. The statement worker and the manual store call it after interpretation. There is no classify route. Canonical amount, date, direction, currency, and account are not updated. F10D family is not updated.

## Test results

F10E integration test: 1 passed. F10D integration test, re-run after this migration: 1 passed. API typecheck passed. The matrix is `docs/qa/M3_2_F10E_TEST_MATRIX.md`.

## Security results

`monytix_api` can execute the writer and cannot insert the resolution tables. `monytix_intelligence` cannot execute the writer. Another actor is `forbidden`. A business owner is `business_isolated` and gets no row. Two concurrent callers leave one category row and one purpose row. Rollback leaves neither the rows nor the outbox events. Row level security is enabled on both resolution tables.

## Remaining dependencies

F10C party and alias evidence, F10D `MERCHANT_PURCHASE`, refund relationships, a frozen confidence scale, and a purpose-specific reason code for `NOT_APPLICABLE`. Production Cloudflare R2 and ClamAV are unchanged.

## Recommended next milestone

F10C entity resolution for personal transactions, limited to the party evidence F10E section 2 requires before any merchant category is assigned. F10F confidence stays after that. Do not seed keyword categories ahead of the party.

## Verdict

**PASS WITH GAPS.** The eligibility gate matches the freeze for the events this ledger can resolve, unknown is not forced into a category, and owner isolation holds. Required merchant classification is unimplemented because its evidence is absent, so this is not a full F10E pass.
