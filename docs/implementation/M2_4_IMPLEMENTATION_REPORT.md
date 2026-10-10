# M2.4 implementation report

Date: 2026-10-10.

## Final report

M2.4 status: **PASS WITH GAPS**.

Parser v4: mounted from `txn_parsing_framework_v4.sql` inside `frs/transaction parsing files 2.zip`. The population procedures that read `txn_fact` and insert `txn_parsed` are not installed. `spendsense.parse_narration_v4` calls the v4 classifier functions and returns JSON. A verified UPI dash narration returned `PARSED`, channel `UPI`, format `UPI_DASH`, version `v4`.

Supported formats: v4 narration channels, carried in a sealed CSV with a `description` column. The fixture above is the verified CSV case. PDF is rejected as `UNSUPPORTED_FILE_LAYOUT`. XLS and XLSX were not run. The zip contains no statement fixture files.

Database: `database/migrations/0008_m2_4_parser_v4_adapter.sql`. Registries and classifier functions live in schema `spendsense`. Results live in `core.extraction_run` and `core.source_record`. `txn_fact`, `txn_parse_stage`, and `txn_parsed` are absent. Migrations `0001` through `0007` were not edited. No logical transaction was created for the extracted statement.

Job dispatch: a clean scan calls `ops.enqueue_statement_extraction`. The scan worker then calls `runExtractOnce`. A second save for the same adapter version replays the existing run. Crash reclaim, concurrent workers, and a second parser version were not run.

Security: unscanned documents are not queued. There is no public extract route. `monytix_intelligence` cannot execute `ops.save_statement_extraction`. The worker does not log the narration.

Partial parsing: an unmatched narration returns `PARTIAL` and `NO_FORMAT_MATCH`. A fully parsed CSV run is `COMPLETED`. `processing_completed_at` is not set.

Versioning: `ref.adapter_registry` row `parser-v4` / `v4`, copied onto `extraction_run.worker_metadata`. A version-change reprocess was not run.

Tests: from `services/api`, `npm test` against disposable PostgreSQL 17, MinIO, and local ClamAV. **39 pass, 0 fail**.

Production: pending. This run does not verify Cloudflare R2 or production ClamAV.

## Open gaps

1. v4 does not parse PDF, XLS, or XLSX bytes. Those layouts fail closed.
2. Tamper, missing object, infected enqueue, concurrent workers, crash reclaim, and adapter-version reprocess were not executed in this run.
3. PostgreSQL 17 requires `array_append` for the v4 error-code list. The codes are the v4 codes.
4. Production R2 and production ClamAV are still not provisioned.

## Next

M2.5 normalization and deduplication can use `core.source_record` rows from a `PARSED` or `PARTIAL` run. It was not started.
