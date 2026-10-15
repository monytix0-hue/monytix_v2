# M3.6 implementation report

Verdict: **PASS WITH GAPS**

F10B v2.0 can publish structural evidence without the identity registry. This slice does that. `IDENTITY-AMENDMENT-v0.1` is still `PROPOSED`. `PARSED`, numeric confidence, and merchant classification stay blocked.

## What was authorized

A versioned structure for one READY canonical transaction: rail, format key, mechanism subtype where the freeze names one, observed P2A/P2M/P2P/REV markers, and typed tokens. The writer does not decide who the party is and does not decide the financial event.

## What was built

Forward migration `database/migrations/0016_m3_6_f10b_structure.sql`, code `M3-6-F10B-STRUCTURE`. Migrations `0001`–`0015` were not edited. Objects: `ref.structure_policy`, `intel.transaction_structure`, `intel.transaction_identifier`, `ops.publish_transaction_structure`. The statement worker calls it before F10D. The manual store does the same. There is no classify route and no entity table.

Parser v4 is called as a candidate extractor. Its confidence is discarded. A known rail is stored as `PARTIAL`. A direction marker that disagrees with the canonical direction is `CONFLICT`, and the canonical direction stays. A VPA is `UNKNOWN_VPA`. An account token is `COUNTERPARTY_ACCOUNT` and is not `SELF`. A name is `COUNTERPARTY_LABEL_RAW`. IFSC is only the institution token. P2M is a marker.

## What stays blocked

The governed registry, owner-VPA verification, `RESOLVED` party identity, `SELF`, `MERCHANT_PURCHASE`, and F10E spend categories. The privacy and erasure specification is still missing. Numeric auto-resolution is still blocked. `PARSED` waits for a published field threshold. Payer and payee roles wait for a grammar the freeze accepts as final, which v4 is not.

## Tests

The matrix is `docs/qa/M3_6_F10B_TEST_MATRIX.md`. F10B: 1 passed, about 305 ms. F10D, F10E, and F10C passed again. API typecheck passed.

## Next

The personal-contract approver still needs to accept or reject `IDENTITY-AMENDMENT-v0.1`. The registry waits on that approval and on the missing privacy specification. F10D and F10E merchant behaviour waits on a real `MERCHANT_PURCHASE` gate, which this structure does not open.
