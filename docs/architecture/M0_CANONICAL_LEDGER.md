# M0 Canonical Ledger

No DDL from this document is approved for execution. `database/migrations` was not changed.

Labels: **SOURCE_REQUIREMENT**, **ARCHITECTURAL_PROPOSAL**, **OPEN_DECISION**.

## 1. Authority

| Domain | Binding source | What it freezes |
| --- | --- | --- |
| Personal persistence | D10 v1.2 FINAL FREEZE, especially §1, §3–§5, §11, §23, FD-01–FD-08 | Eight schemas, one logical transaction, immutable versions, owner RLS |
| Personal intake | F10A v1.3 FINAL FREEZE | Source evidence and canonical normalization |
| Personal structure | F10B v2.0 FINAL FREEZE | Rails, identifiers, structural identity |
| Personal meaning | F10C v1.2, F10D v1.2, F10E v1.2, F10F v1.2 | Party, event, taxonomy, semantics |
| Business persistence | B10Q v1.1 V001–V030, then v1.3 V031–V040. Do not apply the v1.2 filenames that reuse V026–V031 (B10Q v1.3 §2) | Business stage schemas and decision visibility |
| Business event | B10D v1.1 | Canonical financial event object |
| Business intake | B10A v1.1, B10B v1.1, B10B.1 narration registry, B10C v1.1 | Ingestion, parsing, normalization |

**SOURCE_REQUIREMENT (D10 §1):** one authoritative storage path per domain truth. A transaction must not exist as competing truth in `monytix.transactions`, `spendsense.txn_fact`, `txn_enriched`, `txn_parsed`, and rulebook output.

**SOURCE_REQUIREMENT (D10 §5, Table 8):** `core.logical_transaction` is created once per economic transaction. `core.canonical_transaction_version` is append-only. Reprocessing creates versions. Corrections are new rows. Cross-source observations attach through `transaction_evidence_link`.

**SOURCE_REQUIREMENT (D10 §11):** `owner_id` is the financial-context boundary. `owner_type` may be `PERSON` or `BUSINESS` without a schema rewrite. Actor and owner are different. RLS uses actor → membership → owner. Raw narration, VPA, account, and card values stay off Live APIs.

**SOURCE_REQUIREMENT (D10 Table 9):** money is `NUMERIC(20,4)` plus `CHAR(3)` currency. Direction is `IN`, `OUT`, or `UNKNOWN`. Amount is positive. New vNext keys are UUIDv7 (FD-02).

The repository file `database/migrations/0001_init.sql` does not implement any of the above. It is a conflicting stub, not the canonical ledger.

## 2. Required conceptual flow

The M0 brief and the frozen documents describe the same direction of travel. Personal and business do not share identical stage logic.

```
SOURCE
  → RAW EVIDENCE          (immutable)
  → PARSING               (versioned structure)
  → NORMALIZATION         (versioned canonical primitive)
  → CANONICAL FINANCIAL EVENT
  → COUNTERPARTY
  → FINANCIAL EVENT CLASSIFICATION
  → CATEGORY / PURPOSE
  → SEMANTICS / SAFETY
  → EVIDENCE / PATTERNS
  → FINANCIAL WEIGHTS
  → FINANCIAL STATES
  → DECISIONS
  → MISSIONS / ACTIONS
  → OUTCOMES
  → M.I.L.E.
  → PROJECTIONS / LIVE
```

