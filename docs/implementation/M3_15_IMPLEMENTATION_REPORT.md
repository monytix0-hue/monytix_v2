# M3.15 implementation report

Verdict: **PASS_WITH_GAPS**

Half-open identifier collisions are enforced for new inserts and for changes to `effective_from` or `effective_to`. The registry does not resolve a party. Migration `0017` was not edited. Implementation files are not committed.

## Authorization

M3.14 is granted in commit `16eb9675e8e9107c1535814863eb9ceeabd079e6`. The condition forbids restoring `AMBIGUOUS` to `UNIQUE`, rewriting untouched rows, and connecting the registry to financial interpretation. The semantic approval remains `1f2202109457c5e1fbb919201bf48b6f506910da`.

## Migration

`database/migrations/0018_m3_15_temporal_collision_enforcement.sql`, code `M3-15-TEMPORAL-COLLISION`.

`ops.mark_governed_identifier_collision` now treats a period as `[effective_from, effective_to)`. A null end is unbounded. The same identifier type, provider scope, and normalized value on two entities overlap when each start is strictly before the other end. Both rows become `AMBIGUOUS`. The function never assigns `UNIQUE`.

The trigger is `BEFORE INSERT OR UPDATE OF effective_from, effective_to`. An update that does not change those values returns without a new collision check. The migration contains no scan of existing rows.

## Locking

Each write takes a transaction advisory lock on `hashtextextended` of `identifier_type`, `provider_scope`, and `normalized_value`. A different scoped identifier uses a different lock. T10 and T11 waited on that lock and both committed `AMBIGUOUS`.

A plain `UPDATE` locks its row before the trigger takes the advisory lock. Two such updates of the same scoped identifier can deadlock. PostgreSQL aborts one transaction, so that attempt does not commit two `UNIQUE` rows. The tested concurrent update took the scope lock before changing dates, and both finished `AMBIGUOUS`.

## Tests

The matrix is `docs/qa/M3_15_TEMPORAL_ENFORCEMENT_TEST_MATRIX.md`. The new PostgreSQL 17 test passed in about 782 ms. M3.11 passed in about 410 ms and M3.12 in about 437 ms when run separately. F10B, F10C, F10D, F10E, and the M3.7 pipeline test passed. A parallel run of the entity-count rollback checks raced with other inserts; the sequential re-run matched the prior counts.

The M3.12 closed-overlap assertion now expects `AMBIGUOUS`, which is the authorized result for a new insert. `docs/qa/M3_12_INTEGRITY_TEST_MATRIX.md` still records the original `UNIQUE` gap and was not edited.

## Historical preservation

Token `overlap-1791734662543`, stored before this migration as two overlapping `UNIQUE` rows, had the same ids, statuses, and dates after every test. Canonical amount and direction on the EMI transaction did not change. Historical logical ids on account `01a12b2d-3324-71e2-8fbd-4faf2ec90b2a` did not change.

## Remaining gaps

Untouched overlapping rows from before `0018` stay `UNIQUE` until a later write changes their dates. That is the granted no-backfill rule. Alias collisions are still the open-ended insert rule from `0017`. A direct update of `ambiguity_status` alone does not run the overlap trigger. Two plain concurrent date updates can deadlock and require a retry. Identity resolution, `SELF`, and merchant classification stay unauthorized.

## Final verdict

**PASS_WITH_GAPS**
