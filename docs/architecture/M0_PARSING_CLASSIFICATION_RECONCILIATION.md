# M0 Parsing and Classification Reconciliation

M0 does not rewrite parser, UPI, or rulebook engines and does not load their SQL.

Labels: **SOURCE_REQUIREMENT**, **ARCHITECTURAL_PROPOSAL**, **OPEN_DECISION**.

## 1. Existing rules inventory

| Artifact | Location in `frs/` | Generation | What it contains | Runtime status in this repo |
| --- | --- | --- | --- | --- |
| Parsing framework v4 SQL | `transaction parsing files 2.zip` → `txn_parsing_framework_v4.sql` | Latest parser SQL | Consolidated pipeline | Not installed. EXISTING_UNVERIFIED |
| Parsing v4 reference | same zip, `txn_parsing_framework_v4_reference.docx` | Narrative for v4 | Formats, scoring, error codes, views | Read for this reconciliation |
| Parsing v3.2, v3.1, v3, v2 SQL and v2 design, v3.1 RTF | same zip | Historical | Superseded shapes | Do not execute (CF-16) |
| UPI classifier v3 SQL | `UPI Classifer files.zip` → `upi_classifier_v3.sql` | Later SQL than the design doc | Not line-diffed in M0 | Not installed |
| UPI classifier v2 SQL, `UPI_Classifier.txt`, v2 design | same zip | v2 design says 22/22 signals and config-driven weights | Design read | Not installed |
| UPI rulebook reference v1 | `Rulebook Classification.zip` | Narrative of enrich → rulebook → `txn_enriched` | Tiers, confidence bands | Reference only |
| Transaction classification rulebook docx | same zip | Large rule narrative | Not fully table-extracted in M0 | Reference only |
| Rulebook SQL `v1/` and `v2/` plus `files/monytix_engine.sql`, `monytix_schema.sql`, `monytix_seeds.sql` | same zip | v1 and v2 schemas/seeds/engine | Duplicate names across `files/` and `v2/` | Not installed |
| Personal event rules | F10D v1.2 FINAL FREEZE | Functional precedence, not the SQL engine | P0–P6 families | Authoritative for personal meaning |
| Personal taxonomy | F10E v1.2 FINAL FREEZE | Category, subcategory, purpose | Separate from event | Authoritative |
| Business classification | B10F, B10F1 v1.0 | Business domain and purpose registry | Separate from personal F10E | Authoritative for business |
| Business narration | B10B.1 NAR01–NAR50 | Current-account narration families | Feeds B10B | Authoritative for business statement lines |
| MoneyMoments enrichment notes | Habits FRD | Merchant alias and override precedence for habits | Downstream of classification | Not an event engine. See CF-08 |

Repository Python modules `app/parsing/parser.py`, `app/upi/parser.py`, `app/rulebook/rules.py`, and `app/classification/classifier.py` return stubs. Pytest on 2026-10-10 confirmed the stub status. They are not these engines.

## 2. Rule precedence

### 2.1 Parsing

**SOURCE_REQUIREMENT (v4 reference):** one consolidated v4 file. v2 positional `matched_pattern_id` is unused (NULL).

Pipeline in the reference:

1. `populate_txn_parse_stage_v3` reads `txn_fact`, detects channel and format, tokenises.
2. `populate_txn_parsed_v3` routes to a classifier and fills `txn_parsed` plus `parse_error_reasons[]`.
3. `populate_txn_parse_unknown_queue_v3` queues `PARTIAL` / `UNPARSED`.

Scoring inside `fn_classify_tokens` (v4 reference): base score from `match_regex` confidence, semantic bonus from `fn_token_features_v31`, position bonus from `txn_field_position_bias` with no penalty for a miss, noise penalty from `txn_token_noise_registry`, mismatch penalty for cross-semantic collisions.

NACH does not use `fn_classify_tokens`. It uses `fn_parse_nach` after prefix stripping. ATM withdrawal dash format uses regex rather than the token scorer.

