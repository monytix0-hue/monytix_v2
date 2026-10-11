# M3.5 identity contract reconciliation

Status: clause comparison from M3.5. The decisions in this note were approved on 2026-10-11 as architecture only. Record: `docs/approvals/IDENTITY_AMENDMENT_V0_1_DECISION_FORM.md`. Date of the comparison: 2026-10-11. No migration, table, route, or runtime change.

This note compares clauses. It does not declare a winner. Each recommendation is repeated as `PROPOSED` in `docs/contracts/M3_5_CONTRACT_DECISION_REGISTER.md`. The amendment text is `docs/contracts/M3_5_PROPOSED_IDENTITY_AMENDMENT.md`.

## Precedence used to form recommendations

F10C v1.2 is the functional freeze for party meaning. D10 v1.2 is the physical catalogue. D10-3 is an executable pack that says it implements F10B–F10F. Where the pack's enums change F10C meaning, the recommendation is to leave the pack unadopted. That recommendation itself needs approval. It does not reopen D10. D10 v1.2 says reopening requires a proven defect that cannot be met inside the freeze. The proposal stays inside F10C meaning and D10 object names.

## A. Entity nature

F10C section 5 and AC-10: `PERSON`, `ORGANIZATION`, `FINANCIAL_INSTITUTION`, `GOVERNMENT_BODY`, `PLATFORM_OR_INTERMEDIARY`, `UNKNOWN`. Commercial role is separate. AC-13: small-merchant scale is not an entity type.

D10-3 `intel.financial_entity.entity_nature` includes `MERCHANT`, `BILLER`, `EMPLOYER`, `INTERMEDIARY`, `RTA`, and other role names.

Consequence of F10C: a merchant can later be re-hinted without changing nature. Consequence of D10-3: role and nature collapse, so a gateway and a shop share one species list and AC-10 fails.

Recommendation: keep the F10C nature list. Do not adopt the D10-3 check.

## B. Commercial hints

F10C: `MERCHANT`, `BILLER`, `EMPLOYER_CANDIDATE`, `RTA`, `PAYMENT_GATEWAY`, `MARKETPLACE`, `SERVICE_PROVIDER`, `UNKNOWN`. A hint is not an event. Scale hint is optional and never core identity. AC-12 and AC-14: amount, repetition, and P2M do not establish `MERCHANT`.

D10-3 stores several of those words as nature.

Recommendation: hints stay a separate field on the resolution or party link. They are not `entity_nature`.

## C. Entity identifiers

F10C section 12 and D10's catalogue: `entity_identifier` is its own object, typed, scoped to a provider or institution, with validity. Uniqueness is scoped. A last-4 is not global (F10C AC-16; D10 comment on `masked_identifier` already says the same).

D10-3 has no `entity_identifier`. It stores `VPA`, `MERCHANT_ID`, `BILLER_ID`, and `ACCOUNT_TOKEN` as alias types.

Consequence of the pack: a handle and a display name become the same object, so collision rules for identifiers and aliases blur. Consequence of F10C: an observed token can exist before any entity, and a governed identifier attaches only after governance.

Recommendation: three layers. An observed identifier is transaction evidence. A governed identifier attaches to one entity for an effective period. An alias is a name, not a token.

## D. Entity aliases

F10C alias types: `LEGAL_NAME`, `BRAND`, `DISPLAY_NAME`, `NARRATION_VARIANT`, `VPA_LABEL`, `USER_ALIAS`, `LEGACY_ALIAS`. AC-23: a collision stays ambiguous. AC-36: legacy merchant aliases may be migrated with provenance and collision checks. AC-37: legacy category labels do not enter entity truth.

D10-3 types are `NAME`, `VPA`, `MERCHANT_ID`, `BILLER_ID`, `DOMAIN`, `ACCOUNT_TOKEN`, `OTHER`, with default confidence `1`.

Recommendation: adopt the F10C alias list. Do not store VPAs or merchant ids as aliases. Do not default confidence to `1`. `VPA_LABEL` is the display text beside a handle, not the handle.

## E. Entity relationships

F10C owner relationship: `SELF`, `JOINT_SELF`, `RELATED_PARTY`, `EXTERNAL`, `UNKNOWN`. Entity-to-entity links are different: `BRAND_OF`, `OPERATED_BY`, `INTERMEDIARY_FOR`, `SUBSIDIARY_OF`, `OUTLET_OF`, `SAME_GROUP_CANDIDATE`, `OTHER`. AC-07: joint ownership does not clone the account.

D10-3 `owner_entity_relationship` uses `RELATED`, `EMPLOYER`, `CLIENT`, `DEPENDENT`, `OTHER` and omits `UNKNOWN`.

Recommendation: owner relationship uses the F10C five values. Employer and client stay commercial hints. Entity-to-entity links use the F10C graph list and are not owner relationships. Name similarity does not create `SUBSIDIARY_OF` or `SAME_GROUP_CANDIDATE`.

## F. Registry rules

D10 names `ref.entity_registry_rule` as the versioned mapping policy. F10C step 10 and AC-33: registries and thresholds are versioned and replayable. AC-40: user feedback does not silently change the global registry.

D10-3 does not create that table.

Recommendation: the rule row is the policy version a resolution cites. It is shared reference data. It is not an entity. Absence from the pack is a pack gap, not a deletion of the D10 object.

## G. Effective dates

