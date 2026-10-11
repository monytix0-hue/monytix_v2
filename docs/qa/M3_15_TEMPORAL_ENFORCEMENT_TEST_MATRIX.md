# M3.15 temporal enforcement test matrix

Date: 2026-10-11. Database: local PostgreSQL 17 in `monytixv2-postgres-1`.

`services/api/tests/temporal-collision.integration.test.ts` passed in about 782 ms after `0018_m3_15_temporal_collision_enforcement.sql` was applied. Authorization commit: `16eb9675e8e9107c1535814863eb9ceeabd079e6`.

| Case | Result | What ran |
| --- | --- | --- |
| T01 Overlapping closed insert | Pass | `[2023-01-01, 2024-01-01)` and `[2023-06-01, 2025-01-01)` both `AMBIGUOUS` |
| T02 Touching endpoint | Pass | The second period starts where the first ends. Both `UNIQUE` |
| T03 Open overlaps closed | Pass | A null end and a closed period inside it both `AMBIGUOUS` |
| T04 Separated history | Pass | 2020 and 2024 periods both `UNIQUE` |
| T05 Different provider scopes | Pass | Both `UNIQUE` |
| T06 Different identifier types | Pass | `MERCHANT_ID` and `BILLER_ID` both `UNIQUE` |
| T07 Update `effective_from` | Pass | Moving the later start backward marked both `AMBIGUOUS` |
| T08 Update `effective_to` | Pass | Extending the earlier end marked both `AMBIGUOUS` |
| T09 Update removes overlap | Pass | Shortening the period left both `AMBIGUOUS` |
| T10 Concurrent overlapping insert | Pass | The second insert waited on the scope lock. Both finished `AMBIGUOUS` |
| T11 Concurrent date update | Pass | The second update waited on the same scope lock, then both finished `AMBIGUOUS` |
| T12 Untouched history | Pass | Pre-migration token `overlap-1791734662543` stayed two `UNIQUE` rows with the same dates |
| T13 No resolution entry | Pass | Pipeline writers do not mention `financial_entity`. The API cannot execute the collision function |
| T14 Party status | Pass | The EMI party row was not `RESOLVED` |
| T15 Financial interpretation | Pass | Family stayed `LOAN_REPAYMENT`. Category code stayed null. Amount and direction stayed the same |
| T16 Role restrictions | Pass | `monytix_api` and `monytix_intelligence` have no table privileges. `SET ROLE monytix` is denied |
| T17 Rollback | Pass | Replacing the function inside a transaction and rolling back restored the prior definition. A rolled-back date change left the prior statuses |
| T18 Prior regressions | Pass | M3.11 and M3.12 passed when run one after the other. The M3.12 closed-overlap insert now expects `AMBIGUOUS`. F10B, F10C, F10D, F10E, and the pipeline test passed |
| T19 No numeric cutoff | Pass | `ref.entity_registry_rule` still has no numeric or threshold column |
| T20 No restoration | Pass | The function source does not assign `UNIQUE`. T09 left both rows `AMBIGUOUS` |

The original M3.12 matrix still records the pre-0018 result, where that same closed overlap stayed `UNIQUE`. That report was not rewritten.
