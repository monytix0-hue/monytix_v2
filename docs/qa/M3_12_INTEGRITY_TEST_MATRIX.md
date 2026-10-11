# M3.12 registry integrity test matrix

Date: 2026-10-11. Database: local PostgreSQL 17 in `monytixv2-postgres-1`.

`services/api/tests/registry-integrity.integration.test.ts` passed in about 438 ms. The migration file was applied a second time and left one `M3.11-v1` / `FOUNDATION_ONLY` policy row.

| Case | Result | What ran |
| --- | --- | --- |
| 1. Concurrent writers | Pass | Two database-owner sessions inserted the same scoped merchant id. Both rows are `AMBIGUOUS`. No `UNIQUE` row remains |
| 2. Scope and type separation | Pass | The same value under two provider scopes stays `UNIQUE` on each row. `MERCHANT_ID` and `BILLER_ID` in one scope stay `UNIQUE` |
| 3. Separated effective periods | Pass | A period closed in 2020 and an open period starting in 2024 for the same token both stay `UNIQUE` |
| 3. Overlapping bounded periods | Gap | Two `BIC` attachments whose periods overlap, both with `effective_to` set, both stayed `UNIQUE`. The collision trigger only compares rows that are still open |
| 4. Revocation | Pass | Setting `effective_to` keeps the row and its prior ambiguity status. A later non-overlapping attachment is `UNIQUE`. No party resolution was rewritten |
| 5. Grants and escalation | Pass | `monytix_api` has no table privilege, is not a member of `monytix`, cannot `SET ROLE monytix`, cannot `GRANT` itself, and cannot insert |
| 6. Unauthorized values | Pass | Direct inserts of `PERSON`, `MERCHANT`, `SELF`, `VPA`, `ACCOUNT_TOKEN`, and `CARD_TOKEN` are rejected |
| 7. Alias confidence | Pass | A legal name stores null confidence. A score of `0.5` is rejected |
| 8. Replay and rollback | Pass | Replaying `0017` committed and did not add a second policy row. A rolled-back entity insert left the entity count unchanged. The applied migration was not dropped |
| 9. Historical evidence | Pass | Logical ids on account `01a12b2d-3324-71e2-8fbd-4faf2ec90b2a` were unchanged. F10C and F10B migration codes remain |
| 10. F10B–F10E regression | Pass | F10D, F10E, and F10C tests passed. F10B and the pipeline test passed after their absence checks stopped treating the authorized `intel.financial_entity` table as a second transaction ledger. An EMI event stayed `LOAN_REPAYMENT`, the party status was not `RESOLVED`, and `ops.resolve_transaction_party` does not mention `financial_entity` |

No route or worker was added. F10C was not pointed at the registry.
