# M2.7 import hardening architecture

Status: implemented. Date: 2026-10-10.

## Audit

`core.logical_transaction` remains the only transaction identity. M2.6 links a current READY version only when account, amount, direction, currency, date, and reference all match. A `M2.5-v1` disposition is replayed and is not rewritten. This milestone classifies those historical links and does not remap them.

The sealed object is `owners/{owner}/imports/{import}/object`. The presigned PUT is only the staging key. Extraction reads that sealed key, hashes the bytes, and stores `OBJECT_TAMPERED` when the hash differs from the recorded checksum. A database flag alone is not the integrity check.

`ops.claim_statement_extraction` takes the oldest due `PENDING`, `FAILED`, or `PUBLISHING` row with `SKIP LOCKED` and a one-minute lease. Save replays the same document and adapter. There is no automatic move to `DEAD_LETTER`. A failed job stays `FAILED` and can be claimed again when `next_attempt_at` is due. Status `meta.request_id` is a new id on each response. The outbox `dedupe_key` is the job identity.

`ops.save_statement_extraction` used to store the literal `v4` in `worker_metadata.parser_version` for every adapter. The run's `adapter_version_id` was already the authoritative version. The forward replace records the `adapter_version` of the adapter row that was used. A second production parser does not exist. The `test-only` registry row is a test adapter.

`core.financial_account.institution_id` is optional. Upload does not put an institution on the source record. Matching stays on `financial_account_id`. A null institution is not treated as a match and is not invented. No institution column was added.

On the disposable PostgreSQL 17 database after the suite, `M2.5-v1` had 28 disposition rows: 2 `LINKED_EXISTING`, 10 `MAPPED`, 2 `REJECTED`, and 14 `REVIEW_REQUIRED`. Both linked rows are strong under the M2.6 rule. None were conflicting, so no remediation write was applied and no historical row was remapped.

Production `OBJECT_STORAGE_*` credentials and a production ClamAV host are empty in `.env.example`. Local MinIO and local ClamAV do not verify production.
