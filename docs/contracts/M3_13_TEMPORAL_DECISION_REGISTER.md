# M3.13 temporal decision register

Status of every row: **APPROVED** on 2026-10-11 by the personal-contract approver. Record: `docs/approvals/M3_13_TEMPORAL_COLLISION_DECISION_FORM.md`. The condition on that form applies to TC-5 and to the amendment as a whole. Enforcement is not authorized. Date of the original proposal: 2026-10-11.

Evidence: `docs/qa/M3_12_INTEGRITY_TEST_MATRIX.md`, case G3-GAP, commit `3771ec2`. The regression still expects both closed overlapping attachments to be `UNIQUE`.

| ID | Question | Proposed answer | Alternative | Effect if approved | Status |
| --- | --- | --- | --- | --- | --- |
| TC-1 | Are effective periods half-open or fully inclusive? | Half-open `[effective_from, effective_to)`. A null end is unbounded. A shared endpoint does not overlap | Both endpoints inclusive, so a shared end date collides | No database change until a later implementation | APPROVED |
| TC-2 | Do two closed periods that overlap represent a collision? | Yes, when the same identifier type, provider scope, and normalized value overlap for a positive duration on different entities | Keep today's rule: only an open row collides | The M3.12 gap would become a required correction, still not built here | APPROVED |
| TC-3 | Does a collision make both associations `AMBIGUOUS`? | Yes. Neither entity is selected. This matches the open-ended behavior already tested | Reject the later insert and leave the earlier row `UNIQUE` | No silent winner | APPROVED |
| TC-4 | How are existing overlapping rows handled? | Leave them stored as they are. Do not rewrite ambiguity status, dates, or financial evidence as part of this approval | A migration that marks current overlaps `AMBIGUOUS` | Historical test and registry rows stay until a separate authorization | APPROVED |
| TC-5 | What happens when effective dates are updated? | A future authorized writer re-evaluates the same half-open rule and does not delete the row. Today's insert-only triggers stay until that authorization | Leave updates unchecked | No trigger is added now | APPROVED |
