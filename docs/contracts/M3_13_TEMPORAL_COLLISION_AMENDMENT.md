# Proposed temporal collision amendment

Identifier: `TEMPORAL-COLLISION-v0.1`  
Status: **APPROVED** on 2026-10-11, semantics only  
Date: 2026-10-11  
Approval record: `docs/approvals/M3_13_TEMPORAL_COLLISION_DECISION_FORM.md`

The personal-contract approver approved this text as the temporal collision rule. The approval does not authorize database migrations, trigger modifications, historical data updates, identity resolution, or changes to the financial-intelligence pipeline. Enforcement of insert-time and update-time collisions requires separate implementation authorization. Migration `0017`, the collision triggers, and the M3.12 regression result are unchanged.

The recorded gap is commit `3771ec2`. Two closed periods for one scoped identifier can both stay `UNIQUE` while they overlap. The current triggers run on insert and treat only a row with `effective_to IS NULL` as active.

## Proposed rule

Use half-open intervals `[effective_from, effective_to)`. A null `effective_to` means the interval has no end. Two associations of the same identifier type, provider scope, and normalized value, on different entities, collide when the overlap has positive duration. Both associations are `AMBIGUOUS`. Neither entity is selected.

```text
Entity A: [2023-01-01, 2024-01-01)
Entity B: [2024-01-01, 2025-01-01)
Result: no overlap

Entity A: [2023-01-01, 2024-01-01)
Entity B: [2023-06-01, 2025-01-01)
Result: overlap, both AMBIGUOUS
```

A period that ends at the instant another begins does not collide. A shared calendar date collides only when that instant is inside both half-open intervals.

## Existing rows

Approval of this text does not update stored ambiguity status, effective dates, party observations, or F10B–F10E results. Associations already stored as `UNIQUE` stay as recorded. A later correction of those rows needs its own authorization and must not rewrite canonical evidence.

## Date changes

The current triggers do not run on update. This proposal says a future implementation would apply the same half-open test when `effective_from` or `effective_to` changes, keep the row, and still not select an entity. That implementation is not authorized here.

## What approval would not turn on

Approval would not edit `0017`, add a trigger, connect F10C to the registry, assign `SELF`, classify a merchant, or reassign historical evidence.
