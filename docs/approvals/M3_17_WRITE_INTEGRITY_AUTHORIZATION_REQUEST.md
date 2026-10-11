# M3.17 registry write-integrity correction authorization request

Request status: **GRANTED** on 2026-10-11  
Date of this request: 2026-10-11  
Audit verdict: M3.16 **AUDIT_COMPLETE — INTEGRITY_GAPS_CONFIRMED**  
Audit revision: `932e21d363de2a097d4651018be20c4d459507a6`  
Enforcement already granted: M3.14, commit `16eb9675e8e9107c1535814863eb9ceeabd079e6`  
Enforcement already applied: M3.15, commit `184767720d71fa0cd4f0a3f19bea6389bfc33520`

The personal-contract approver granted WI-1, WI-2, and WI-3 on 2026-10-11 under the condition below. WI-4A and WI-4B were not selected, so a direct `entity_id` change stays unauthorized. This file does not add a migration, trigger, function, grant, or change to stored rows. The registry stays passive. No personal name was supplied, and none was added.

M3.14 covers inserts and changes to `effective_from` or `effective_to`. The gaps below are outside that grant.

## What a grant would cover

If granted, one later forward migration could guard only the write paths in the decision table. The half-open rule stays `[effective_from, effective_to)`. A null end is unbounded. The same identifier type, provider scope, and normalized value on two different entities collide when the overlap has a positive duration. Both associations become `AMBIGUOUS`. Neither entity is selected. The collision function still never assigns `UNIQUE`.

| Area | Proposed correction | Evidence |
| --- | --- | --- |
| Collision-key updates | Revalidate when `identifier_type`, `provider_scope`, or `normalized_value` changes. A new overlap marks both associations `AMBIGUOUS` | W04 and W05. `identifier_type` uses the same trigger omission and was not a separate executed case |
| Ambiguity status | Reject a direct change to `UNIQUE` while a positive overlap with another entity still exists | W01 and W08 |
| Concurrent date updates | Add one owner-side function that takes the scoped advisory lock and then updates `effective_from` or `effective_to` | W02 deadlock `40P01`. W03 retry then finished `AMBIGUOUS` |
| Entity attachment | Decide WI-4 below before any `entity_id` change is allowed or rejected | W06 |

Untouched historical rows stay untouched. Ending an overlap still does not restore `AMBIGUOUS` to `UNIQUE`.

## WI-4 — entity attachment, explicit decision

Moving `entity_id` from one entity to another is not a verified reassignment. Who may reassign an identifier is still an open policy question. This request separates that policy from the integrity hole found in W06.

| Option | Effect | What it is |
| --- | --- | --- |
| WI-4A | Reject a direct `UPDATE` of `entity_id` | An integrity safeguard. No reassignment occurs |
| WI-4B | Allow the column change only when the same collision rule revalidates the old and new attachments | Still not a verified reassignment. No entity is selected |
| Governed reassignment workflow | A recorded procedure for who may move an identifier and why | Outside this request. Needs its own policy decision |

The 2026-10-11 approval did not mark WI-4A or WI-4B. A direct `entity_id` change stays unauthorized. A governed reassignment workflow stays outside this grant.

## What this request excludes

- A governed identifier-reassignment workflow
- Treating an `entity_id` change as verified identity
- Restoring `AMBIGUOUS` to `UNIQUE` because an overlap ended
- A backfill of rows already stored
- Alias collision rules
- Granting `intel.entity_identifier` to `monytix_api` or `monytix_intelligence`
- Exposing the lock-before-write function to those roles
- F10C lookup, party resolution, and `RESOLVED`
- `SELF`, owner-VPA, and merchant classification
- Changes to canonical money or to F10B, F10D, and F10E outputs
- Editing migrations `0001` through `0018`

A raw owner `UPDATE` of dates can still deadlock. The proposed function is the supported path. Retry of an aborted raw update is an operational outcome, not a new integrity rule.

## Condition

Adopted: **yes**

> Granting M3.17 authorizes a later forward migration that revalidates half-open collisions on identifier type, provider scope, and normalized value, rejects a direct UNIQUE status while an overlap remains, and adds an owner-side lock-before-write function for effective dates. Entity attachment follows only the WI-4 option marked on this form. The grant does not authorize a reassignment workflow, restoring AMBIGUOUS to UNIQUE, historical backfill, or connecting the registry to financial interpretation.

## Decision

| Field | Record |
| --- | --- |
| Request | M3.17 registry write-integrity correction |
| Approver identity | Personal-contract approver. No personal name was supplied with the instruction |
| Approver role | Personal-contract approver |
| Decision date | 2026-10-11 |
| Disposition | GRANTED for WI-1, WI-2, and WI-3 |
| WI-1 Collision-key revalidation | GRANTED |
| WI-2 Reject direct UNIQUE while overlap remains | GRANTED |
| WI-3 Owner-side lock-before-write for effective dates | GRANTED |
| WI-4 Entity attachment | NOT SELECTED. Neither WI-4A nor WI-4B was marked. A direct `entity_id` change stays unauthorized |
| Condition adopted | yes |
| Signature | Written instruction recorded 2026-10-11. No handwritten signature and no personal name were supplied |
