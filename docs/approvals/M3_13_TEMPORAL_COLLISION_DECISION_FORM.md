# TEMPORAL-COLLISION-v0.1 decision form

Record status: **APPROVED** on 2026-10-11.  
This file approves the temporal collision semantics only. It does not authorize enforcement.

The proposal is `docs/contracts/M3_13_TEMPORAL_COLLISION_AMENDMENT.md`. The questions are `docs/contracts/M3_13_TEMPORAL_DECISION_REGISTER.md`.

## Cover

| Field | Record |
| --- | --- |
| Amendment version | `TEMPORAL-COLLISION-v0.1` |
| Decision IDs covered | TC-1, TC-2, TC-3, TC-4, TC-5 |
| Approver identity | Personal-contract approver. No personal name was supplied with the instruction |
| Approver role | Personal-contract approver |
| Approval date | 2026-10-11 |
| Package disposition | APPROVED |
| Conditions | Approval of TEMPORAL-COLLISION-v0.1 establishes temporal collision semantics only. It does not authorize database migrations, trigger modifications, historical data updates, identity resolution, or changes to the financial-intelligence pipeline. Enforcement of insert-time and update-time collisions requires separate implementation authorization. |
| Signature | Written instruction recorded 2026-10-11. No handwritten signature and no personal name were supplied |

Package disposition is `APPROVED`. The per-decision marks below are the same outcome. The condition applies to TC-5 and to the amendment as a whole.

Approver adopts this condition: **yes**

> Approval of TEMPORAL-COLLISION-v0.1 establishes temporal collision semantics only. It does not authorize database migrations, trigger modifications, historical data updates, identity resolution, or changes to the financial-intelligence pipeline. Enforcement of insert-time and update-time collisions requires separate implementation authorization.

A later implementation review must cover collisions created by date updates as well as inserts. That review is not this approval.

## Per decision

### TC-1 — Half-open periods

- Status: **APPROVED**
- Condition: Package condition

### TC-2 — Closed periods that overlap

- Status: **APPROVED**
- Condition: Package condition

### TC-3 — Both associations `AMBIGUOUS`

- Status: **APPROVED**
- Condition: Package condition

### TC-4 — Existing rows are not rewritten

- Status: **APPROVED**
- Condition: Package condition. Stored associations are not updated by this approval

### TC-5 — Date updates wait for a later authorization

- Status: **APPROVED**
- Condition: Package condition. Insert-time and update-time enforcement both require a separate implementation authorization

## Close

| Field | Record |
| --- | --- |
| Decisions approved | TC-1, TC-2, TC-3, TC-4, TC-5 |
| Decisions rejected | None |
| Decisions returned for changes | None |
| Date of this record | 2026-10-11 |
| Signature | Written instruction recorded 2026-10-11. No handwritten signature and no personal name were supplied |
