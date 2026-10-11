# M3.9 privacy governance requirements

Status: requirements list. Date: 2026-10-11.  
The Data Governance, Consent, Privacy & Retention specification is **MISSING_SOURCE**. This note does not supply it. It does not set a retention period, a lawful basis, or a hard-delete right.

F10C section 20 names that specification for retention and erasure legality. F10A names the same gap for legal eligibility. The approved decision is ID-N: record the gap, authorize no hard delete, and follow the tombstone rules already frozen.

## Questions the missing specification has to answer

These questions must be approved before the affected lifecycle is implemented. This document does not answer them.

| Lifecycle | Question the specification owns |
| --- | --- |
| Collect | The lawful basis for keeping a name, VPA, account fragment, Aadhaar or AePS token, or merchant identifier taken from a statement or a manual post |
| Retain | How long an observation, a governed identifier, an alias, a relationship, and a resolution attempt may be kept, and which of those clocks differ |
| Access | Who may read an owner-scoped row, who may read a global non-personal entity, and how that access is audited |
| Invalidate | Which events close an effective period, and which events require a new resolution attempt |
| Erase | Whether any party object may be hard-deleted, which objects may only be tombstoned, and what a tombstone is allowed to still show |

A person token becoming a cross-owner graph is already forbidden by F10C section 20 and by ID-C. The specification still has to say whether a person may exist as an entity at all, and in what scope. Global merchant intelligence is already limited to governed non-personal registries. The specification still has to set the boundary of that registry.

## Constraints the specification must keep

These are already frozen. A future privacy specification can add procedure and legality. It does not weaken them.

- Third-party names, VPAs, account fragments, Aadhaar and AePS tokens, and merchant identifiers are sensitive. Access is least-privilege and auditable. F10C section 20.
- Full PAN, Aadhaar, or account numbers are not reconstructed from masked fragments.
- Raw party values stay out of general logs, analytics exports, and outbox payloads. M3.7 held that line for the imported UPI case.
- Hashing or tokenization used for matching is scoped and versioned so it does not link owners by accident.
- Authorized erasure follows F10A `ERASED_REFERENCE_ONLY`, F10L L35 invalidation without fabricated history, and D10 tombstone behavior. Legal retention stays outside those freezes.
- Published resolution attempts are not rewritten into a different party in order to erase them. ID-M and ID-O.
- Historical rows from migration `0015` are not backfilled or deleted by an identity implementation.

## What stays blocked until that specification is approved

- An erasure or hard-delete workflow for party evidence.
- A retention period on observations, aliases, governed identifiers, or attempts.
- A global person entity or a cross-owner person-identifier graph.
- Any design that deletes a published attempt to satisfy a read model.

The boolean account-match description in ID-I uses `core.account_ownership`, which already exists. ID-N does not, by itself, forbid a later request to review that path. The request is still a separate implementation authorization, and it still must not treat the posting account as the counterparty.
