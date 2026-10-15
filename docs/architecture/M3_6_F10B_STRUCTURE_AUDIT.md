# M3.6 F10B structure audit

Status: implemented only for the independently authorized slice. Date: 2026-10-11.

`IDENTITY-AMENDMENT-v0.1` remains `PROPOSED`. This milestone does not approve it and does not build the identifier registry.

## Independence

F10B v2.0 consumes a READY canonical version and publishes rail, format, subtype, markers, and typed tokens. Person, merchant, and `SELF` are outside it. Income, EMI, card-bill meaning, and spend category are outside it. A VPA role is structural. An account token is not ownership. IFSC is an institution token. A counterparty label is not a governed identifier. P2A, P2M, and P2P stay observed markers.

That publication does not need `ref.entity_registry_rule`, an owner-VPA map, or the missing privacy specification. Those remain blockers for the registry, not for this slice.

## What this slice refuses

F10B section 14 says `PARSED` requires a versioned field threshold. No such number is in the freeze. Parser v4's own `parse_confidence` can exceed 1 and is a legacy weight. This slice never writes `PARSED` and never copies that weight. `rail_confidence` and `parse_confidence` stay null.

F10B section 8 says the v4 formats are migration candidates, not final role grammar. A single extracted VPA therefore stays `UNKNOWN_VPA`. Direction `OUT` is not turned into `PAYEE_VPA`.

Event-named v4 subtypes such as EMI and interest credit are not promoted to a rail or a subtype. Card-bill wording is not `MERCHANT_PURCHASE`.

## D10-3

The pack's `intel.transaction_identifier` defaults ambiguity to `RESOLVED` and confidence to `0`. This slice does not load that pack. Tokens are `CANDIDATE`. Confidence is null.

## Existing parser

`spendsense.parse_narration_v4` remains the extractor. The structure row records registry version `parser-v4-candidate` so the candidate is not mistaken for a finished F10B pattern registry.
