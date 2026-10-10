# M2 D10-2 identity mapping

Status: compatible with the accepted CF-01 decision. Date: 2026-10-10.

## Shared identity

| Concept | Physical object | Rule |
| --- | --- | --- |
| Canonical transaction | `core.logical_transaction` | Only authoritative transaction identity. Primary key `logical_transaction_id` |
| Normalized representation | `core.canonical_transaction_version` | Append-only except `is_current`. One current READY version |
| Evidence of that identity | `core.transaction_evidence_link` | Relationship types are `PRIMARY_VERSION_SOURCE`, `CORROBORATING_SOURCE`, `EQUIVALENT_OBSERVATION`, `ALERT_PRECURSOR`, `LEGACY_PROVENANCE` |
| Account the identity belongs to | `core.financial_account` via `financial_account_id` | Required on the logical row |
| Who may read it | Active `core.account_ownership` for `ops.current_owner_id()` | SELECT policy `pol_logical_transaction_owner_read` |

An evidence link is not a transaction. A source record is not a transaction. A parser result is not canonical financial truth. A classification is not an identity. None of those objects replace `logical_transaction_id`.

Identity status on the logical row is `ACTIVE`, `MERGED`, `SPLIT`, `VOIDED`, or `ERASED_REFERENCE_ONLY`. A merge or split changes status. It does not silently reuse another row's id.

## Personal and business

Personal interpretation tables are not in D10-2. They remain later D10 waves (`intel` and the F10B–F10F head).

Business B10Q tables are not created. When a later phase stores a business row for the same financial transaction, that row keeps its own primary key and references `logical_transaction_id`. A party, weight, FIO, decision, mission, outcome, or M.I.L.E. row does not become a logical transaction. No B10Q amount column is economic truth beside `canonical_transaction_version.amount`.

## Explicit non-targets

| Object | M2.1 result |
| --- | --- |
| `public.transactions` and the other `0001_init.sql` stubs | Left in place. No new writer |
| `txn_fact` and the SpendSense chain | Not created. CF-03 stays unmounted |
| Parser, UPI, rulebook, MoneyMoments SQL | Not applied |
| Gmail mailbox credentials | Not stored. OQ-11 remains open |

## Write boundary in this slice

D10-2 creates SELECT policies only. `0005_m2_1_read_grants.sql` lets `monytix_api` read the new objects. It does not grant insert, update, or delete, and it does not add a write policy. `monytix_intelligence` cannot insert the new tables. Python does not commit `logical_transaction` or `canonical_transaction_version`.
