# M3.3 F10C test matrix

Date: 2026-10-11. Database: local PostgreSQL 17 in `monytixv2-postgres-1`.

`services/api/tests/party-evidence.integration.test.ts` ran as `monytix_api` against `127.0.0.1:5432/monytix`. One test, pass, about 369 ms. `services/api/tests/f10e-taxonomy.integration.test.ts` and `services/api/tests/financial-event.integration.test.ts` passed again in the same session. `npx tsc -p tsconfig.json --noEmit` in `services/api` passed.

| Case | Contract | Result | Evidence |
| --- | --- | --- | --- |
| T01 Structured party evidence | Parser `counterparty_vpa` and `counterparty_name` | Pass | Observation stored. Status `UNKNOWN`. Reason `VPA_ROLE_AMBIGUOUS`. Nature `UNKNOWN`. No commercial hint. Outbox text does not contain the handle |
| T02 Missing party evidence | Missing candidate is not `NOT_APPLICABLE` | Pass | Status `UNKNOWN`. Reason `NO_ENTITY_CANDIDATE`. Zero observations |
| T03 Conflicting party evidence | Two strong identifiers | Pass | Status `AMBIGUOUS`. Reason `MULTIPLE_ENTITY_CANDIDATES`. Two observation ids kept |
| T04 Unknown counterparty | Narration is not mined | Pass | A shop-like description with no structured field stays `NO_ENTITY_CANDIDATE` |
| T05 UPI party signal | Parser v4 field, not classifier v3 | Pass | `spendsense.parse_narration_v4` VPA is observed and normalized. Status stays `UNKNOWN`. Nature is not `PERSON` |
| T06 Same name, different party | Homonyms are not merged | Pass | Two logical transactions, one label, two VPAs, two null `entity_id` values |
| T07 Same party, repeated transactions | Frequency does not create an entity | Pass | Same normalized VPA. Two attempts. Both `UNKNOWN`. Both `entity_id` null |
| T08 Cross-owner evidence | Same-owner sources only | Pass | A second owner's VPA is ignored. Zero observations |
| T09 Business isolation | Personal pipeline | Pass | Outcome `business_isolated`. No resolution row |
| T10 Resolver replay | Same version | Pass | Outcome `replay`. One resolution row |
| T11 Resolver version change | New policy version | Pass | Second row uses the new version. The first reason stays `VPA_ROLE_AMBIGUOUS` |
| T12 Historical preservation | Prior attempt is not rewritten | Pass | First row `is_current` false. Second row current |
| T13 Concurrent resolution | Advisory lock | Pass | Outcomes `created` and `replay`. One row |
| T14 Atomic rollback | Same transaction | Pass | No resolution row and no observation after rollback |
| T15 Canonical transaction unchanged | Money is canonical | Pass | Amount, direction, currency, and account unchanged |
| T16 F10D result unchanged | Party does not overwrite the event | Pass | `LOAN_REPAYMENT` before and after |
| T17 F10E result unchanged | Party does not force a category | Pass | Category `NOT_APPLICABLE`. Category code null |
| T18 No unsupported merchant category | Keywords and a VPA are not a merchant | Pass | Event outcome `UNKNOWN`. Category code null. Commercial hint null. Nature `UNKNOWN` |
| T19 No fabricated confidence | Legacy classifier weight is not identity truth | Pass | `identity_confidence` and `source_confidence` null |
| T20 No competing financial ledger | `core.logical_transaction` stays canonical | Pass | `ref.financial_entity` is absent. `txn_fact`, `txn_parsed`, `txn_enriched`, and `txn_categorized` are absent |

`SELF` from the words "self" or "own" stays `UNKNOWN`. Direct insert by `monytix_api` failed. `monytix_intelligence` cannot execute the writer. Another actor is `forbidden`. Historical logical ids on account `01a12b2d-3324-71e2-8fbd-4faf2ec90b2a` were unchanged.

Registry match, verified `SELF`, and merchant identity were not claimed as passed. Those outcomes are blocked.