| Stage | Personal authority | Business authority | Writer |
| --- | --- | --- | --- |
| Source connection, batch, document bytes | F10A, D10 `core.source_*` | B10A, B10Q `ingest` | Node API accepts the upload/connection and stores the immutable pointer. Python does not create a second document row |
| Extraction / parse | F10B; parser v4 is a salvage engine, not the table owner | B10B / B10B.1 | Python produces a versioned parse result. Node commits it |
| Normalization | F10A canonical field contract | B10C | Python proposes. Node commits `canonical_transaction_version` or the business normalize row that points at the same logical id |
| Canonical event identity | D10 `core.logical_transaction` | B10D / B10Q `canonical` | **OPEN_DECISION CF-01.** Proposal below |
| Party | F10C | B10E | Python resolution, versioned |
| Event family | F10D precedence P0–P6 | B10F / B10F1 | Python. Never a first-match overwrite |
| Category and purpose | F10E, separate from event | B10F | Python. Cannot overwrite event truth |
| Semantics and safety | F10F | B10G | Python usability flags. Does not rewrite upstream truth |
| Evidence, patterns, weights, states | F10G, F10H, F10J | B10H, B10I, B10J | Python computes. Node persists the version the service returns inside one transaction with the outbox row |
| Decisions, missions, outcomes, M.I.L.E. | F10I | B10K–B10N | Python evaluates. Node is the only process that inserts the authoritative lifecycle row |
| Projections | F10K `experience.live_*` rebuildable | B10O `projection` | Rebuildable. Never source of truth |

**ARCHITECTURAL_PROPOSAL — write boundary:**

- Node owns external authentication context, idempotency keys, object-storage pointers, and the database transaction that inserts canonical rows and the outbox row together.
- Python owns deterministic computation. It returns versioned results. It uses a database role that cannot insert into identity, canonical amount, or M.I.L.E. finalization tables.
- Neither service computes a private copy of the ledger and upserts it under another name.

This proposal is how the stack brief and D10 §18 ("avoid business-classification stored procedures that hide F10 logic") fit together. It is not a reason to edit the frozen F10 rules.

## 3. Proposed identity spine

**ARCHITECTURAL_PROPOSAL (does not authorize DDL):**

Use D10 `core` as the only identity and evidence spine for both owner types, because D10 §11 and FD-07 already say PERSON and BUSINESS share the owner model and share non-private reference data, while owner-specific observations stay isolated.

Proposed relationship, using D10 names:

```
core.owner
  └── core.actor_owner_membership
  └── core.financial_account
        └── core.account_ownership
        └── core.financial_account_instrument
  └── core.source_connection
        └── core.source_batch
              └── core.source_document          -- immutable bytes live in object storage
                    └── core.extraction_run
                          └── core.source_record
                                └── core.transaction_evidence_link
                                      └── core.logical_transaction
                                            └── core.canonical_transaction_version
```

Business B10Q tables that today look like a second ledger (`ingest`, `parse`, `normalize`, `canonical`) should, when M1 is allowed, either:

1. become views or compatibility names over the D10 `core` chain, or
2. keep their columns but add a required `logical_transaction_id` foreign key and a uniqueness constraint so a business canonical row cannot exist without the spine.

**OPEN_DECISION CF-01:** B10Q v1.1 was frozen as its own schema set before this repository existed. Forcing those tables into eight D10 schemas without a mapping signed by both contracts would silently merge specifications. M1 must publish a column-level mapping and stop if a business column has no D10 home. Until that mapping exists, do not apply either pack.

Personal interpretation stays in D10 `intel`, `evidence`, `context`, `action`, `experience`. Business interpretation stays logically in the B10E–B10O families (`party`, `classify`, `semantic`, `pattern`, `weight`, `state`, `decision`, `mission`, `outcome`, `mile`, `projection`). Those families must reference `logical_transaction_id` (or the business event id that is constrained 1:1 to it). They must not store a second amount as economic truth.

## 4. Invariants

