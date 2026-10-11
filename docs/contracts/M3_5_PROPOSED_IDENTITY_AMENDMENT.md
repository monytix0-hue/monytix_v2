# Proposed identity amendment

Identifier: `IDENTITY-AMENDMENT-v0.1`  
Status: **APPROVED** on 2026-10-11, architecture only  
Date: 2026-10-11  
Approval record: `docs/approvals/IDENTITY_AMENDMENT_V0_1_DECISION_FORM.md`

The personal-contract approver approved this text as the identity architecture. The approval does not authorize database migrations, registry implementation, identity auto-resolution, merchant classification, or changes to existing financial interpretations. It amends how D10-3 is read against F10C v1.2 and D10 v1.2. It does not edit those freezes in place.

## 1. Precedence

F10C v1.2 governs party meaning. D10 v1.2 governs schema placement: entity, alias, identifier, and relationship rows in `intel`; versioned mapping policy in `ref`. D10-3 is an unadopted pack wherever its checks contradict F10C or omit a D10 object. Parser weights and UPI classifier scores are not confidence.

## 2. Logical model

No SQL.

| Record | Meaning | Owner | Scope |
| --- | --- | --- | --- |
| Observed identifier | A token or label taken from one source field on one canonical version | The source document's owner | Owner-scoped. Not an entity |
| Governed identifier | A typed token attached to one entity for an effective period, with provider or institution scope | Registry governance | Global only when non-personal. A person token is not a cross-owner graph |
| Entity | Stable party identity. Nature is the F10C list | Registry governance | Global and non-private |
| Alias | A name form: legal, brand, display, narration variant, VPA label, user alias, or legacy alias | Global row, or the owner when the alias is `USER_ALIAS` or otherwise owner-scoped | Mixed. Owner aliases stay behind owner isolation |
| Owner relationship | `SELF`, `JOINT_SELF`, `RELATED_PARTY`, `EXTERNAL`, `UNKNOWN` | That owner | Owner-scoped |
| Entity relationship | Brand, operator, intermediary, subsidiary, outlet, or same-group candidate | Registry governance | Global. Not inferred from a similar name |
| Commercial hint | Merchant, biller, employer candidate, RTA, gateway, marketplace, service provider, or unknown | The resolution attempt | Stored on the attempt. Not entity nature |
| Verification evidence | The ownership row, governed owner-VPA assertion, or scoped correction that supported a relationship | The owner, except an F10A account-ownership row which stays in `core` | Owner-scoped |
| Registry rule | The versioned policy a resolution cites, including any future threshold | Reference governance | Shared `ref` data. Not an entity |
| Resolution attempt | One immutable F10C result for one logical transaction, canonical version, structure version, and policy version | The owner of the transaction | Owner-scoped. One current attempt. Prior attempts remain |

Conflicts stay `AMBIGUOUS` when two in-scope governed attachments disagree. Missing tier 1–3 evidence stays `UNKNOWN`. Neither status is rewritten into `RESOLVED` by a later rule. A new policy version inserts a new attempt.

Revocation closes the effective period. Resolutions after that time ignore the row. Resolutions already published stay. Replay, when requested by a structure change, ownership change, or registry change, inserts another attempt.

Erasure legality is `MISSING_SOURCE`. Until that specification is supplied, this amendment authorizes no hard delete of party evidence. Any later erasure follows F10A `ERASED_REFERENCE_ONLY`, F10L invalidation without fabricated history, and D10 tombstone behavior.

## 3. Score-free resolution

No numeric confidence scale is defined. Numeric auto-resolution is blocked. Legacy classifier weights are not normalized into a score.

The only path this amendment treats as boolean, and still not as permission to build it, is an exact tier-1 account match: the counterparty account is an account that `core.account_ownership` assigns to that owner for the transaction time, the scopes match, and no material conflict is present. That path may establish `SELF` or `JOINT_SELF`. It must not treat the account the transaction is posted to as the counterparty. Entity nature may remain `UNKNOWN` on that attempt. A full `RESOLVED` entity still needs one conflict-free entity candidate. A handle, a name, P2M, or a repeated payee does not qualify.

## 4. What approval would not turn on

Approval of this amendment does not create tables, change migration `0015`, change current F10C outcomes, assign `SELF`, assign a commercial hint, emit `INTERNAL_TRANSFER` or `MERCHANT_PURCHASE`, or assign an F10E category.
