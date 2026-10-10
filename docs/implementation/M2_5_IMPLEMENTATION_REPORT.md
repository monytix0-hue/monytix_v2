# M2.5 implementation report

Date: 2026-10-10.

## Verdict

`PASS WITH GAPS`.

The duplicate, cross-owner, evidence, retry, atomicity, and direction checks passed on disposable PostgreSQL 17. The full API suite was 40 pass and 0 fail. Production object storage, production malware scanning, tamper detection, sealed-byte immutability, concurrent extraction workers, a second parser version, and event labels remain open, so this is not a clean production pass.

## What shipped

`database/migrations/0009_m2_5_statement_mapping.sql` adds `core.source_record_disposition` and `ops.map_statement_extraction`. The worker in `services/api/src/imports/extract.ts` calls that function after a successful extraction save. No public route was added. Migrations `0001` through `0008` were not edited. No `txn_fact`, `txn_parsed`, or `txn_enriched` table was created.

A READY canonical row is created only for a sealed, clean, completed or partial extraction whose source row has a calendar date, a positive decimal amount, direction `IN` or `OUT`, and exactly one resolved account owned by the document owner. Currency comes from the statement when present, otherwise from that account's base currency with reason `ACCOUNT_BASE_CURRENCY`. The tested account used `USD`.

Unresolved accounts, cross-owner accounts, invalid amounts, missing dates, and amount-plus-date matches without a reference stay disposition rows. They do not create a second ledger. The same bank reference links the existing logical transaction through `EQUIVALENT_OBSERVATION`.

## Known gaps

- Production R2 and production ClamAV are not provisioned.
- Tamper detection, sealed-byte immutability, concurrent extraction workers, and a second parser version were not tested.
- Expense, income, card repayment, loan disbursement, and refund are not labeled. The rulebook is not mounted.
- M2.6 statement reconciliation and import review is the next milestone and is not started.
