# M3.18 implementation report

Verdict: **PASS_WITH_GAPS**

Identifier key changes and a direct `UNIQUE` write during overlap now follow the approved collision rule. Effective-date changes have an owner-side function that locks the scoped identifier before updating the row. The registry does not resolve a party. Implementation files are not committed.

## Authorization

M3.17 is granted for WI-1, WI-2, and WI-3 in commit `6bc44d4a2860ba65ac159846d9224334a7d9880f`. The adopted condition forbids a reassignment workflow, restoring `AMBIGUOUS` to `UNIQUE`, historical backfill, and connecting the registry to financial interpretation. WI-4A and WI-4B were not selected.

## Migration

`database/migrations/0019_m3_18_registry_write_integrity.sql`, code `M3-18-WRITE-INTEGRITY`. Migrations `0001` through `0018` were not edited. Replaying the file committed again through `CREATE OR REPLACE` and the existing `schema_migration` row. A replacement of the period function inside an open transaction rolls back to the prior definition.

`ops.mark_governed_identifier_collision` still uses half-open `[effective_from, effective_to)` overlap. A null end is unbounded. The same identifier type, provider scope, and normalized value on two entities marks both rows `AMBIGUOUS`. The function never assigns `UNIQUE`.

`trg_entity_identifier_collision` is `BEFORE INSERT OR UPDATE OF identifier_type, provider_scope, normalized_value, effective_from, effective_to, ambiguity_status`. An update that changes only `entity_id` does not fire it.

A direct change from another status to `UNIQUE` takes the scoped advisory lock and raises `23514` while a positive overlap exists. The statement does not commit. Nested updates that set `AMBIGUOUS` return without assigning `UNIQUE`.

## Owner-side period function

`ops.apply_governed_identifier_period(uuid, timestamptz, timestamptz)` reads the current identifier key, takes `pg_advisory_xact_lock` on that key, and then updates `effective_from` and `effective_to`. The existing trigger performs the collision check. The function does not change `entity_id` or `ambiguity_status`. It is not `SECURITY DEFINER`. Both functions set `search_path` to `pg_catalog, intel`. `EXECUTE` is revoked from `PUBLIC`, `monytix_api`, and `monytix_intelligence`.

## Locking

The supported period path waits on the scoped lock before it changes the row. In this run the second call waited, then both rows finished `AMBIGUOUS`.

A direct `UPDATE` of dates still locks the row before the trigger takes the advisory lock. Two such updates produced `40P01`. The aborted update was retried and both rows finished `AMBIGUOUS`. WI-3 does not remove that deadlock from the raw update path.

Serialized scope and value changes waited on the new scoped lock and then both finished `AMBIGUOUS`. One simultaneous scope pair returned `55P03` for the waiter under a 2 second lock timeout and did not return `40P01`. The retried update finished `AMBIGUOUS`.

## Tests

The matrix is `docs/qa/M3_18_WRITE_INTEGRITY_TEST_MATRIX.md`. The PostgreSQL 17 test passed in about 5395 ms. M3.11 passed in about 399 ms, M3.12 in about 465 ms, and M3.15 in about 746 ms. F10B passed in about 398 ms, F10C in about 531 ms, F10D in about 374 ms, and F10E in about 283 ms. The M3.16 audit test was left unchanged. It still expects an owner to set an overlapping row to `UNIQUE`, and it now fails at that step with `23514`.

## Remaining gaps

A direct `entity_id` change still does not revalidate. Overlapping closed rows can move to another entity and stay `UNIQUE`. That is the W06 bypass, and WI-4 was not granted. Untouched overlapping rows from before `0018` stay `UNIQUE`. Alias collisions remain the open-ended insert rule from `0017`. A raw date update can still deadlock. Identity resolution, `SELF`, and merchant classification stay unauthorized.

## Final verdict

**PASS_WITH_GAPS**. The three granted write paths behave as authorized. The entity-attachment bypass and the raw date-update deadlock remain open, and this migration does not close them.