**ARCHITECTURAL_PROPOSAL:** this order is the algorithm order. The table names are legacy (CF-03). The persisted object is an `intel.transaction_structure` version that records format id, token assignments, scores, and `parse_error_reasons`.

### 2.2 UPI entity type

**SOURCE_REQUIREMENT (UPI v2 design, cascade checks):**

1. Major-handle registry match → `MERCHANT`, scoring skipped.
2. If no score meets its threshold → `UNKNOWN_MERCHANT`, and the rulebook may continue.
3. Otherwise the highest score above its own threshold wins (`vw_upi_entity_final`, max-score-wins). The design's later checks include `SMALL_MERCHANT` at a 55 threshold in the extract.

Signals are rows in `ref_upi_classifier_config`, not hardcoded weights. Provider weights live in `ref_upi_provider_type`. Person and merchant examples in the design show v2 splitting flags that v1 had merged, so QR types are not double-counted (Paytm QR, BharatPe only if Paytm is absent, other QR only if neither).

**OPEN_DECISION OQ-05 / CF-15:** v3 SQL was not diffed signal by signal. Do not assume v3 preserved this cascade.

### 2.3 Personal financial meaning

**SOURCE_REQUIREMENT (F10D v1.2):** event family is decided before generic merchant category.

| Band | Families in the F10D extract | Role |
| --- | --- | --- |
| P0 | `REFUND_REVERSAL`; proven `INTERNAL_TRANSFER` / sweep; duplicate and void implications | Stops false income, expense, and double counting |
| P1 | `LOAN_REPAYMENT`, `CREDIT_CARD_PAYMENT`, `INSURANCE`, `TAX_GOVERNMENT` | Obligations that look like generic debits |
| P2 | `BORROWING`, `INVESTMENT`, `INVESTMENT_PROCEEDS`, `INSURANCE_PAYOUT` | Stops disbursals and redemptions being called income |
| P3 | `INCOME`, `INVESTMENT_INCOME` | Economic inflow only with evidence |
| P4 | `CASH_MOVEMENT` | ATM / cash is not automatically spend |
| P6 | `PERSON_TRANSFER` | Neutral unless stronger evidence exists |

A lower band number does not win unless its evidence threshold is met. Contradictory strong evidence can block a candidate. `counterparty_scale_hint` cannot independently set a family and cannot outrank P0–P2.

Then F10E assigns category and purpose without changing the event. F10F builds a confidence vector and per-use eligibility (`ELIGIBLE`, `LIMITED`, `INELIGIBLE`). F10F must not collapse dimensions into one probability.

User corrections are separate rows (`financial_event_correction`, `taxonomy_correction`). They outrank system output for the scoped field and period. They do not rewrite source text.

### 2.4 Rulebook SQL versus F10D

**SOURCE_REQUIREMENT (UPI rulebook reference):** tiered path from structural match, scoring, then keyword and wildcard fallbacks. Examples in the extract: ATM cash at high confidence, self-transfer and person rules in a transfer band, `TRF_999` wildcard at 0.40, employer match at 0.99 for salary. Output is one `txn_rulebook_output` row with a single `confidence_score`.

**SOURCE_REQUIREMENT (D10 Table 19):** do not retain that first-match monolith. Split entity identity to F10C, event rules to F10D, and category rules to F10E.

**ARCHITECTURAL_PROPOSAL:** rulebook seeds become `ref` registries with policy versions. Precedence at runtime is F10D then F10E then F10F, not rule-code numeric order. A rulebook wildcard must not fire when an upstream family is already `UNKNOWN` for lack of evidence. Unknown stays unknown (F10D).

Salary, EMI, credit-card payment, insurance, and investments are F10D families, not categories that a keyword may force. The employer-match signal is allowed as evidence for `INCOME` / `SALARY` only when the user-specific employer link is already confirmed (`user_employer_match` in the rulebook reference). A name similarity alone is not that link.

