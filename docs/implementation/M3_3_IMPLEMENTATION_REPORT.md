# M3.3 implementation report

Verdict: **PASS WITH GAPS**

F10C v1.2 says who or what was observed. This slice stores structured party evidence and an explicit unresolved or ambiguous attempt. It does not invent a person, a merchant, a self relationship, or a spend category.

## 1. Verdict

**PASS WITH GAPS.** Observations, conflict handling, provenance, versioning, replay, and owner isolation match the freeze for the signals this database already stores. Reusable identity, verified `SELF`, and merchant classification stay blocked because the registries they require are absent.

## 2. Frozen F10C scope

The audit is `docs/architecture/M3_3_F10C_PARTY_EVIDENCE_AUDIT.md`. F10C resolves involvement. It does not decide the financial event and it does not assign category or purpose. A UPI handle, a P2M marker, a repeated name, and a narration keyword are not entity truth.

## 3. Implemented evidence sources

Same-owner parser fields only: `counterparty_vpa`, `counterparty_account`, `counterparty_name`, `counterparty_bank`, and `counterparty_ifsc`. The field list lives in `ref.party_observation_field` for version `F10C-v1.2`. Canonical narration is not scanned. UPI Classifier v3 is not mounted. Parser v4 may already have written those fields, including on a UPI line.

## 4. Party-resolution rules

The mapping is `docs/contracts/M3_3_F10C_PARTY_MAPPING.md`.

- No structured field: `UNKNOWN` / `NO_ENTITY_CANDIDATE`
- Label only: `UNKNOWN` / `WEAK_LABEL_ONLY`
- One VPA, no registry: `UNKNOWN` / `VPA_ROLE_AMBIGUOUS` and `NO_ENTITY_CANDIDATE`
- Two distinct VPAs or account tokens: `AMBIGUOUS` / `MULTIPLE_ENTITY_CANDIDATES`
- `entity_id`, commercial hint, scale hint, and confidence stay null
- Entity nature and owner relationship stay `UNKNOWN`

`RESOLVED`, `SELF`, and `MERCHANT` cannot be written by this function. The table shape check rejects them.

## 5. Database changes

Forward migration `database/migrations/0015_m3_3_party_evidence.sql`, code `M3-3-F10C-PARTY`, registered in `scripts/migrate.sh`. Applied to local PostgreSQL 17. Migrations `0001` through `0014` were not edited.

New objects: `ref.party_resolution_policy`, `ref.party_observation_field`, `intel.entity_observation`, `intel.transaction_party_resolution`, `ops.resolve_transaction_party`, and `ops.resolve_party_extraction_run`. The statement worker and the manual store call party resolution after F10D and F10E. There is no classify route and no entity table.

## 6. Provenance model

Each observation stores the logical transaction, canonical version, source record, parser version, field name, raw value, normalized comparison value, and F10C version. Each attempt stores those anchors, the status, the reason codes, the observation ids, and `resolved_at`. A repeat of the same version returns `replay`. A new policy version inserts a new attempt and clears `is_current` on the previous one. The outbox event `TRANSACTION_PARTY_RESOLVED` carries identifiers and status. It does not carry the handle or the name.

## 7. Test results

The matrix is `docs/qa/M3_3_F10C_TEST_MATRIX.md`. F10C integration test: 1 passed, about 369 ms. F10E and F10D integration tests passed again. API typecheck passed. T01 through T20 passed as written. Registry resolution was not marked passed.

## 8. Security results

`monytix_api` can execute the writer and cannot insert the new tables. `monytix_intelligence` cannot execute the writer. Another actor is `forbidden`. A business owner is `business_isolated` and gets no row. Cross-owner source evidence is ignored. Two concurrent callers leave one attempt. Rollback removes the attempt and the observations. Row level security is enabled on both new intelligence tables.

## 9. Blocked dependencies

A governed entity and identifier registry, an owner-VPA ownership map, merchant and biller alias tables, intermediary lists, F10D `MERCHANT_PURCHASE`, and any F10E spend category that needs that event. A numeric confidence scale is also absent, so scores stay null. Production Cloudflare R2 and ClamAV are unchanged.

## 10. Next milestone

A governed identifier registry, only when a later contract names one. Do not assign merchant categories from narration, a UPI handle, or repetition. F10E merchant classification stays blocked until both a real `MERCHANT_PURCHASE` event and verified party evidence exist.
