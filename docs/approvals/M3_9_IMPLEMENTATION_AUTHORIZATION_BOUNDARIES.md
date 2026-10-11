# M3.9 implementation authorization boundaries

Status: planning only. Date: 2026-10-11.  
`IDENTITY-AMENDMENT-v0.1` is **ARCHITECTURE_APPROVED**. Implementation authorization is **not granted**.

Categories:

| Category | Meaning |
| --- | --- |
| Architecture approved | The logical model is accepted |
| Ready for implementation review | The requirement is defined enough to request a separate build authorization |
| Needs contract amendment | The approved amendment does not establish the operational behavior |
| Governance blocked | The missing privacy or retention specification still owns the decision |
| Calibration blocked | A numeric threshold or a labelled regression set is missing |

A row in "Ready for implementation review" is a request that may be written later. It is not permission to migrate, add a route, or change F10B–F10E.

| Component | Category | Approved basis | Further gate |
| --- | --- | --- | --- |
| Identity architecture ID-00 through ID-O | Architecture approved | Decision form, 2026-10-11 | None for the architecture. The condition forbids build |
| Governed non-personal entity | Ready for implementation review | ID-00, ID-A. Nature list is the six F10C values. `MERCHANT` is not a nature | Separate implementation approval. D10 placement only |
| Person as a global entity | Governance blocked | ID-C. A person token is not a cross-owner graph | Privacy specification must say whether a person entity may exist, and in what scope |
| Governed non-personal identifier | Ready for implementation review | ID-C, ID-G, ID-L. Scoped, dated, collision stays `AMBIGUOUS` | Separate implementation approval. Erasure of those rows stays governance blocked |
| Person identifier or `USER_ALIAS` outside owner scope | Governance blocked | ID-C, ID-D, ID-N | Privacy specification |
| Alias name types | Ready for implementation review | ID-D. No default confidence. A VPA label is not a VPA | Separate implementation approval. No score default |
| Observed party evidence already stored | Architecture approved | ID-O. Migration `0015` stays. Outcomes stay `UNKNOWN` or `AMBIGUOUS` | Do not rewrite or backfill |
| Owner-relationship vocabulary | Architecture approved | ID-E | Writing a relationship is a later request |
| Boolean counterparty-account `SELF` or `JOINT_SELF` | Ready for implementation review | ID-I. Exact ownership match at the transaction time. Posting account is not the counterparty. Nature may stay `UNKNOWN` | Separate implementation approval. Not cleared by the architecture approval |
| Owner-VPA verification record | Ready for implementation review | ID-K. Owner-scoped assertion against a governed VPA | Separate implementation approval. Narration and parser fields do not create the row |
| `SELF` from a handle, label, P2M, or the words "self" or "own" | Architecture approved as excluded | ID-I, ID-K, AC-05, AC-14 | No build request |
| Who may perform `IDENTIFIER_REASSIGN` | Needs contract amendment | ID-G and ID-M approve dates and a new attempt. They do not name the actor or the scrutiny procedure | A later policy. Existing attempts stay |
| Registry rule row, without a numeric threshold | Ready for implementation review | ID-F. Shared `ref` policy. Not an entity | Separate implementation approval |
| Numeric confidence, tier 2, tier 3, and any scored `SELF` | Calibration blocked | ID-H, ID-I, ID-J | A published scale and a named regression set. Do not invent either |
| `RESOLVED` party attempt | Architecture approved | AC-01, ID-O. Requires a structure id and one conflict-free candidate. Prior attempts remain | Wait until entity and identifier implementation are separately authorized. Scored matching stays calibration blocked |
| Commercial hint | Architecture approved | ID-B. Hint stays on the attempt | A governed identifier or a collision-free alias under a published policy, then a separate request |
| `INTERNAL_TRANSFER` and `MERCHANT_PURCHASE` | Architecture approved | F10D already states the gates. The amendment does not turn them on | Verified relationship or resolved economic party first |
| Merchant spend category | Calibration blocked | F10E section 12. `OTHER_MERCHANT` is the residual | `MERCHANT_PURCHASE` first, then a tier. No category from a hint |
| Retention period and hard delete | Governance blocked | ID-N. `MISSING_SOURCE` | The privacy specification. Tombstones already follow F10A, F10L L35, and D10 |

## Requests that can be drafted without the privacy specification

These can be written as implementation-review requests. They still need their own approval before any migration.

- Non-personal entity rows using the F10C nature list.
- Non-personal governed identifiers with effective dates and collision behavior.
- Alias rows using the F10C name types and a null confidence.
- A registry-rule version that cites policy and contains no numeric cutoff.
- The boolean account-match path, limited to `core.account_ownership`.
- An owner-VPA table shape that stays empty until a real assertion is supplied.

## Requests that wait

- Anything that stores a person on a global graph.
- Any retention, erasure, or hard-delete workflow.
- Scored auto-resolution and merchant category selection.
- `INTERNAL_TRANSFER`, `MERCHANT_PURCHASE`, and `SELF` from a narration.
- Rewriting migration `0015` or reusing its table names for D10-3.
