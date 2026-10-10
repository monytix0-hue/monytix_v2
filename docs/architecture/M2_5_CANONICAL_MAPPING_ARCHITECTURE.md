# M2.5 canonical mapping architecture

Status: implemented. Date: 2026-10-10.

## Audit

`core.logical_transaction` is the only transaction identity. `ops.create_manual_transaction` is the existing write path: one logical row, one canonical version, one evidence link, one outbox event, then activation.

A READY canonical version requires a date, a positive `numeric(20,4)` amount, direction `IN` or `OUT`, a currency, a financial account, and `extraction_sequence`. The account column is `NOT NULL`, so a row with no account cannot be a canonical version. `duplicate_outcome` is already `DISTINCT`, `EQUIVALENT_ACTIVE`, `EQUIVALENT_SUPERSEDED`, or `REVIEW_REQUIRED`.

M2.3 upload and M2.4 extraction do not store an account or a statement currency. `core.statement_instance.account_resolution_status` defaults to `UNRESOLVED`. Parser v4 returns narration JSON. The rulebook and UPI classifier are not mounted and are not used here. The canonical table has no event-family column, so expense, income, repayment, and loan labels are not assigned.

M2.4 production R2, production ClamAV, tamper detection, sealed-byte immutability, concurrent extraction workers, and a second parser version stay open. They are not closed by mapping tests.

## Mapping

`ops.map_statement_extraction` reads one extraction run. It creates a logical transaction only when the document is sealed and `SCAN_CLEAN`, the run is `COMPLETED` or `PARTIAL`, the source row has a valid date, positive decimal amount, and direction `IN` or `OUT`, and exactly one statement instance is `RESOLVED` to an active account owned by the document owner.

Unresolved, ambiguous, cross-owner, weak amount-and-date matches, and unresolved reversals are `core.source_record_disposition` rows. That table is not a ledger. The same source record and mapping version `M2.5-v1` replay. The same bank reference on the same account links the existing logical transaction and does not create another. Amount and date alone never merge two transactions.

Canonical versions stay immutable. Equivalence is the `EQUIVALENT_OBSERVATION` evidence link, not an update of `duplicate_outcome`.