### 2.5 Business

Business narration (B10B.1 NAR01–NAR50) interprets the statement line. B10F / B10F1 assign business domain and purpose. B10G may enrich only inside safety rules: a credit is not revenue, a debit is not an expense, a cash deposit is not revenue, a loan disbursement is not revenue, and a SELF or sweep movement is neither income nor cost (Business Master safety boundary, also B10Q v1.3).

Business classification does not reuse personal W1–W10 or personal D1–D30 codes (CF-06, CF-07).

## 3. Source of truth

| Question | Source of truth | Not the source of truth |
| --- | --- | --- |
| How a narration is tokenised | Parser v4 reference and v4 SQL | v2 design, v3.1 patch, repository `parse_statement` stub |
| UPI person / merchant / small-merchant signals | v2 design until the v3 diff is accepted (OQ-05) | v1 behavior described only as history inside the v2 doc |
| Personal event family | F10D v1.2 | Rulebook first match, category keyword |
| Personal category and purpose | F10E v1.2 | F10 workbook "26 / 145" sentence (CF-10) |
| Whether a transaction may feed a metric | F10F use-eligibility | A single confidence float |
| Business line meaning | B10B.1 then B10F1 | Personal taxonomy |
| Where rows are stored | D10 for personal, mapped B10Q after CF-01 | `txn_parsed`, `txn_rulebook_output`, `public.transactions` |

## 4. Version conflicts

| Topic | Older | Later | M0 treatment |
| --- | --- | --- | --- |
| Parser | v2, v3, v3.1, v3.2 | v4 consolidated | Use v4 algorithms only |
| UPI | v2 design and SQL | v3 SQL | Diff required before either runs |
| Rulebook files | `v1/*.sql` | `v2/Rulebook_*.sql` and `files/monytix_*.sql` (same sizes as v2 in the extract listing) | Treat `files/` and `v2/` as one generation pending a checksum. Do not load v1 as well |
| Personal classification docs | Any pre-freeze draft inside the personal bundle that is not marked FINAL FREEZE | F10C/D/E/F v1.2 FINAL FREEZE | Freeze wins |
| Business parsing | B10A/B/C unversioned siblings in the same folder | `*_v1.1` files | v1.1 wins where both exist |
| B10Q DDL | v1.0, v1.1, v1.2 filenames | v1.3 document | v1.1 then v1.3 V031–V040 (CF-09) |

## 5. Migration requirements

Not executed.

1. Do not add parser, UPI, or rulebook SQL to `database/migrations` in their current schemas.
2. After CF-01, create versioned `ref` tables for format registry, token noise, field schema, UPI handles, UPI signal config, and event/taxonomy rules. Seed from v4 and the reviewed UPI/rulebook catalogues.
3. Each resolution row stores `policy_version` (D10 Table 15).
4. Reprocess by owner and source batch. New `extraction_run` and new structure/event versions. Same `logical_transaction_id` when identity holds (D10 DB03, DB09).
5. Idempotency key is owner + source connection + source record hash or provider id (D10 Table 13). Parser error rows are still evidence. They are not dropped silently.
6. Partial parses persist `parse_error_reasons` and status. They do not become `READY` canonical transactions (D10 DB06: unresolved account cannot become READY).

## 6. Missing tests

The v4 reference names quality views (`vw_txn_parse_quality_kpi`, pattern coverage, direction anomalies). Those views are not in this repository and were not executed.

No test in `services/intelligence/tests` covers a format, an error code, a VPA, or a precedence band. The 15 passing pytest cases assert stubs only.

Required before any engine is called production:

