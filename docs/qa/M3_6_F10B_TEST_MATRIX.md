# M3.6 F10B test matrix

Date: 2026-10-11. Database: local PostgreSQL 17 in `monytixv2-postgres-1`.

`services/api/tests/f10b-structure.integration.test.ts` passed in about 305 ms. F10D, F10E, and F10C integration tests passed again. `npx tsc -p tsconfig.json --noEmit` in `services/api` passed.

| Case | Result | Evidence |
| --- | --- | --- |
| UPI handle | Pass | Rail `UPI`. Status `PARTIAL`, not `PARSED`. Role `UNKNOWN_VPA`. Ambiguity `CANDIDATE`. Confidence null. Outbox text does not contain the handle |
| P2M marker | Pass | Marker `P2M`. Subtype null. Rail remains `UPI` |
| Blank narration | Pass | `UNPARSED`, rail `UNKNOWN`, reason `NO_RAIL_MATCH` |
| EMI-shaped narration | Pass | Rail `UNKNOWN`. After F10D and F10E, family is not `MERCHANT_PURCHASE` and category code is null. Party status is not `RESOLVED` |
| Inbound UPI marker on an outbound canonical row | Pass | Status `CONFLICT`, reason `DIRECTION_MARKER_CONFLICT`. Canonical direction stays `OUT` |
| Replay | Pass | Outcome `replay` |
| Second policy version | Pass | New row is current. First status stays `PARTIAL` |
| Two callers | Pass | Outcomes `created` and `replay` |
| Rollback | Pass | No structure row |
| Other actor | Pass | `forbidden` |
| Business owner | Pass | `business_isolated` |
| Canonical money | Pass | Amount, direction, and currency unchanged |
| No entity table | Pass | `intel.financial_entity` is absent |
| Writer grants | Pass | `monytix_api` can execute and cannot insert. Intelligence cannot execute |

`PARSED`, payer and payee roles, merchant identity, and spend categories were not claimed as passed.
