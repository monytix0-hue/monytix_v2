# M3.13 readiness report

Verdict at preparation: **READY_FOR_HUMAN_REVIEW**

Status after the decision form: **APPROVED** on 2026-10-11, semantics only. Record: `docs/approvals/M3_13_TEMPORAL_COLLISION_DECISION_FORM.md`. Migration `0017` and the collision triggers were not changed. The registry stays passive. Enforcement is not authorized.

## 1. Decisions

Five decisions, TC-1 through TC-5, all **APPROVED** on 2026-10-11, in `docs/contracts/M3_13_TEMPORAL_DECISION_REGISTER.md`. The amendment text is `docs/contracts/M3_13_TEMPORAL_COLLISION_AMENDMENT.md`. The record is `docs/approvals/M3_13_TEMPORAL_COLLISION_DECISION_FORM.md`.

## 2. Recommendation placed before the approver

Half-open intervals `[effective_from, effective_to)`. A positive-duration overlap of the same scoped identifier on two entities is a collision, and both rows are `AMBIGUOUS`. A period that ends at the instant the next begins does not collide. Stored rows are not rewritten by the approval. Date-update checks wait for a separate implementation authorization. That later review must cover collisions created by updates as well as inserts. The condition proposed for the approver is on the decision form. It does not authorize a migration, a trigger change, a historical update, identity resolution, or a pipeline change.

The approver adopted that rule and the condition on the decision form. The rule is in force as semantics. The database behavior is unchanged.

## 3. Evidence left unchanged

Commit `3771ec2` records the M3.12 gate. The regression still expects the two overlapping closed attachments to be `UNIQUE`. That expectation was not edited to make the gate green.

## 4. What this milestone did not do

No migration. No trigger. No F10C lookup. No `SELF`. No merchant classification. No historical reassignment. No change to canonical evidence.

## 5. Next human action

The semantics are approved. A forward correction of the trigger still needs a separate implementation authorization. That authorization must cover insert-time and update-time collisions. Existing rows stay as stored until such an authorization says otherwise.
