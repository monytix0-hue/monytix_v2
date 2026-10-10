# M2 ingestion security

M1 authentication and roles stay in force. This slice does not weaken them.

## Who can read

| Data | Boundary | Policy |
| --- | --- | --- |
| Source connection, batch, document, document set, statement, extraction run, source record, balance snapshot, coverage | Acquisition `owner_id` equals `ops.current_owner_id()` | SELECT policies in D10-2 |
| Logical transaction, canonical version, evidence link | Active `core.account_ownership` for the current owner | SELECT policies in D10-2 |
| Application roles | `monytix_api` and `monytix_intelligence` are `NOBYPASSRLS` | Confirmed again by `database/verification/m2_1_rls.sql` |

A second owner does not read the first owner's logical transaction. Joint visibility, when it exists, is an active ownership row on the same financial account. M2.1 does not invent a shared-account API.

## Who can write

D10-2 does not create INSERT or UPDATE policies. `0005_m2_1_read_grants.sql` grants SELECT to `monytix_api` only.

`monytix_intelligence` has INSERT, UPDATE, and DELETE revoked on every D10-2 table. Python cannot commit canonical amount or identity. The intelligence process remains the internal health endpoint.

Neither service writes `public.transactions`.

There is no password column on connection, batch, document, or extraction tables. Provider secrets are not stored in these rows.

## Later slices, not built here

| Control | Slice | Current state |
| --- | --- | --- |
| Signed upload and download | M2.3 | OQ-12. No vendor, no signer, no local bucket |
| File size and content checks | M2.3 | `size_bytes` and mime columns exist. No checker is running |
| Malware scan | M2.3 | Named by the M0 master plan. No scanner is configured |
| Worker authentication | M2.4 | No parser worker exists |
| Narration redaction | Already in the API logger | Deny-list includes `rawDescription`, `narration`, `accountNumber`, `vpa`, `token`, `signedUrl` |

Logs must not gain a path that prints `raw_description` or source payloads. Health responses stay free of tenant data.
