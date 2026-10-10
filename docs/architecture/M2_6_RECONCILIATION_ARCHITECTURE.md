# M2.6 reconciliation architecture

Status: implemented. Date: 2026-10-10.

## Audit

`core.logical_transaction` is the only transaction identity. M2.5 maps an eligible extraction run in `ops.map_statement_extraction`. A READY canonical version still requires a date, a positive amount, direction `IN` or `OUT`, a currency, and an owned account. Unresolved rows stay in `core.source_record_disposition`. That table is not a ledger.

Disposition outcomes stay `MAPPED`, `LINKED_EXISTING`, `REVIEW_REQUIRED`, and `REJECTED`. A run that is not eligible returns `ineligible` and writes no disposition. Those words are the review vocabulary. `MAPPED` is a new transaction. `REJECTED` is an invalid record.

M2.5 auto-linked a current READY version on account, amount, direction, and non-empty reference. It did not compare transaction date or currency, so a reused reference could attach the wrong transaction. Amount and date without a reference already stayed `WEAK_MATCH`. A reference on a different account was not linked. Canonical versions stay immutable. Equivalence is an `EQUIVALENT_OBSERVATION` link.

F9H-010 freezes `GET /v1/imports/{import_id}/status` and names counts. The nested status schema was still open, and F9 has no route to resolve a review item. This milestone adds that behavior in a versioned contract. It does not edit the F9 source file. Upload `WRITE_COMMITTED` remains object confirmation. It does not mean the import is financially reconciled.

Event labels are not assigned. Production R2, production ClamAV, tamper detection, and sealed-byte immutability stay open.

## Rules

New mapping decisions use `M2.6-v1`. A source record that already has a disposition is replayed, so an older `M2.5-v1` row is not overwritten.

Auto-link requires the same account, amount, direction, currency, transaction date, and non-empty reference. The same reference on that account with a different amount, date, currency, or direction is `CONFLICTING_REFERENCE` and creates no logical transaction. The same reference on another account is a separate transaction. Amount and date alone stay `WEAK_MATCH`. Two account legs are not linked and are not labeled as a transfer.

Review writes go through `ops.resolve_statement_review`. The reviewer can select an owned account, confirm a new transaction, link an owned transaction whose current version matches amount, direction, currency, and date, or reject the record. Missing source fields are not invented. `ops.finalize_statement_import` records finalization only when no review row remains.
