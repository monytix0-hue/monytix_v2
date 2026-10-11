# M3.16 registry write-integrity audit

Verdict: **AUDIT_COMPLETE — INTEGRITY_GAPS_CONFIRMED**

This pass recorded which writes can leave an overlapping identifier marked `UNIQUE`. It did not change the database. Migration `0018` and the trigger from M3.15 remain as committed in `184767720d71fa0cd4f0a3f19bea6389bfc33520`.

## Authorization boundary

M3.14 authorizes half-open collision checks on insert and on changes to `effective_from` or `effective_to`. It does not authorize a registry-status interface, a new writer function, or a guard on other columns. Those findings stay unfixed.

## What the current trigger covers

`ops.mark_governed_identifier_collision` runs `BEFORE INSERT OR UPDATE OF effective_from, effective_to`. An update that leaves both dates unchanged returns immediately. The function never assigns `UNIQUE`.

## Findings

| Question | Observed answer |
| --- | --- |
| W01 Can the owner set `AMBIGUOUS` back to `UNIQUE`? | Yes. `UPDATE intel.entity_identifier SET ambiguity_status = 'UNIQUE'` succeeded for the table owner |
| W02 Can a direct date update deadlock? | Yes. Two updates of the same scoped identifier, without taking the advisory lock first, ended in `40P01` |
| W03 Does a retry finish correctly? | Yes in this run. The aborted update was issued again, and both rows were `AMBIGUOUS` |
| W04 Can `provider_scope` change without a new collision check? | Yes. The row stayed `UNIQUE` after it was moved onto an overlapping scope |
| W05 Can `normalized_value` change without a new collision check? | Yes. The row stayed `UNIQUE` after it was moved onto an overlapping value |
| W06 Can `entity_id` change without a new collision check? | Yes. Overlapping closed rows on one entity are not a collision. After one row moved to a different entity, it stayed `UNIQUE` |
| W07 Can an inverted period be stored? | No. The check `effective_to IS NULL OR effective_to > effective_from` rejected it with `23514` |
| W08 Can a status edit bypass the approved collision rule? | Yes. The overlap remained after the row was set to `UNIQUE` |
| W09 Who can perform these writes? | `monytix_api` and `monytix_intelligence` cannot read or write `intel.entity_identifier`. The owner role `monytix` is superuser and bypasses row security. No narrower registry writer exists |
| W10 Did F10B–F10E change? | No. The EMI path stayed `LOAN_REPAYMENT`, with a null category code and a party status other than `RESOLVED` |

W02 and W03 match the M3.15 gap. A retry of the aborted transaction produced the approved statuses in this run. That does not make an unguarded direct `UPDATE` a supported writer. The advisory lock is still acquired only inside the trigger, after PostgreSQL has locked the row.

W04, W05, W06, and W08 are additional bypasses. Each is reachable by the owner and unreachable by the API and intelligence roles.

## What this audit does not authorize

No constraint, trigger change, or application write path was added. A later correction needs its own grant, limited to the bypasses above. Identity resolution and merchant classification remain unauthorized.
