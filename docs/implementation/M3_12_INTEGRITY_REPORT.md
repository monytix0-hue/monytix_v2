# M3.12 integrity report

Verdict: **PASS WITH GAPS**

The passive registry from commit `aa2039b` stayed passive. Identity resolution was not connected. One temporal gap is recorded and was not patched.

## Audit before the M3.11 commit

`0017` grants nothing to `PUBLIC`, `monytix_api`, or `monytix_intelligence`. Its two triggers fire only before an identifier or alias insert, and they only mark collision status. They do not read or write F10B, F10C, F10D, or F10E. That commit is `aa2039b`, on top of the M3.10 grant `277546e`.

## What the gate ran

The matrix is `docs/qa/M3_12_INTEGRITY_TEST_MATRIX.md`.

Concurrent open attachments of one scoped token become `AMBIGUOUS`. Different scopes do not collide. A closed period followed by a later period does not collide. Closing `effective_to` keeps the historical row. The API role cannot escalate into the table owner. Unauthorized natures and identifier types are rejected. Alias confidence stays null. Replaying the migration does not duplicate the policy row.

F10D, F10E, and F10C passed on the existing tests. F10B and the pipeline test passed after they stopped requiring `intel.financial_entity` to be absent. That table is the authorized non-personal registry. It is not a second transaction ledger. No party row became `RESOLVED`.

## Gap

Two bounded identifier periods that overlap in time both remain `UNIQUE`. The trigger treats only an open row, `effective_to IS NULL`, as an active attachment. A reader can still find two entities for that token during the overlap.

The approved collision rule says two in-scope attachments stay `AMBIGUOUS`. It does not define whether periods that only touch at an endpoint overlap. This gate does not add that predicate. The registry stays on the current trigger.

Revocation does not reclassify a surviving row. A closed `AMBIGUOUS` row stays `AMBIGUOUS`. That preserves history. It is not an automatic selection.

## What remains blocked

Global person identity, cross-owner person identifiers, owner-VPA, `SELF`, automatic resolution, commercial hints, `MERCHANT_PURCHASE`, merchant categories, numeric confidence, and the privacy specification. The tables still have no `owner_id`. That is limited to this non-personal foundation.

## Next

Do not point F10C at these tables. A later change to bounded-period collisions needs an explicit overlap rule before a forward migration.
