# M0 Security Architecture

This is the control design for later phases. M0 does not add middleware, policies, or secrets.

Labels: **SOURCE_REQUIREMENT**, **ARCHITECTURAL_PROPOSAL**, **OPEN_DECISION**.

## Current exposure

Observed in the repository on 2026-10-10:

- Stub routes have no authentication (`services/api/src/app.ts`).
- `0001_init.sql` has no owner column and no row-level security.
- Compose defaults publish Postgres with user and password `monytix` (`.env.example`).
- API and intelligence share `DATABASE_URL` (CF-12).
- API logger is disabled. There is no redaction configuration.
- No Firebase project, no token check, no object-storage signing, no rate limit, and no idempotency store.

Those are gaps, not an acceptable production posture.

## Identity

**SOURCE_REQUIREMENT (D10 §23.1, D10-1 README):** `core.authenticated_actor` stores the external provider and subject. It stores no password, refresh token, or provider secret. `core.owner` is the financial tenant. `core.actor_owner_membership` says which actor may act for which owner.

**ARCHITECTURAL_PROPOSAL:**

| Control | Rule |
| --- | --- |
| Firebase ID token | The API verifies the Firebase ID token on every non-health route using Google's public keys. The client never sends a database user id as proof |
| Subject mapping | `sub` plus provider maps to `actor_id`. Unknown subject does not auto-join an existing owner |
| Revocation | Verify `exp`, `iat`, `aud`, and `iss`. Reject tokens whose `auth_time` or sign-in session Firebase reports as revoked. Cache revocation checks briefly. A failed check fails closed |
| Active owner | The client may send an owner id only as a selector. The API accepts it only when membership is active (OQ-01) |
| Service identity | Python and workers use their own credentials. They do not accept Firebase tokens from the public internet |

Health routes may stay unauthenticated and must return no tenant data. The current health payload meets that bar.

## User isolation and object ownership

**SOURCE_REQUIREMENT (D10 §11, AC-031, DB26):** RLS uses the authenticated actor, then membership, then `owner_id`. It does not use email or display name. Cross-owner reads of source, transaction, weight, and action rows are denied.

**ARCHITECTURAL_PROPOSAL:**

- Enable RLS on every owner-scoped table.
- Application roles do not bypass RLS. D10-1 states the migration owner bypasses RLS and must not be the application role.
- The API sets transaction-local `app.actor_id` and `app.owner_id` after verification, as D10-1 specifies. Setting those variables is not itself authentication.
- Global reference rows (institutions, merchant registry) contain no owner-private alias (D10 FD-07, DB37).
- Child rows without `owner_id` must have a foreign key to a parent that has it, and policies must join through that parent.
- Business legal entity data stays inside the business owner boundary (OQ-10).

## Internal service authentication

**ARCHITECTURAL_PROPOSAL:**

- Intelligence is not reachable from mobile clients (`docs/security/overview.md` already states this; the compose file currently publishes port 8000, which M1 must stop doing for any shared network).
- API-to-intelligence calls use a workload credential rotated outside git.
- The intelligence database role may select evidence it needs and may insert only into staging or interpretation tables granted to it. Canonical identity, money, and finalized M.I.L.E. inserts stay with the API role (CF-12).
- No endpoint accepts SQL text, a table name, or a filter AST from the client. MolyBot queries are parameterized application queries scoped by `owner_id` from the token, never from the prompt.

## Secrets

**ARCHITECTURAL_PROPOSAL:**

- Production secrets live in the host secret store used by Dokploy, not in git and not in `.env.example`.
- `.env.example` may list variable names. It must not gain real keys.
- Separate secrets for API database role, intelligence database role, migrator role, Firebase project, object storage, and FCM.
- The migrator role is used only by the migration job.

## Encryption

| State | Control |
| --- | --- |
| In transit | TLS for public API, database connections, object storage, and Firebase. Compose on a laptop may use the Docker network only for local development |
| At rest | Volume encryption on the VPS for Postgres and object storage. Application-level encryption for document bytes is optional defense in depth and is not a substitute for access control |
| Backups | Encrypted backups. Restore tests are a D10-0 exit gate. Backup files are not committed |