| Invariant | Source | Physical rule to preserve |
| --- | --- | --- |
| One economic identity | D10 Table 8, AC-007 | `logical_transaction_id` stable across replay unless an audited split or merge |
| Immutable evidence | D10 §1, AC-006 | `source_document` not updated to mimic a correction. Bytes addressed by hash and object key |
| Versioned interpretation | D10 Table 8, AC-009, AC-011 | New rows for parse, party, event, category, purpose, semantic. Each stores upstream version ids and policy versions |
| User scope | D10 §11, AC-031 | `owner_id` on the row or on an enforced parent. RLS denies other owners |
| Provenance | D10 Table 11 | Tier-1 foreign keys plus `ops.lineage_edge`. Live reason tokens do not carry raw PII |
| Duplicate detection | D10 DB01, DB02, Table 22 | Idempotency is source hash / provider id scoped by owner, source, and account. Amount+date+narration is not a unique key (AC-034, DB05) |
| Reprocessing | D10 DB03, §13 | New extraction and canonical versions. Head pointer moves only in the same commit as the version that becomes current (FD-03) |
| Historical correction | D10 Table 8, F10D corrections | `financial_event_correction` / taxonomy correction. Original event family is not mutated (DB14) |
| Auditability | D10 AC-029, AC-041 | Outbox in the same transaction. Any Live item can be traced to evidence |
| No double counting | F10D § on analytics treatment; D10 DB12, DB13, DB22 | Event analytics treatment is explicit. M.I.L.E. and impact use a dedupe key |
| Deterministic money | D10 Table 9; F10I | Positive amount, separate direction, `NUMERIC(20,4)`, policy version on every derived figure |

Current state is a pointer or head, not a rewrite of history (D10 §7, Table 10). `intel.transaction_intelligence_head` is rebuildable (DB33).

## 5. Special cases

These behaviors are specified. M0 does not restate every threshold.

| Case | Source rule | Ledger effect |
| --- | --- | --- |
| Own-account transfer | F10D `INTERNAL_TRANSFER` with F10C SELF / JOINT_SELF and owned endpoints. Analytics `INTERNAL_MOVEMENT` / `EXCLUDE_FROM_INCOME_EXPENSE`. D10 DB13 | One logical transaction per leg only if they are not the same economic movement. Pair through `financial_event_relationship`. Do not count as income or expense |
| Credit-card bill payment | F10D `CREDIT_CARD_PAYMENT`. Not a second merchant expense when card purchases exist. `card_detail_coverage_status` and `spend_proxy_treatment` are analytics metadata and do not change event truth. D10 DB12. F10F ordinary-spend eligibility is `INELIGIBLE` when underlying purchases are present | Liability movement. Purchases remain the spend facts |
| EMI | F10D `LOAN_REPAYMENT` / `EMI`. Component split only when the source provides separable amounts (D10 DB15) | Obligation event. Do not invent principal versus interest |
| Investment transfer | F10D `INVESTMENT`, `INVESTMENT_PROCEEDS`, `INVESTMENT_INCOME` at P2/P3 before generic income | Asset movement versus economic return stay distinct |
| Refund | F10D P0 `REFUND_REVERSAL`. Relationship `REFUND_OF` when matched. D10 DB14. F10 workbook EDGE-07 / NEG-09: unmatched refund stays observed, no fake purchase | Linked reversal adjusts analytics. It does not rewrite the original family |
| Reversal / chargeback / failed transaction | F10D subtypes `REVERSAL`, `CHARGEBACK`, `FAILED_TXN_REVERSAL`. F10 workbook EDGE-02: failed transaction is not a completed weight input | Corrective relationship. No completed-spend weight |
| Duplicate UPI | D10 DB01 and source idempotency. Same RRN plus owner plus account context converges. Repeated identical small amounts without a strong id stay distinct (DB05) | Evidence links, not a second logical id, when identity is strong |
| Re-imported statement | D10 DB02, statement overlap via `statement_link` | New document and extraction. Same logical transaction when equivalent |
| Conflicting sources | F10F keeps a confidence vector per dimension. Unknown is valid. F10D: contradictory high-quality evidence can block a candidate; a lower precedence band does not win by number alone | Semantic status `READY_WITH_LIMITATIONS` or exception. No silent winner |
| User classification override | F10D `financial_event_correction`, F10E `taxonomy_correction`. F10F does not hide an override inside semantics. D10 DB10, DB11 | Scoped correction with effective period. Replay downstream only in scope. Source row unchanged |

