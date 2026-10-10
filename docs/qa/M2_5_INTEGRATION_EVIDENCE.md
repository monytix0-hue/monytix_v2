# M2.5 integration evidence

Date: 2026-10-10. Database: disposable PostgreSQL 17 (`monytix-m23-pg`, port 55434). Migration `0009_m2_5_statement_mapping.sql` applied with `ON_ERROR_STOP`.

Command, from `services/api`:

`npm test`

Result: 40 pass, 0 fail, 0 skipped.

## Mapping cases that ran

| Check | Result |
| --- | --- |
| Resolved-account debit, currency from the account base (`USD`), reason path `ACCOUNT_BASE_CURRENCY` | Pass |
| Resolved-account credit stays `IN` | Pass |
| Same source record replay | Pass |
| Second document with the same reference links the existing logical transaction | Pass |
| Same amount and date with a different reference creates a second logical transaction | Pass |
| Same amount and date with no reference is `WEAK_MATCH` and creates no logical transaction | Pass |
| Missing date | Pass, `DATE_MISSING` |
| Invalid amount | Pass, `REJECTED` |
| Missing account | Pass, `ACCOUNT_UNRESOLVED` |
| Cross-owner account | Pass, `ACCOUNT_OWNER_MISMATCH` |
| Unsupported PDF run | Pass, `ineligible` |
| Partial narration with valid amount, date, and direction | Pass, `MAPPED` |
| Two concurrent map calls | Pass, one primary evidence link |
| Map inside a transaction, then rollback | Pass, the logical row is gone |
| `monytix_intelligence` execute | Pass, denied |
| Other owner reading the disposition under RLS | Pass, zero rows |

## Not run

Production Cloudflare R2, production ClamAV, tamper detection, proof that sealed bytes cannot change, concurrent extraction workers, and a second parser version. These remain M2.4 gaps. Event labels such as expense, income, card repayment, and loan disbursement were not assigned and were not tested as classifications.