Statement bytes are not stored in PostgreSQL (D10 §19). Postgres holds the hash, the object key, and extraction metadata.

## Signed URLs

**ARCHITECTURAL_PROPOSAL:** upload and download of statements use short-lived signed URLs bound to `owner_id`, content type, and maximum size. The API issues them after auth. The client does not receive the storage credential. Download of a source document is an explicit privileged action and is not part of Live payloads (D10 AC-032).

## Financial write audit

**SOURCE_REQUIREMENT (D10 AC-029, Table 16):** material domain writes include an outbox row in the same transaction. Corrections are new rows. Finalized M.I.L.E. is not updated in place.

**ARCHITECTURAL_PROPOSAL:** each canonical write stores actor id, owner id, request id, idempotency key, and policy version. Audit rows are append-only. Support staff have no default read of raw narration.

## Rate limiting and idempotency

**SOURCE_REQUIREMENT (D10 `ops.idempotency_record`, F10 workbook NEG-01):** the same idempotency key commits one canonical transaction and one event chain.

**ARCHITECTURAL_PROPOSAL:**

- Per-actor limits on authentication attempts, uploads, and MolyBot questions.
- Idempotency-Key required on POST that creates money, decisions, missions, or corrections.
- Replay of the same key returns the original result. A key reused with a different body is a conflict, not a second insert.

## Device sessions and mobile token storage

**ARCHITECTURAL_PROPOSAL:** iOS stores Firebase tokens in the Keychain. Android uses the encrypted credential store Jetpack documents recommend for auth tokens, not SharedPreferences. The M0 native shells do neither, because they do not authenticate yet. Do not add a custom token file. FCM registration tokens are device addresses, not financial secrets, and are still owner-scoped.

`mobile.zip` is missing, so no Flutter secure-storage choice is made (CF-11).

## Logging redaction

**ARCHITECTURAL_PROPOSAL:** structured logs. Deny-list narration, account numbers, card numbers, VPA, email body, Firebase token, authorization header, and signed URLs. Log owner id and request id. The API's current `logger: false` is not a redaction design. M1 turns logging on with the deny-list.

## Deletion and retention

**SOURCE_REQUIREMENT (D10 §11):** authorized erasure uses invalidation and tombstone behavior required by F10A and F10L. Legal retention is an external policy. Hard delete is governance-only (D10 Table 9).

**ARCHITECTURAL_PROPOSAL:** a deletion request disconnects the source, tombstones owner-scoped rows, and deletes object bytes after the retention decision. Live snapshots can expire without touching the ledger (D10 DB38). Another owner's rows are untouched. Global merchant reference rows stay if they contain no private observation.

## Least privilege

| Role | Allowed |
| --- | --- |
| `monytix_api` | DML on canonical and action tables for the RLS owner. No DDL |
| `monytix_intelligence` | Select masked evidence. Insert interpretation staging only if CF-12 grants it. No DDL. No raw credential tables |
| `monytix_migrator` | DDL during a release window. Not used by request handlers |
| `monytix_readonly` | Current views for support, still under a break-glass grant, not a standing bypass |

The compose superuser `monytix` is a local bootstrap account. It is not a production application role.

## MolyBot

**SOURCE_REQUIREMENT (B10I §14, D10 Table 11):** explanations come from stored reason structures. They do not invent causes.

**ARCHITECTURAL_PROPOSAL:** the model receives a server-built context for the authenticated owner only. The prompt is not a query language. Tool calls are allow-listed functions with owner id bound server-side. Output is checked so it does not echo raw account numbers. A question about "this user's" data cannot widen the owner. There is no tool that runs arbitrary SQL.

## What M1 must implement before any financial row exists

1. Firebase verification and revocation handling.
2. Separate database roles.
3. RLS on the first owner-scoped tables, using D10-1 patterns.
4. Idempotency table before the first POST that writes money.
5. Redacted logs.
6. Secrets outside git.
7. Intelligence port unpublished on shared networks.

Until those exist, the stub API must not be pointed at real bank files.
