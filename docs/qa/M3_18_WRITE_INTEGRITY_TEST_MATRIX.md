# M3.18 write-integrity test matrix

Date: 2026-10-11. Database: local PostgreSQL 17 in `monytixv2-postgres-1`.

`services/api/tests/registry-write-correction.integration.test.ts` passed in about 5395 ms after `0019_m3_18_registry_write_integrity.sql` was applied. Authorization commit: `6bc44d4a2860ba65ac159846d9224334a7d9880f`.

| Case | Result | What ran |
| --- | --- | --- |
| T01 Identifier-type change | Pass | Moving `MERCHANT_ID` onto an overlapping `BILLER_ID` marked both `AMBIGUOUS` |
| T02 Provider-scope change | Pass | Moving onto an overlapping scope marked both `AMBIGUOUS` |
| T03 Normalized-value change | Pass | Moving onto an overlapping value marked both `AMBIGUOUS` |
| T04 Endpoint-only contact | Pass | A period that starts where the other ends stayed `UNIQUE` after the scope change |
| T05 Closed-period overlap | Pass | Closed periods that overlap after a scope change both became `AMBIGUOUS` |
| T06 Direct status change | Pass | `AMBIGUOUS` to `UNIQUE` during an overlap failed with `23514`. Both rows stayed `AMBIGUOUS` |
| T07 No restoration | Pass | The owner-side period function shortened the overlap and left both `AMBIGUOUS`. The collision function does not assign `UNIQUE` |
| T08 Scope-first lock | Pass | `ops.apply_governed_identifier_period` takes `pg_advisory_xact_lock` before `UPDATE`. Holding the row and then requesting that lock deadlocked with the function (`40P01` on the function call) |
| T09 Supported concurrency | Pass | The second period call waited on the scope lock. Both finished `AMBIGUOUS`. A second overlapping insert waited and both finished `AMBIGUOUS` |
| T10 Direct and key races | Pass | A direct date update without the function produced `40P01`. The retry finished `AMBIGUOUS`. Scope and value changes waited on the new scope lock and then both finished `AMBIGUOUS`. One simultaneous scope pair returned `55P03` on the waiter and `ok` on the other, then the retry finished `AMBIGUOUS` |
| T11 Entity attachment | Gap remains | Two overlapping closed rows on one entity stayed `UNIQUE`. Changing `entity_id` left the moved row `UNIQUE`. The trigger column list does not include `entity_id` |
| T12 Untouched history | Pass | Token `overlap-1791734662543` stayed two `UNIQUE` rows with the same ids and dates |
| T13 No registry lookup | Pass | F10B, F10D, F10E, and F10C function bodies do not mention `financial_entity` |
| T14 Party status | Pass | The EMI party row was not `RESOLVED` |
| T15 Financial interpretation | Pass | Family stayed `LOAN_REPAYMENT`. Category code stayed null. Amount, direction, and historical logical ids stayed the same |
| T16 Role restrictions | Pass | `monytix_api` and `monytix_intelligence` cannot read or write the table and cannot execute the collision function or the period function |
| T17 Rollback | Pass | Replacing the period function inside a transaction and rolling back restored the definition. A rolled-back period call left the prior statuses |
| T18 Prior regressions | Pass with one expected audit failure | M3.11 passed in about 399 ms, M3.12 in about 465 ms, and M3.15 in about 746 ms. F10B passed in about 398 ms, F10C in about 531 ms, F10D in about 374 ms, and F10E in about 283 ms. The M3.16 audit test still expects the old `UNIQUE` bypass and now fails at W01 with `23514`. That file was not edited |
| Migration replay | Pass | Applying `0019` again replaced the same functions and trigger and updated the existing `schema_migration` row |
| T19 No numeric cutoff | Pass | `ref.entity_registry_rule` still has no numeric, threshold, confidence, or retention column |
| T20 No merchant classification | Pass | The new function and the collision function do not mention `MERCHANT_PURCHASE`. The EMI category code stayed null |

Concurrency captured in this run: supported lock `ok,40P01`; supported dates `second-waited-on-scope-lock`; direct dates `40P01,ok`; serialized scope and value changes `second-waited-on-scope-lock`; simultaneous scope `55P03,ok`.
