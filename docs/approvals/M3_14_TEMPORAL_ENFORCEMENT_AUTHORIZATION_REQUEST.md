# M3.14 temporal collision enforcement authorization request

Request status: **GRANTED** on 2026-10-11  
Date of this request: 2026-10-11  
Semantic baseline: `TEMPORAL-COLLISION-v0.1`, **SEMANTICS_APPROVED**  
Semantic revision: `1f2202109457c5e1fbb919201bf48b6f506910da`  
Approval record: `docs/approvals/M3_13_TEMPORAL_COLLISION_DECISION_FORM.md`  
Gap evidence: commit `3771ec2`, case G3-GAP

The personal-contract approver granted this request on 2026-10-11 under the condition below. This file does not itself edit migration `0017`, the collision triggers, stored rows, or the financial-intelligence pipeline. No personal name was supplied, and none was added.

## What this request covers

If granted, a following implementation could add one forward migration after `0017`. That migration would enforce the approved half-open rule on `intel.entity_identifier` only.

| Event | Required behavior |
| --- | --- |
| Insert | Same identifier type, provider scope, and normalized value on two entities collide when `[effective_from, effective_to)` overlaps for a positive duration. A null `effective_to` has no end. Both associations become `AMBIGUOUS`. Neither entity is selected |
| Update of `effective_from` or `effective_to` | The same overlap test runs for the changed row. A new or continuing overlap marks both associations `AMBIGUOUS` |
| Concurrent writers | Writers of the same scoped identifier serialize. Two overlapping commits must not both remain `UNIQUE` |
| Adjacent periods | `[start, end)` followed by `[end, later)` does not collide |
| Untouched historical rows | A migration does not scan stored associations and does not change their ambiguity status. Rows already `UNIQUE` while overlapping stay as recorded until a later write hits them |

## What a date change does not do

`TEMPORAL-COLLISION-v0.1` defines overlap. It does not define restoration from `AMBIGUOUS` to `UNIQUE`.

This request does not authorize that restoration. Shortening, closing, or moving a period so that a positive overlap ends must not automatically change another association from `AMBIGUOUS` to `UNIQUE`. The other row keeps the ambiguity status it already has. No entity is selected because an overlap ended.

## What this request excludes

- Alias collision rules
- A backfill or any other rewrite of historical registry rows
- F10C lookup, party resolution, and `RESOLVED`
- `SELF`, owner-VPA, and commercial classification
- Changes to canonical money or to F10B, F10D, and F10E outputs
- Editing migration `0017`
- Changing the M3.12 regression until an authorized implementation is tested against it

## Condition

Adopted: **yes**

> Granting M3.14 authorizes a forward migration that enforces half-open identifier collisions on insert and on effective-date update, marks both overlapping associations AMBIGUOUS, and does not select an entity. It does not authorize restoring AMBIGUOUS to UNIQUE, rewriting untouched historical rows, or connecting the registry to financial interpretation.

## Decision

| Field | Record |
| --- | --- |
| Request | M3.14 temporal collision enforcement |
| Approver identity | Personal-contract approver. No personal name was supplied with the instruction |
| Approver role | Personal-contract approver |
| Decision date | 2026-10-11 |
| Disposition | GRANTED |
| Condition adopted | yes |
| Signature | Written instruction recorded 2026-10-11. No handwritten signature and no personal name were supplied |

Disposition is `GRANTED` for the cover above. Restoring `AMBIGUOUS` to `UNIQUE`, rewriting untouched historical rows, and connecting the registry to financial interpretation stay unauthorized. The current triggers remain insert-only until a forward migration is applied.