**SOURCE_REQUIREMENT (F10D):** unknown is valid. Do not force `TRANSFER_IN` / `TRANSFER_OUT` because direction is known. Keyword presence is supporting evidence, not proof of salary, EMI, or insurance.

**SOURCE_REQUIREMENT (F10G):** missing coverage yields `INSUFFICIENT_DATA`, `LIMITED`, or `NOT_APPLICABLE`. It does not become zero spend or "unpaid". Absence is not provable without coverage (`ABSENCE_NOT_PROVABLE`).

## 6. What is deliberately not the ledger

| Object | Role |
| --- | --- |
| Parser `txn_parsed` | Salvage output shape. Not canonical truth (D10 Table 19) |
| Rulebook `txn_rulebook_output` | Candidate catalogue. Must be split into party, event, and taxonomy resolutions |
| `experience.live_*` and B10O projections | Disposable reads (D10 Table 18, AC-027) |
| Personal W1–W10 and business BW01–BW04 | Assessments. Not a rewritten transaction |
| M.I.L.E. | Outcome ledger. Activity does not earn M.I.L.E. (F10I). Finalized rows are adjusted by `mile_adjustment_event`, not updated in place (D10 AC-025) |
| Journey and reward points in the F10 xlsx | See CF-02. D10 Table 19 retires rewards and journey as personal-v1 runtime dependencies. They are not part of this ledger until that conflict is closed |

## 7. Migration strategy

**SOURCE_REQUIREMENT (D10 Table 20, FD-06):** waves D10-0 through D10-10, idempotent, with checkpoints. D10-0 is inventory only. Destructive drop is D10-10 and only after retention and sign-off (AC-038).

**ARCHITECTURAL_PROPOSAL for this repository, still not executed:**

| Step | Action | Rollback |
| --- | --- | --- |
| 0 | Leave `0001_init.sql` in place. Do not point new code at `public.transactions` | n/a |
| 1 | Add a new migration stream whose first file is a reviewed copy of D10-1 only, after PostgreSQL 17 is confirmed. D10-1 states it does not touch legacy schemas | Forward-fix. D10-1 is foundation-only |
| 2 | Stop. Column-map B10Q `ingest`/`canonical` onto D10 `core` (CF-01) before D10-2 or B10Q V004–V007 | Do not start dual-write |
| 3 | Later waves follow D10-2…D10-6 for personal and the mapped B10 tables for business | Restore service routing to the previous migration ledger checkpoint. Do not delete archived sources (D10 §23.1 migration identity) |
| 4 | Parser, UPI, and rulebook SQL are reference seeds into `ref` registries after golden tests. They are not applied as their original `txn_*` schemas | Registry version row can be deactivated. Historical resolutions remain |

`0001_init.sql` running from `docker-entrypoint-initdb.d` is a foot-gun: a fresh volume creates the stub ledger. M1 should stop using initdb auto-run for application DDL and use an explicit migrator. That change is not made in M0.

## 8. Ownership matrix

| Table family | Owning contract | Runtime writer of record | Reader |
| --- | --- | --- | --- |
| `core.owner`, actor, membership | D10-1 | Node, after Firebase verification | Both services under RLS |
| `core.source_document` and bytes pointer | F10A / D10 | Node | Python extraction role, masked |
| `core.logical_transaction`, canonical version | F10A / D10 | Node, from Python normalization output | Intelligence read role |
| `intel.*` resolutions | F10B–F10F | Node commits Python output | API read models |
| Business party through projection | B10E–B10O | Node commits Python output | Business API |
| `ops.domain_event_outbox`, replay, idempotency | D10 §13 | Node in the same transaction as the domain write | Workers |
| `experience` / `projection` | F10K / B10O | Projection worker | API read |

Python using a superuser or the table owner role is forbidden, because D10-1 notes that the migration owner bypasses RLS.
