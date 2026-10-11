# M3.16 registry write-integrity test matrix

Date: 2026-10-11. Database: local PostgreSQL 17 in `monytixv2-postgres-1`.

`services/api/tests/registry-write-integrity.integration.test.ts` passed in about 1190 ms. The test only observed current behavior. It did not add a migration, trigger, write function, or identity-resolution call.

| Case | Result | What ran |
| --- | --- | --- |
| W01 Direct status change | Bypass | Owner `UPDATE` set one overlapping row from `AMBIGUOUS` to `UNIQUE`. The statement succeeded |
| W02 Direct date updates | Deadlock | Two concurrent date updates without a prior scope lock produced `40P01`. One transaction aborted |
| W03 Retry after deadlock | Correct final status | The aborted date update was retried alone. Both rows finished `AMBIGUOUS` |
| W04 Scope change | Bypass | Changing `provider_scope` onto an overlapping identifier left the row `UNIQUE` |
| W05 Normalized value change | Bypass | Changing `normalized_value` onto an overlapping identifier left the row `UNIQUE` |
| W06 Entity attachment change | Bypass | Two closed overlapping rows on one entity stayed `UNIQUE`. Moving one `entity_id` to another entity left it `UNIQUE` |
| W07 Invalid period | Rejected | `effective_to` before `effective_from` failed with `23514` |
| W08 Status versus overlap | Bypass | After W01, the half-open overlap was still present and the edited row was `UNIQUE` |
| W09 Writer permissions | Owner only | `monytix_api` and `monytix_intelligence` have no `SELECT`, `INSERT`, `UPDATE`, or `DELETE`. `monytix` is superuser and bypasses row security |
| W10 F10B–F10E | Unchanged | EMI stayed `LOAN_REPAYMENT`, category code stayed null, and party status was not `RESOLVED` |

Column names confirmed on `intel.entity_identifier`: `entity_identifier_id`, `entity_id`, `identifier_type`, `provider_scope`, `normalized_value`, `ambiguity_status`, `effective_from`, `effective_to`.
