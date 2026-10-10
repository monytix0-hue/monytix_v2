# M2.7 implementation report

Date: 2026-10-10.

## Verdict

`PASS WITH GAPS`.

The local integrity cases passed on disposable PostgreSQL 17 and local MinIO. The API suite was 44 pass and 0 fail. Production Cloudflare R2 and production ClamAV were not reachable, so production readiness is not claimed.

## What changed

- `database/migrations/0011_m2_7_parser_version.sql` replaces `ops.save_statement_extraction`. `worker_metadata.parser_version` is now the `adapter_version` of the adapter row used for that run. Replay, tamper handling, and canonical writes are otherwise unchanged.
- `services/api/tests/hardening.integration.test.ts` covers authenticated review, sealed bytes, worker lease, and the `test-only` adapter.
- Import and manual tests wait on their own documents and account, so a parallel worker does not fail them by counting or scanning a different row.

Migrations `0001`–`0010` were not edited. No historical disposition was updated. No second ledger and no classification were added.

## Historical match audit

`M2.5-v1` rows on the disposable database: 28. Of those, 2 are `LINKED_EXISTING`. Both match the current rule on account, date, amount, currency, direction, and reference. Conflicting links: 0. The other rows are `MAPPED`, `REVIEW_REQUIRED`, or `REJECTED` and were left as stored. No remediation migration was required.

## What was verified

Authenticated review returns 200 and writes one logical transaction. Missing and invalid tokens return 401. Cross-owner import, account, and transaction requests return 403. A repeated idempotency key returns the same logical transaction. A stale `review_version` returns 409 and writes nothing. Two concurrent reviews leave one primary evidence link.

An unsigned PUT cannot replace the sealed object. Replacing the sealed bytes with server credentials makes extraction `OBJECT_TAMPERED` and creates no logical transaction. The clean sealed CSV extracts once. A second adapter records `test-only` and does not replace the current canonical version. A crashed claim rolls back without a new logical transaction. Finalize is refused while a review row remains.

## Production readiness

Not ready. `OBJECT_STORAGE_ACCESS_KEY_ID` is empty and `PRODUCTION_CLAMAV_HOST` is unset. T26 and T27 are `BLOCKED_ENVIRONMENT`. Local MinIO and local ClamAV do not close those gates. Failed jobs retry when due. They are not moved to `DEAD_LETTER` automatically.

## Next

Production R2 and production ClamAV verification. No later milestone was started.
