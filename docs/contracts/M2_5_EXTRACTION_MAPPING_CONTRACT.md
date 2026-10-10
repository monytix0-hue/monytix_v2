# M2.5 extraction mapping contract

Status: ADOPTED. Mapping version: `M2.5-v1`. Date: 2026-10-10.

`ops.map_statement_extraction(run uuid)` is the only writer. `monytix_api` may execute it. `monytix_intelligence` may not. There is no public parse or classify route.

## Eligible run

The document is `AVAILABLE`, includes `SCAN_CLEAN`, is sealed, and has a stored hash. The extraction run is `COMPLETED` or `PARTIAL`. `FAILED` and `UNSUPPORTED_FILE_LAYOUT` return `ineligible` and write nothing.

`TRANSACTION_CANDIDATE` and `EXTRACTION_PARTIAL` are assessed from date, amount, and direction. A narration marked partial can still map when those fields are valid. `EXTRACTION_REJECTED` is not mapped.

## Field rules

- Amount stays in `raw_amount`. The canonical amount is `numeric(20,4)`. Text that is not a positive number with at most four decimal places is `REJECTED` and creates no logical transaction.
- Date is `raw_transaction_date` only when it is a real `YYYY-MM-DD`. No timezone conversion.
- Direction is the stored parser direction. `IN` and `OUT` can be READY. `REV` is `REVIEW_REQUIRED` with `REVERSAL_UNRESOLVED` and is not treated as income. Merchant text does not set direction.
- Reference is `raw_reference`. A missing reference is not invented.
- `raw_description` is preserved. `normalized_description` is the parser text when present.
- Currency is `statement_instance.currency_code` when that instance is `RESOLVED`. If it is null and the account is resolved, the account `base_currency_code` is used and the disposition records `ACCOUNT_BASE_CURRENCY`. No currency and no resolved account does not assume INR.

## Account and duplicates

The account is `statement_instance.financial_account_id` only when `account_resolution_status` is `RESOLVED`, the account is `ACTIVE`, and `account_ownership` matches the document owner. Zero accounts, more than one account, or a cross-owner account produce `REVIEW_REQUIRED` and no logical transaction.

Order:

1. The same source record and `M2.5-v1` replay the existing disposition.
2. The same account, amount, direction, and non-empty reference as a current READY version adds `EQUIVALENT_OBSERVATION` and `LINKED_EXISTING`. It does not insert another logical transaction. The existing canonical row stays immutable.
3. The same amount and date without that reference is `REVIEW_REQUIRED` with `WEAK_MATCH`. It is not merged and it does not insert a logical transaction.

A new map inserts the logical transaction, the READY version, the primary evidence link, the disposition, and `TRANSACTION_CREATED` in one function body. A unique index on the primary evidence source record stops two workers from committing the same source record.

Event labels are not assigned. Parser channel stays on the source payload.
