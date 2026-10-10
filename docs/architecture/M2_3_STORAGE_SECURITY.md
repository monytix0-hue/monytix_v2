# M2.3A storage security

Status: proposed controls for the F9H-089 v1.1 amendment. Not implemented.

The storage interface is private S3-compatible storage, as recommended in `docs/decisions/M2_3_OQ12_STORAGE_DECISION.md`. That recommendation is not approved. No bucket is created by this document.

## Private bucket

- Block public ACLs and public policies.
- No `s3:GetObject` for an anonymous principal.
- The API credential can put an object only under the prefix it generated, and only during initiation.
- The API credential can read and delete that object for confirmation, expiry, and a later authorized download.
- A worker credential, when M2.4 exists, can read one object. It cannot put, delete, or list the bucket.
- Listing the bucket is not granted to the mobile client.
- Access logs may record the key and the result. They must not record the object body.

## Object key

The server generates the key:

`owners/{owner_id}/imports/{import_id}`

`owner_id` and `import_id` are server UUIDs. The original filename is stored on `core.source_document.original_filename` and is not part of the key. The client cannot supply a prefix, a traversal segment, or a key that names another owner.

The object is written once. Confirmation records the storage etag and the byte size on the document metadata. A later read that finds a different etag or size fails the import and does not parse the replacement.

## Upload authorization

Initiation returns an upload-only signed request.

- Lifetime is 15 minutes.
- The signature covers the key, the content type, the declared SHA-256, and the maximum size of 10 MiB.
- The client cannot reuse the grant for another key or another checksum.
- The grant is not a download URL.
- A confirmed document is not readable through that grant.
- A download, if a later phase allows one, is a separate short-lived grant after an owner check. It is not embedded in Live payloads (D10 AC-032).

## Verification

Confirmation reads the object with the server credential.

| Check | Failure |
| --- | --- |
| Object exists at the reserved key | `EXPIRED` if the grant has lapsed, otherwise `FAILED` with the object missing |
| Size equals the declared size and is at most 10 MiB | `FAILED` |
| Magic-byte signature matches `file_type` | `FAILED`. PDF begins with `%PDF-`. ZIP-based XLSX is a ZIP local header. XLS is the OLE compound header. CSV is text without a binary signature and is accepted only when the bytes are valid UTF-8 or UTF-8 with a BOM and contain no NUL |
| SHA-256 of the bytes equals the declared `sha256` | `FAILED` |
| Etag and size still match on any later read | `FAILED`. The replacement is not treated as the confirmed statement |

Declared `Content-Type` is checked against `file_type`. The observed type comes from the signature check, not from the client header alone.

## Malware scan

F9 requires a malware scan before statement processing. No scanner product is named, so none is selected here.

A verified object stays `core.source_document.status = RECEIVED` with reason `MALWARE_SCAN_PENDING`. It is not set to `AVAILABLE`. The outbox event `IMPORT_SESSION_CREATED` may record that the object was registered. A parser consumer must not claim the event until a scan result says clean.

If a scan later reports malware, the object is deleted or quarantined, the document becomes `FAILED`, and the bytes are not parsed. The scanner choice is an open approval.

## Encryption and transport

- The client and the API use TLS to the storage endpoint. Local Compose may use the Docker network only on a developer machine.
- The storage service encrypts objects at rest. Application-level encryption is not required for M2.3B and is not a substitute for the private bucket.
- No statement password is collected, logged, or stored. `PASSWORD_REQUIRED` is left for a later parser.

## Temporary files

If confirmation must spool the object to compute the hash and the signature, the spool is created by the server in a private temp directory, is unlinked before the request returns, and is never named from user input. The spool is not the system of record. PostgreSQL does not hold the bytes.

## Retention and orphans

No retention period is source-defined. This phase does not delete a confirmed statement.

Unconfirmed objects are orphans. A sweeper, after the grant expires:

1. Deletes the object if the document has no confirmed hash.
2. Sets the import to `EXPIRED`.
3. Does not write a logical transaction.

A confirmed document that is later erased uses the existing status `ERASED_REFERENCE_ONLY`. The byte-deletion policy for that status waits for an approved retention decision.

## Audit

The audit record is `ops.outbox_event`. There is no second audit table. The payload may contain `import_id`, `source_document_id`, `owner_id`, `file_type`, `byte_size`, and `sha256`. It must not contain the object body, the filename, account numbers, or a URL.

## Logging denylist

Logs, traces, and error strings must not contain:

- Statement contents or extracted lines
- Account numbers
- Access tokens, refresh tokens, or storage credentials
- Signed URLs or their query strings
- Full financial narrations
- Uploaded or statement passwords
- The raw `source_metadata` object when it may echo a narration or an account number

A log line may contain `request_id`, `import_id`, `owner_id`, `file_type`, byte size, and the error code.
