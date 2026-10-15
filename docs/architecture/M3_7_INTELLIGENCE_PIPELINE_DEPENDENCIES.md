# M3.7 intelligence pipeline dependencies

Status: verified against the code that runs. Date: 2026-10-11. `IDENTITY-AMENDMENT-v0.1` was not approved.

## Actual execution order

The statement worker, after a mapped extraction, calls:

1. `ops.publish_structure_extraction_run` — F10B
2. `ops.interpret_extraction_run` — F10D
3. `ops.resolve_extraction_run` — F10E
4. `ops.resolve_party_extraction_run` — F10C

A manual post uses the same order on one logical transaction: structure, event, use, party. The canonical insert commits before those calls. A later failure does not roll back the manual row. Each intelligence call is its own statement unless the caller wraps them.

That order is an implementation sequence. It is not a chain of reads.

## Who reads what

| Layer | Reads | Does not read |
| --- | --- | --- |
| Canonical | Source document, extraction, account ownership | F10B, F10C, F10D, F10E |
| F10B | Current READY canonical description and direction. Parser v4 is the candidate extractor | F10C, F10D, F10E, stored party observations |
| F10D | Canonical description, reversal flag, and same-owner source payload `channel_type`, `sub_type`, `parse_format` | `intel.transaction_structure`, `intel.transaction_identifier` |
| F10E | The current F10D resolution and `ref.category_event_constraint` | F10B tokens, F10C parties, narration |
| F10C | Same-owner source payload `fields` named in `ref.party_observation_field` | `intel.transaction_structure`. Confirmed: `ops.resolve_transaction_party` does not mention that table |

F10E is the only layer that consumes another intelligence result. F10B, F10D, and F10C can run in any order without changing one another's stored outcomes. F10E must run after a current F10D row exists, or it returns `ineligible`.

## F10C and F10B

F10C v1.2 AC-01 requires a `transaction_structure_id` on a published party resolution. This pipeline never publishes `RESOLVED`. The shipped F10C writer stores observations from parser fields on the source record. The identity amendment that would attach those observations to a governed structure is still `PROPOSED`. This gate does not switch F10C onto F10B rows.

A statement can therefore have an F10B VPA token and an F10C observation of the same handle only when the source payload already contains `fields.counterparty_vpa`. F10C does not copy the token out of `intel.transaction_identifier`.

## Version keys

| Layer | Replay key | New version |
| --- | --- | --- |
| F10B | Logical transaction, canonical version, `f10b_version` | New policy row. Prior structure stays |
| F10C | Logical transaction, canonical version, `f10c_version` | New policy row. Prior attempt stays |
| F10D | Logical transaction, canonical version, rulebook version | New rulebook version. Prior family stays |
| F10E | Event resolution and taxonomy version | New taxonomy version. Prior category stays |

No new recomputation trigger was added. A new F10B version does not replay F10D. A new F10D version does not replay F10B or F10C.