| Area | Minimum evidence |
| --- | --- |
| Parser | One fixture per v4 channel in the reference: UPI, IMPS, NEFT, ACH, NACH, ATM, POS, CARD_BILLPAY, OTHER subtypes including EMI and truncated |
| Error codes | `NO_FORMAT_MATCH`, `LOW_CONFIDENCE`, `NO_RRN`, `NO_NAME`, `NO_VPA`, `NO_ENTITY`, `MULTIPLE_MATCH_CONFLICT`, `COHERENCE_FAIL`, `TRUNCATED_DESCRIPTION` from the v4 reference |
| Idempotency | Same statement uploaded twice → one logical transaction (D10 DB01) |
| UPI | Handle short-circuit, mobile VPA person, QR merchant without double count, unknown below threshold |
| Precedence | Refund before income, card bill not second spend, EMI not merchant, salary not from the word alone, internal transfer excluded |
| Override | User correction creates a new resolution and does not change source text |
| Business safety | Credit ≠ revenue, loan disbursement ≠ revenue, sweep ≠ income or cost |
| Isolation | Owner A cannot read owner B parse rows |

F10 workbook EDGE and NEG rows are necessary personal cases and still insufficient, because they use the older F2 vocabulary (CF-02).

## 7. Required API contracts

Payloads are not invented here. F9 is the personal UI contract. Where F9 does not define an operation, the status is missing.

| Operation | Status | Notes |
| --- | --- | --- |
| Statement upload and import session | DEFINED_IN_SOURCE at trace level | F10 workbook TRACE-09 `POST /v1/imports`. Field dictionary remains F9 |
| Manual transaction | DEFINED_IN_SOURCE at trace level | TRACE-01 `POST /v1/transactions/manual`. Creates canonical identity, then parse/classify |
| Category correction | BLOCKED | F9H-04. Workbook TRACE-08 is TBD. Do not invent the body |
| Classification read | DEFINED_IN_SOURCE as a read model | F9 read APIs such as `GET /v1/ui/live` show classified context. Exact classification resource shape is in F9 §13, not in `openapi.yaml` |
| Reprocess / replay | MISSING_SPECIFICATION | D10 §13 defines persistence (`ops.replay_run`). No F9 path was extracted for an admin replay trigger |
| UPI handle correction by the user | MISSING_SPECIFICATION | F10C corrections exist as data. No extracted client route |
| Business narration review | MISSING_SPECIFICATION | B10B.1 and B10Q V032–V036 define persistence. UI mapping workbook must be bound in M6 before a path is published |

**ARCHITECTURAL_PROPOSAL:** classification is not a public "run SQL" endpoint. Clients send source files, manual facts, or scoped corrections. The server runs the versioned policy and returns the current head plus limitation codes.

## 8. Channels and formats noted from v4

**SOURCE_REQUIREMENT (v4 reference field table):** `channel_type` is `UPI | IMPS | NEFT | ACH | NACH | ATM | POS | CARD_BILLPAY | OTHER`.

`sub_type` for OTHER includes `CC_PAYMENT`, `MOB_TRANSFER`, `EMI`, `INTEREST_CREDIT`, `CHEQUE`, `CASH_DEPOSIT`, `BILLDESK`, `TRUNCATED`.

The reference cites 37 format shapes in `txn_channel_format_registry` and names examples such as `UPI_P2M_SLASH`, `UPI_CRDRREV_SLASH` (ICICI), and `UPIOUT_SLASH` (Federal Bank). The full 37-row registry was not copied into this document. Implementation must read the v4 SQL rather than this summary.

`NO_VPA` on UPI can be a correct result when the bank truncated the narration. It is not by itself a failed economic transaction.

## 9. Concurrency

**OPEN_DECISION OQ-17:** the v4 sections read describe stage order and error codes. They do not define a lock when two workers take the same batch.

**ARCHITECTURAL_PROPOSAL:** M2 uses D10 idempotency records and a batch status transition (`PENDING` → `RUNNING` → terminal) so a second worker no-ops. Partial unique indexes on source hash enforce convergence even if two workers race. That mechanism is D10 Table 13 and Table 16, not a new business rule.
