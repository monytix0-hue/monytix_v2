# M2.4 parser test matrix

Status: local adapter run on 2026-10-10. Command, from `services/api`, with disposable PostgreSQL 17, MinIO, and ClamAV:

`npm test`

Result: **39 pass, 0 fail**. Production R2 and production ClamAV were not part of this run.

## A. Eligibility

| Case | Expected | This slice |
| --- | --- | --- |
| Clean sealed CSV with SHA-256 and `SCAN_CLEAN` | Extraction run and source rows | Local pass |
| Unscanned document | `enqueue_statement_extraction` returns `ineligible` | Local pass |
| Infected document | Not enqueued | Not run as its own extraction case. The scanner still rejects EICAR before enqueue |
| Missing object | Job retries | Not run |
| Tampered object | `OBJECT_TAMPERED` | Not run |
| Wrong owner | No public parse route. Status read stays owner-scoped | Local pass for the missing route |

## B. Parser

| Case | Expected | This slice |
| --- | --- | --- |
| UPI dash narration in a CSV | `PARSED`, channel `UPI`, reference stored | Local pass |
| Unmatched narration | `PARTIAL` and `NO_FORMAT_MATCH` | Local pass |
| PDF object | `FAILED` / `UNSUPPORTED_FILE_LAYOUT` | Local pass |
| XLS and XLSX objects | Unsupported layout | Not run |
| Invalid date or amount | Preserved as supplied text, not coerced | Not run |
| Parser exception | Job retries | Not run |

## C. Job reliability

| Case | Expected | This slice |
| --- | --- | --- |
| Second save for the same adapter version | `replay`, one run | Local pass |
| Concurrent workers | One run | Not run |
| Worker crash and lease reclaim | Job claimable after one minute | Not run |
| Parser version change | New run, old run kept | Not run |

## D. Data integrity

| Case | Expected | This slice |
| --- | --- | --- |
| Extraction run and source record linked to the document | Present | Local pass |
| Parser version `v4` | `worker_metadata.parser_version` | Local pass |
| No second source row on replay | One run | Local pass |
| No logical transaction or evidence link | Zero evidence links for the run | Local pass |
| `txn_fact` and `txn_parsed` | Absent | Local pass |

## E. Security

| Case | Expected | This slice |
| --- | --- | --- |
| `POST /v1/imports/{id}/extract` | 404 | Local pass |
| `monytix_intelligence` execute on save | Denied | Local pass |
| Public object URL for the final key | Not issued | Local pass by the M2.3B seal |
| Narration written to logs | Not written by the worker | Local pass by inspection of `extract.ts` |
