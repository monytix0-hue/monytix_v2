# M3.11 registry foundation test matrix

Date: 2026-10-11. Database: local PostgreSQL 17 in `monytixv2-postgres-1`. Roles: `monytix` and `monytix_api`.

`services/api/tests/registry-foundation.integration.test.ts` passed in about 510 ms. Migration `0017_m3_11_registry_foundation.sql` was applied before the run.

| Case | Result | What ran |
| --- | --- | --- |
| 1. Five entity natures | Pass | `ORGANIZATION`, `FINANCIAL_INSTITUTION`, `GOVERNMENT_BODY`, `PLATFORM_OR_INTERMEDIARY`, `UNKNOWN` |
| 2. Rejected natures and identifier types | Pass | `PERSON`, `MERCHANT`, and `SELF` rejected. `VPA`, `ACCOUNT_TOKEN`, `CARD_TOKEN`, and `USER_ALIAS` rejected |
| 3. Identifier collision | Pass | Two concurrent attachments of one scoped merchant id. Both rows `AMBIGUOUS`. No `UNIQUE` row remains for that token |
| 4. Alias confidence | Pass | Stored confidence is null. An explicit score is rejected. `USER_ALIAS` is rejected |
| 5. Registry policy | Pass | `ref.entity_registry_rule` has no numeric column and no threshold, confidence, cutoff, or score column |
| 6. Owner isolation and permissions | Pass | The three entity tables have no `owner_id`. `monytix_api` has no select, insert, update, or delete. An API insert is `42501` |
| 7. Existing pipeline | Pass | An EMI transaction stayed `LOAN_REPAYMENT` with a null category code. The party row did not become `RESOLVED`. A registry insert did not change that snapshot |
| 8. Historical evidence | Pass | Migration codes for F10C, F10B, and this foundation are all present. The EMI logical transaction gained no party observation. Historical logical ids on account `01a12b2d-3324-71e2-8fbd-4faf2ec90b2a` were unchanged |
| 9. Rollback | Pass | A committed-looking insert that was rolled back left the entity count unchanged. A following invalid `PERSON` insert aborted the transaction and also left the count unchanged |
| 10. No resolution entry point | Pass | `monytix_api` cannot execute the collision triggers. The F10B, F10D, F10E, and F10C writers do not mention `financial_entity` |

The applied migration was not dropped. Case 9 verifies that a failed or rolled-back write inside the same transaction boundary leaves no partial entity. `0017` itself is one `BEGIN`/`COMMIT` file.
