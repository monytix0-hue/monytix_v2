# M1 decision — one canonical transaction identity

Status: accepted for implementation. Date: 2026-10-10.

This closes conflict CF-01 from `docs/architecture/M0_CONFLICT_REGISTER.md`.

## Decision

Monytix has one canonical transaction ledger and two independent financial intelligence domains.

```
Source ingestion
  -> parsing / normalization
  -> core.logical_transaction
       -> Personal domain (D10 v1.2, F10A–F10L)
       -> Business domain (B10Q v1.3)
```

| Area | Rule |
| --- | --- |
| Canonical transaction | D10 `core.logical_transaction` is the only authoritative transaction identity |
| Source evidence | Immutable. One authoritative linkage from evidence to that identity |
| Personal schemas | The eight D10 schemas remain: `core`, `intel`, `evidence`, `context`, `action`, `experience`, `ref`, `ops` |
| Business schemas | B10Q domain tables stay. They are not renamed into the eight personal schemas |
| Business primary keys | Not replaced with `core.logical_transaction` |
| Same financial transaction | The business row keeps its own id and references `logical_transaction_id` |
| Distinct business object | Party, weight, FIO, decision, mission, outcome, and M.I.L.E. rows keep their own ids and are not stored as logical transactions |
| Business amount columns | Not a second economic truth beside the canonical transaction |
| Personal intelligence | W1–W10, D1–D30, and personal M.I.L.E. semantics stay as frozen |
| Business intelligence | BW01–BW04, D01–D18, and the financial eligibility gate stay as frozen |
| Historical SQL | Parser, UPI, rulebook, MoneyMoments, and unmodified B10Q ledger packs are not executed |

`core.logical_transaction` itself is created in M2 with source intake. M1 creates the D10-1 identity foundation those later rows will belong to.

## Outbox name

D10 describes `ops.domain_event_outbox`. The D10-8 physical pack creates `ops.outbox_event` with the publish columns. M1 creates `ops.outbox_event` so a later D10-8 apply does not add a second outbox. `ops.idempotency_record` is the D10 idempotency object. No later pack defines that table.
