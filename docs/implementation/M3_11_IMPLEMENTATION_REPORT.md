# M3.11 implementation report

Verdict: **PASS WITH GAPS**

The granted M3.10 slice now has tables. It does not resolve identity. The running F10B–F10E pipeline was not changed.

## What was authorized

Commit `277546e` grants non-personal entities, non-personal identifiers, non-personal aliases, and a registry-policy row. Architecture commit `fb0e2ac` was left in place.

## What was built

Forward migration `database/migrations/0017_m3_11_registry_foundation.sql`, code `M3-11-REGISTRY-FOUNDATION`.

| Object | Behavior |
| --- | --- |
| `intel.financial_entity` | Five natures only. No `owner_id`. No person nature |
| `intel.entity_identifier` | `MERCHANT_ID`, `TERMINAL_ID`, `BILLER_ID`, `BANK_ID`, `BIC`, `IFSC`. A second active scoped token marks both rows `AMBIGUOUS` |
| `intel.entity_alias` | F10C name types except `USER_ALIAS`. `alias_confidence` must stay null |
| `ref.entity_registry_rule` | Version `M3.11-v1`, rule `FOUNDATION_ONLY`. No numeric cutoff |

`monytix_api` and `monytix_intelligence` have no privileges on these objects. No route and no worker calls them. Existing party attempts stay `UNKNOWN` or `AMBIGUOUS`.

## What stays closed

Global person identity, cross-owner person identifiers, `SELF`, automatic resolution, commercial hints, `MERCHANT_PURCHASE`, merchant categories, numeric confidence, retention, and erasure. Migrations `0001`–`0016` were not edited. Historical `0015` observations were not backfilled.

## Tests

The matrix is `docs/qa/M3_11_REGISTRY_FOUNDATION_TEST_MATRIX.md`. One PostgreSQL 17 test passed, about 510 ms.

## Gaps

The foundation is structurally usable by the database owner and operationally inactive for the API. A later milestone still has to authorize any writer, any `RESOLVED` attempt, and any privacy lifecycle. Identifier reassignment remains undefined. The privacy specification remains missing.
