# M2.4 extraction contract

Status: **ADOPTED** for narration extraction. Date: 2026-10-10.

Parser v4 does not receive a statement file. `spendsense.populate_txn_parse_stage_v3(p_upload_id uuid, p_user_id text)` reads `txn_fact`. This contract does not create `txn_fact` or `txn_parsed`.

## Adapter

`spendsense.parse_narration_v4(p_description text, p_direction text) RETURNS jsonb` calls the v4 classifier functions and returns `parse_version`, `channel_type`, `direction`, `parse_format`, `sub_type`, `parse_status`, `parse_confidence`, `parse_error_reasons`, and `fields`.

`parse_status` is `PARSED`, `PARTIAL`, or `UNPARSED`, using the v4 threshold of 0.70. `parse_version` is `v4`.

## File carrier

A sealed CSV with a `description` column is the only file layout accepted in this phase. PDF, XLS, and XLSX stay sealed and scanned, then extraction is `FAILED` / `UNSUPPORTED_FILE_LAYOUT`. That is not a parsed statement.

## D10 write

`ops.save_statement_extraction` inserts:

- `core.extraction_run` bound to `ref.adapter_registry` adapter `parser-v4` version `v4`
- `core.source_record.raw_description`, `raw_transaction_date`, `raw_amount`, `raw_debit` or `raw_credit`, and `raw_reference`
- `record_status` `TRANSACTION_CANDIDATE` for `PARSED`, `EXTRACTION_PARTIAL` for `PARTIAL`, and `EXTRACTION_REJECTED` for `UNPARSED`

The same document and adapter version replays the existing run. A different adapter version may add a run. Neither write creates `core.logical_transaction`.

Eligibility is server-side: document `AVAILABLE`, reason `SCAN_CLEAN`, metadata `sealed`, and SHA-256 equal to the object. A client cannot post a parse request. `monytix_intelligence` cannot execute the save function.

Partial and failed extractions do not set `processing_completed_at` and are not complete financial ingestion.