F10C section 12 and AC-26 and AC-29: aliases, identifiers, and relationships carry validity. History remains after deactivation. Reassignment uses effective dates.

D10-3 owner relationships have `effective_from` and `effective_to`. Aliases have status only.

Recommendation: status plus an effective period on aliases, governed identifiers, owner relationships, and entity-to-entity links. A row outside the transaction's time is not evidence for that transaction. The row stays.

## H. Confidence scale

F10C section 14 and AC-32: identity, nature, role, relationship, and alias confidence stay separate. A composite must not hide a weak part. F10F forbids one blended score as eligibility authority. No numeric scale is published.

D10-3 defaults resolution confidence to `0` and alias confidence to `1`.

Recommendation: do not invent a scale. Do not adopt those defaults. Component scores stay absent until a later policy version defines the scale. A missing score is not zero.

## I. Auto-resolution threshold

F10C section 7: tier 1 may resolve when scope and validity match exactly. Tier 2 may resolve above a versioned threshold after collision checks. AC-04 says `SELF` needs evidence above a configured threshold. The freeze never prints that number. Section 8 calls an exact `account_ownership` match authoritative, and a verified owner VPA strong when the ownership record is active and the scope matches.

Recommendation: numeric auto-resolution stays blocked. The only score-free path proposed for later implementation is a boolean tier-1 match: the counterparty account is the same `financial_account` the owner holds for that effective time, and no stronger conflict exists. The posting account of the transaction is not that match. A VPA match stays blocked until a governed owner-VPA record exists and the approver accepts the boolean reading of AC-04. Similarity, frequency, and classifier weights never cross the line.

## J. Calibration

F10C section 14: calibration must be validated against labelled regression data and false-positive cost. No labelled set is in the freeze. AC-34: legacy UPI classifier thresholds are not permanent truth. AC-35: provider-handle weights are supporting only.

Recommendation: no calibration set is invented here. Any future number needs its own policy version and a named regression set. Until that version exists, tier 2 and tier 3 do not auto-resolve.

## K. Owner-VPA verification

F10C section 8 and reason `VPA_OWNER_MATCH`: a verified owner VPA is strong `SELF` evidence when the ownership record is active and the scope matches. AC-38 and AC-39: a user saying "this is me" is a scoped correction, not a global name rule. AC-05: the same name is never enough.

This database has `core.account_ownership` and no owner-VPA record. `ref.institution` is not that map.

Recommendation: an owner-VPA assertion is owner-scoped verification evidence pointing at a governed VPA identifier. It is not a global alias. It does not exist until a later approved implementation. Narration and parser handles do not create it.

## L. Identifier collisions

F10C section 17 and AC-23: one alias or identifier mapping to more than one in-scope entity is `AMBIGUOUS`. Same VPA with conflicting names keeps the identifier and sends names to review. Same name with different stable identifiers stays two candidates. Precedence tier 1 is an active scoped human adjudication. It does not mutate upstream evidence.

D10-3's alias unique index includes `entity_id`, so two active rows may share one normalized value.

Recommendation: more than one active in-scope attachment for the same scoped identifier or alias is a collision. Resolution stays `AMBIGUOUS`. The index shape in the pack is not adopted.

## M. Revocation

F10C section 18 and section 19: undo is a new version. A stale or revoked correction loses to current verified evidence. `DEACTIVATE` keeps lineage. `IDENTIFIER_REASSIGN` needs dates and collision review.

Recommendation: revocation sets the effective end and a revoked status. Later resolutions ignore it. Earlier resolutions stay. Replay builds a new attempt. Nothing is rewritten in place.

## N. Privacy and erasure

F10C section 20 names the cross-cutting Data Governance, Consent, Privacy & Retention specification for retention and erasure legality. That document was not in the personal bundle, the business bundle, or the repository. Status: `MISSING_SOURCE`.

What is already frozen elsewhere, and is not a substitute for that specification:

- F10A: authorized erasure runs a governance-approved workflow. Legal eligibility stays outside F10A. Status includes `ERASED_REFERENCE_ONLY`. Evidence is not deleted merely to satisfy a read model.
- F10L L35: authorized erasure invalidates downstream lineage and does not fabricate history.
- D10: authorized erasure is invalidation and tombstone behavior required by F10A and F10L. Legal retention is external. Hard delete is governance-only.

Recommendation: this amendment does not define a retention period or a hard-delete right. Person identifiers stay out of a cross-owner graph. Raw handles stay off logs and outbox payloads, as M3.3 already does. Erasure of party data waits for the missing specification plus the tombstone rules above.

## O. Migration 0015 compatibility

`0015_m3_3_party_evidence.sql` created `intel.entity_observation` and `intel.transaction_party_resolution` for structured observations and `UNKNOWN` or `AMBIGUOUS` attempts. It stores no entity. It rejects `RESOLVED`, `SELF`, and `MERCHANT`. It does not cite `transaction_structure_id`. F10C AC-01 requires that id on a published resolution.

D10-3 would create a different `intel.entity_observation` and an `intel.entity_resolution` that requires a structure id. `CREATE TABLE IF NOT EXISTS` would leave the M3.3 table in place.

Recommendation: do not alter migrations `0001`–`0015`. Existing attempts remain historical under policy `F10C-v1.2`. A future registry uses new objects and does not reload D10-3 onto these names. A future `RESOLVED` row must cite a structure id. Existing rows are not backfilled and their outcomes are not changed.
