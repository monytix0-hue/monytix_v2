# M3.5 readiness report

Verdict at M3.5: **READY_FOR_APPROVAL**

Status after M3.8: the personal-contract approver approved `IDENTITY-AMENDMENT-v0.1` on 2026-10-11. The record is `docs/approvals/IDENTITY_AMENDMENT_V0_1_DECISION_FORM.md`. That approval is architecture only. This report stays the M3.5 readiness note.

The proposed amendment `IDENTITY-AMENDMENT-v0.1` is complete enough to approve or reject. Approval would still not authorize implementation. No migration, table, route, or interpretation was changed.

## 1. Contract conflicts

Sixteen conflicts are registered as `PROPOSED` in `docs/contracts/M3_5_CONTRACT_DECISION_REGISTER.md`. The clause comparison is `docs/architecture/M3_5_IDENTITY_CONTRACT_RECONCILIATION.md`. The amendment text is `docs/contracts/M3_5_PROPOSED_IDENTITY_AMENDMENT.md`.

## 2. Recommended resolutions

F10C meaning and the D10 v1.2 object split are the proposed authorities. D10-3 enums are not adopted where they collapse nature, hint, alias, and identifier. No confidence number is invented. Numeric auto-resolution stays blocked. An exact counterparty-account ownership match is described as a boolean path and is not cleared for build.

## 3. Proposed canonical model

Observed identifier, governed identifier, entity, alias, owner relationship, entity relationship, commercial hint, verification evidence, registry rule, and resolution attempt are separate records. Entities and governed non-personal identifiers may be global. Observations, owner relationships, user aliases, verification evidence, and resolution attempts are owner-scoped. Conflicts remain `AMBIGUOUS`. History is a new attempt, not an update. Revocation closes a period and affects only later resolution.

## 4. Missing source documents

`MISSING_SOURCE`: the Data Governance, Consent, Privacy & Retention specification named by F10C section 20 and by F10A. It is not in the personal bundle, the business bundle, or the repository. F10A, F10L L35, and D10 already require tombstone invalidation and leave legal retention outside those freezes. This amendment does not fill that gap.

## 5. Decisions requiring approval

ID-00 through ID-O. Every status is `PROPOSED`. The approver is the personal-contract approver. Nothing in this milestone is marked approved.

## 6. F10B dependencies

A later registry implementation, which this milestone does not start, needs an F10B structure version bound to the canonical version before any new attempt may be `RESOLVED` (F10C AC-01). Required typed inputs for that later slice:

| Type | Role | Provenance | Ambiguity |
| --- | --- | --- | --- |
| `VPA` | Payer, payee, aggregator, intermediary, or unknown | F10B syntax and position. Not classifier v3 | Multiple VPAs stay separate |
| Account token | Counterparty account, masked as supplied | Grammar only. Missing digits are not reconstructed | A last-4 is not unique |
| `MERCHANT_ID_RAW` | Raw merchant id | Explicit marker or validated position | Entity resolution stays in F10C |
| `BILLER_ID_RAW` | Raw biller id | Explicit marker | Biller identity stays in F10C |
| `TERMINAL_ID_RAW` | Terminal | Explicit marker | Not a brand entity by itself |
| `IFSC` | Institution context | Full syntax only | Not a party | 
| Counterparty label | Label, not an identifier | Raw structural token | No entity class in F10B |

Parser v4 fields already stored on source records are observations. They are not a structure version. Sweep and linked-deposit tokens are required only for a later sweep-`SELF` slice, not for the first identifier catalogue. The rest of the F10B catalogue stays in F10B and does not block the decision to approve this amendment.

## 7. F10C, F10D, and F10E implications

If the amendment were later implemented, which this document does not do:

- F10C `RESOLVED` would still require one conflict-free candidate and a structure id. The boolean account match may set `SELF` or `JOINT_SELF` without inventing nature.
- A commercial hint would require a governed identifier or a collision-free alias under a published policy. P2M would remain supporting.
- F10D could then test `INTERNAL_TRANSFER` only with that relationship plus both owned ends. It could test `MERCHANT_PURCHASE` only with a resolved economic party, direction `OUT`, and higher bands already failed.
- F10E could then consider merchant-use codes only after `MERCHANT_PURCHASE`. Choosing a code would still need a section 12 tier. `OTHER_MERCHANT` would remain the residual for known merchant spend without a use class.

None of those outputs are activated.

## 8. Implementation blockers

Unapproved decisions. No numeric threshold or calibration set. No F10B structure. No owner-VPA evidence. No governed identifier rows. Migration `0015` must not be edited or overloaded with the D10-3 table shapes. The erasure specification is missing. Production R2 and ClamAV are unchanged and are outside this decision.

## 9. Final verdict

**READY_FOR_APPROVAL.** The amendment is ready to accept or reject. Implementation remains unauthorized.
