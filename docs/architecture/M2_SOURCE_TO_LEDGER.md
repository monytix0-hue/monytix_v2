# M2 source to ledger

Authority: D10-2 pack `README_D10_2.md` and `D10_2_source_intake_canonical_ledger.sql`, under D10 v1.2 and F10A. CF-01 in `docs/decisions/M1_CF01_CANONICAL_IDENTITY.md` names `core.logical_transaction` as the only transaction identity.

This document does not authorize parser execution, uploads, or manual writes. Those are later workstreams.

## Chain

```
core.source_connection
  -> core.source_batch
       -> core.source_document
            -> core.extraction_run
                 -> core.source_record
                      -> core.transaction_evidence_link
                           -> core.logical_transaction
                                -> core.canonical_transaction_version
```

Supporting objects in the same pack: `ref.adapter_registry`, `core.document_set`, `core.document_set_member`, `core.statement_instance`, `core.statement_link`, `core.balance_snapshot`, `core.account_data_coverage`.

`core.source_document.object_reference` is the pointer to bytes. The bytes are not a Postgres column. No storage vendor is named (OQ-12).

## Invariants from the D10-2 README

1. `source_document` is the replay root. `source_record` is an extraction-run observation, not immutable bank truth.
2. Logical identity is separate from canonical representation. Re-normalization adds a `canonical_transaction_version` under the same `logical_transaction_id` when economic identity is unchanged.
3. Exactly one READY canonical version can be current. `is_current` and `logical_transaction.current_canonical_version_id` move together.
4. `core.activate_canonical_transaction_version` changes the current flag and the pointer in one database transaction.
5. READY requires a date, a positive amount, direction `IN` or `OUT`, a currency, and a resolved financial account. Direction `UNKNOWN` cannot be READY.
6. Direction (`IN`, `OUT`, `UNKNOWN`) is separate from `reversal_indicator` and `reversal_reference`.
7. Posting status stays `PENDING`, `AUTHORIZED`, `HOLD`, `POSTED`, `SETTLED`, or `UNKNOWN`. The pack does not invent finality.
8. `source_fx_rate` and `derived_fx_rate` are separate.
9. `source_sequence` is optional. `extraction_sequence` is required on extracted observations that become READY.
10. Cross-source corroboration uses `transaction_evidence_link`. It does not create a second logical transaction by itself.
11. Canonical ledger SELECT policies follow active `core.account_ownership`. Raw source rows are scoped by the acquisition `owner_id`.
12. Connection, batch, document, and extraction tables have no password column.
13. Legacy imports may keep limitation flags. Missing lineage is not fabricated.
14. After insert, a canonical version row may change only `is_current`.

Amount plus date plus narration is not a uniqueness key. Document and content hashes are indexed and are not globally unique. `duplicate_outcome` is `DISTINCT`, `EQUIVALENT_ACTIVE`, `EQUIVALENT_SUPERSEDED`, or `REVIEW_REQUIRED`. `REVIEW_REQUIRED` is the stored outcome when a match is ambiguous. Ambiguous rows are not merged by a uniqueness constraint.

`EMAIL_ALERT` and `SMS_ALERT` batches cannot be activated as current ledger truth.

## What this chain is not

- Not `public.transactions`.
- Not `txn_fact`, `txn_parse_stage`, `txn_parsed`, `txn_enriched`, or rulebook output.
- Not a B10Q schema. Business domain tables are not created in M2.1.
- Not classification. `normalization_status` is `READY`, `PARTIAL`, or `REJECTED` only.
