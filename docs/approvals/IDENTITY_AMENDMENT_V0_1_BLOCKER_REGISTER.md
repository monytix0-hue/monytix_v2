# IDENTITY-AMENDMENT-v0.1 blocker register

Amendment: `IDENTITY-AMENDMENT-v0.1`  
Status: architecture **APPROVED** on 2026-10-11. Implementation remains blocked where this register says so.  
Date: 2026-10-11  
Approval record: `docs/approvals/IDENTITY_AMENDMENT_V0_1_DECISION_FORM.md`

Classes:

- **A.** Blocks contract approval of a claim this amendment does not make, or of a text that would invent the missing rule.
- **B.** Blocks implementation.
- **C.** Blocks automatic identity resolution.

An item in class B or C can remain open while the personal-contract approver accepts or rejects the logical architecture. The amendment text already says approval would not create tables, change migration `0015`, change current F10C outcomes, assign `SELF`, assign a commercial hint, emit `INTERNAL_TRANSFER` or `MERCHANT_PURCHASE`, or assign an F10E category.

## Register

### Missing Data Governance, Consent, Privacy & Retention specification

Source status: `MISSING_SOURCE`. F10C section 20 and F10A name it. It is not in the personal bundle, the business bundle, or the repository.

- A. Blocks approval of any retention period, hard-delete right, or erasure legality that the amendment would have to invent. ID-N proposes to record the gap and to authorize no hard delete. That proposal can be accepted, rejected, or returned. Accepting it does not supply the specification.
- B. Blocks an erasure workflow for party evidence beyond the tombstone language already frozen in F10A, F10L L35, and D10.
- C. Does not by itself block the boolean account-match description in ID-I. It does block any design that would put person tokens on a cross-owner graph or delete published attempts to satisfy a read model.

Decisions: ID-N, with ID-C and ID-M depending on the same gap for deletion and cross-owner scope.

### Undefined numeric confidence threshold

F10C AC-04 names a configured threshold. Section 7 names a versioned threshold for tier 2. No number is printed. ID-H proposes not to invent a scale. ID-I proposes to keep numeric paths blocked.

- A. Blocks approval of a numeric cutoff, because none is frozen. It does not block approval of the decision to leave the cutoff unpublished.
- B. Blocks storing component scores and building any scored resolver.
- C. Blocks tier 2 and tier 3 auto-resolution, and any `SELF` path that depends on a number.

Decisions: ID-H, ID-I, ID-J.

### Missing calibration set

F10C section 14 requires labelled regression data and a false-positive cost. No labelled set is in the freeze. Classifier weights are not that set.

- A. Blocks approval of a claim that a calibration set exists. ID-J can be approved as a refusal to invent one.
- B. Blocks a future numeric policy version that would need a named regression set.
- C. Blocks tier 2 and tier 3 auto-resolution until that version exists.

Decisions: ID-J, ID-H.

### Registry implementation authorization

D10 names `ref.entity_registry_rule`, `intel.financial_entity`, `entity_identifier`, alias, and relationship placement. This amendment describes those records. Its own section 4 says approval does not create them.

- A. Does not block approval of the logical model in ID-00, ID-C, ID-F, and ID-O.
- B. Blocks creating entity tables, registry tables, routes, and any writer that publishes `RESOLVED`.
- C. Blocks any automatic resolution that needs a governed identifier, a registry rule row, or a collision check against governed attachments.

Decisions: ID-C, ID-F, ID-O. Downstream F10D `INTERNAL_TRANSFER` and `MERCHANT_PURCHASE`, and F10E merchant categories, stay inactive with them.

### Owner-VPA verification requirements

F10C section 8 treats a verified owner VPA as strong `SELF` evidence only when an ownership record is active and the scope matches. AC-05 says the same name is never enough. M3.6 stores a parsed handle as `UNKNOWN_VPA`. No owner-VPA table exists.

- A. Does not block approval of ID-K, which says narration does not create the assertion.
- B. Blocks building the verification record and any `SELF` writer that would use a handle.
- C. Blocks automatic `SELF` from a VPA, from P2M, from a label, or from the words "self" or "own". The boolean account-ownership path in ID-I is a different match, and it is still not cleared to build.

Decisions: ID-I, ID-K, ID-E.

### Historical identifier reassignment

F10C section 19 `IDENTIFIER_REASSIGN` requires high scrutiny, effective dates, and collision handling. Migration `0015` attempts have no structure id and no entity period. ID-O says they are not backfilled. ID-G and ID-M say a later change is a new attempt.

- A. The logical rule is specified: new attempt, effective dates, prior rows remain. A fuller operational procedure for who may reassign is not in this amendment. That missing procedure blocks approval of an operational reassignment policy. It does not block approval of ID-G, ID-M, and ID-O as written.
- B. Blocks building reassignment. `0015` must not be edited. A future `RESOLVED` row needs a structure id that these historical attempts do not have.
- C. Blocks rewriting a published `UNKNOWN` or `AMBIGUOUS` attempt into another identity. Replay, when a structure, ownership, or registry change requests it, inserts another attempt.

Decisions: ID-G, ID-M, ID-O.

### Tombstone and erasure behavior

F10A already requires a governance-approved workflow and `ERASED_REFERENCE_ONLY`. F10L L35 already requires invalidation without fabricated history. D10 already says authorized erasure is tombstone behavior and that legal retention is external. The legality and the retention period sit in the missing specification.

- A. Blocks approval of a new retention rule. ID-N can be approved as a citation of those three freezes plus `MISSING_SOURCE`.
- B. Blocks implementing party-evidence erasure until the missing specification says the workflow is legal.
- C. Does not authorize automatic resolution. An erasure, when it later exists, invalidates lineage and does not rewrite a published attempt into a different party.

Decisions: ID-N, ID-M.

## What is already true in the running system

These are facts for the approver. They are not new decisions.

- F10B structure rows exist under `0016`. Known rails are `PARTIAL`. Direction clashes are `CONFLICT`. Parser confidence is not copied.
- F10C does not read those structure rows. M3.7 left that path in place.
- F10D does not emit `MERCHANT_PURCHASE` or `INTERNAL_TRANSFER` from this pipeline.
- F10E does not assign a merchant spend category.
- `SELF` is not written.
- Outbox payloads for the M3.7 imported UPI case did not contain the handle.

## Approval versus implementation

The logical architecture can be reviewed while every class B and class C item stays open. Class A applies where an approver would be asked to bless a number, a retention period, a calibration set, or a hard delete. This amendment asks the opposite: leave those unpublished and record the gap.
