# IDENTITY-AMENDMENT-v0.1 decision form

Record status: **APPROVED** on 2026-10-11.  
This file is the approval record for the logical architecture and for the documented gaps. It is not an implementation authorization.

The decision text is `docs/approvals/IDENTITY_AMENDMENT_V0_1_APPROVAL_PACKAGE.md`. The blocker classes are `docs/approvals/IDENTITY_AMENDMENT_V0_1_BLOCKER_REGISTER.md`.

## Cover

| Field | Record |
| --- | --- |
| Amendment version | `IDENTITY-AMENDMENT-v0.1` |
| Decision IDs covered | ID-00, ID-A, ID-B, ID-C, ID-D, ID-E, ID-F, ID-G, ID-H, ID-I, ID-J, ID-K, ID-L, ID-M, ID-N, ID-O |
| Approver identity | Personal-contract approver. No personal name was supplied with the instruction |
| Approver role | Personal-contract approver |
| Approval date | 2026-10-11 |
| Package disposition | APPROVED |
| Conditions | Approval of IDENTITY-AMENDMENT-v0.1 establishes the agreed identity architecture only. It does not authorize database migrations, registry implementation, identity auto-resolution, merchant classification, or changes to existing financial interpretations. These require separate implementation approval and applicable governance requirements. |
| Outstanding blockers noted by the approver | The blocker register stands. Gaps ID-H, ID-I, ID-J, and ID-N remain open for implementation. The missing privacy specification, numeric threshold, and calibration set stay unpublished |
| Evidence references accepted | `docs/approvals/IDENTITY_AMENDMENT_V0_1_APPROVAL_PACKAGE.md`, `docs/contracts/M3_5_PROPOSED_IDENTITY_AMENDMENT.md`, `docs/contracts/M3_5_CONTRACT_DECISION_REGISTER.md`, `docs/architecture/M3_5_IDENTITY_CONTRACT_RECONCILIATION.md` |
| Signature | Written instruction recorded 2026-10-11 against this form. No handwritten signature and no personal name were supplied |

Package disposition is `APPROVED` for the amendment as a whole. The per-decision marks below are the same outcome. No decision was rejected or returned.

## Three decisions the approver keeps separate

1. **Logical architecture.** Approved: the sixteen decisions ID-00 and ID-A through ID-O.
2. **Unresolved gaps.** Approved as gaps: ID-H, ID-I, ID-J, and ID-N. Accepting them does not authorize a confidence threshold, a calibration set, or a retention period.
3. **Implementation.** Not decided here. Approval of all sixteen decisions does not authorize the registry.

Approver adopts this condition: **yes**

> Approval of IDENTITY-AMENDMENT-v0.1 establishes the agreed identity architecture only. It does not authorize database migrations, registry implementation, identity auto-resolution, merchant classification, or changes to existing financial interpretations. These require separate implementation approval and applicable governance requirements.

## Per decision

The package condition applies to every row. Evidence accepted for every row is the approval package and the M3.5 amendment, register, and reconciliation.

### ID-00 — Precedence of F10C over D10-3

- Status: **APPROVED**
- Condition: Package condition
- Evidence accepted: Approval package, ID-00

### ID-A — Entity nature

- Status: **APPROVED**
- Condition: Package condition
- Evidence accepted: Approval package, ID-A

### ID-B — Commercial hints

- Status: **APPROVED**
- Condition: Package condition
- Evidence accepted: Approval package, ID-B

### ID-C — Identifier object

- Status: **APPROVED**
- Condition: Package condition
- Evidence accepted: Approval package, ID-C

### ID-D — Alias types

- Status: **APPROVED**
- Condition: Package condition
- Evidence accepted: Approval package, ID-D

### ID-E — Relationships

- Status: **APPROVED**
- Condition: Package condition
- Evidence accepted: Approval package, ID-E

### ID-F — Registry policy object

- Status: **APPROVED**
- Condition: Package condition. The rule object is agreed. Creating it is not authorized by this form
- Evidence accepted: Approval package, ID-F

### ID-G — Effective dates

- Status: **APPROVED**
- Condition: Package condition
- Evidence accepted: Approval package, ID-G

### ID-H — Confidence scale

- Status: **APPROVED** as a documented gap
- Condition: Package condition. No numeric scale may be invented from this approval
- Evidence accepted: Approval package, ID-H

### ID-I — Auto-resolve cutoff

- Status: **APPROVED** as a documented gap
- Condition: Package condition. Numeric auto-resolution stays blocked. The boolean account-match path is described and is not authorized to build
- Evidence accepted: Approval package, ID-I

### ID-J — Calibration

- Status: **APPROVED** as a documented gap
- Condition: Package condition. No calibration set may be invented from this approval
- Evidence accepted: Approval package, ID-J

### ID-K — Owner-VPA verification

- Status: **APPROVED**
- Condition: Package condition. Narration does not create an owner-VPA assertion. Building that record needs a separate implementation approval
- Evidence accepted: Approval package, ID-K

### ID-L — Collisions

- Status: **APPROVED**
- Condition: Package condition
- Evidence accepted: Approval package, ID-L

### ID-M — Revocation

- Status: **APPROVED**
- Condition: Package condition. Revocation does not hard-delete party evidence
- Evidence accepted: Approval package, ID-M

### ID-N — Erasure and the missing governance specification

- Status: **APPROVED** as a documented gap
- Condition: Package condition. `MISSING_SOURCE` stands. No retention period and no hard delete are authorized
- Evidence accepted: Approval package, ID-N

### ID-O — Migration 0015 compatibility

- Status: **APPROVED**
- Condition: Package condition. Migrations `0001`–`0016` stay unchanged. Existing attempts are not backfilled
- Evidence accepted: Approval package, ID-O

## Known blockers already on the register

These remain implementation blockers after this approval:

- Data Governance, Consent, Privacy & Retention specification: `MISSING_SOURCE`.
- No numeric confidence threshold is published.
- No calibration set is in the freeze.
- Registry tables are not authorized by this approval.
- No owner-VPA verification record exists.
- Historical M3.3 attempts are not reassigned or backfilled.
- Tombstone behavior is cited from F10A, F10L L35, and D10. A retention period is not defined.

## Close

| Field | Record |
| --- | --- |
| Decisions approved | ID-00, ID-A, ID-B, ID-C, ID-D, ID-E, ID-F, ID-G, ID-H, ID-I, ID-J, ID-K, ID-L, ID-M, ID-N, ID-O |
| Decisions rejected | None |
| Decisions returned for changes | None |
| Date of this record | 2026-10-11 |
| Signature | Written instruction recorded 2026-10-11. No handwritten signature and no personal name were supplied |
