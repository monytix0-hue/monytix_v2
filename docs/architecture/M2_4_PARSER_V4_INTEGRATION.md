# M2.4 parser v4 integration

Status: **PASS WITH GAPS**. Date: 2026-10-10.

Parser v4 is mounted as a narration adapter. It does not create `txn_fact`, `txn_parse_stage`, `txn_parsed`, or `txn_parse_unknown_queue`. Production Cloudflare R2 and production ClamAV remain pending.

## Boundary

The supplied entrypoint `spendsense.populate_txn_parse_stage_v3` reads `txn_fact` and the following function inserts `spendsense.txn_parsed`. Those are legacy financial tables. CF-03 forbids creating them.

The classifier functions return structured values and do not need those tables:

- `spendsense.fn_detect_format_v3(text)` reads `spendsense.txn_channel_format_registry`
- `spendsense.fn_classify_tokens(...)` returns `jsonb`
- `spendsense.fn_parse_nach(text)` and `spendsense.fn_parse_other_subtype(text)` return `jsonb`
- `spendsense.fn_derive_direction_v3(...)` returns `text`
- `spendsense.fn_build_parse_error_reasons(...)` returns `text[]`

`database/migrations/0008_m2_4_parser_v4_adapter.sql` installs those registries and functions from `frs/transaction parsing files 2.zip` (`txn_parsing_framework_v4.sql`). `spendsense.parse_narration_v4(description, direction)` calls them in the same order as `populate_txn_parsed_v3` and returns JSON. It does not insert a SpendSense row.

On PostgreSQL 17, `text[] || 'CODE'` casts the code as an array literal. The error-code function uses `array_append` so the same v4 codes are stored. The codes are unchanged.

## What the parser accepts

v4 classifies a narration. It does not read a PDF, XLS, or XLSX object. The worker accepts a sealed CSV whose header includes `description`, plus optional `txn_date`, `amount`, and `direction`. Each description is passed to `parse_narration_v4`. Any other sealed file type records extraction status `FAILED` and reason `UNSUPPORTED_FILE_LAYOUT`.

A local fixture narration `UPI-123456789012-RAVI-HDFC-XXXX1234-RENT` returns channel `UPI`, format `UPI_DASH`, status `PARSED`, version `v4`, and reference `123456789012`. An unmatched narration returns `PARTIAL` and `NO_FORMAT_MATCH`.

## Persistence

`ops.save_statement_extraction` writes `core.extraction_run` and `core.source_record` after the document is `AVAILABLE`, `SCAN_CLEAN`, and sealed, and the SHA-256 matches. A second call for the same document and adapter version returns the existing run. A new `ref.adapter_registry` version can add another run. The worker does not insert `core.logical_transaction` or `public.transactions`.

`ops.enqueue_statement_extraction` runs only after a clean scan. Unscanned and infected documents are ineligible. There is no public parse route.

Parser version `v4` is stored on `ref.adapter_registry` (`parser-v4` / `v4`) and on `extraction_run.worker_metadata`.
