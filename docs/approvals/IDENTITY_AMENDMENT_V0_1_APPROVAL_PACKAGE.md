# IDENTITY-AMENDMENT-v0.1 approval package

Package status: **APPROVED** on 2026-10-11  
Amendment status: **APPROVED**, architecture only  
Amendment version: `IDENTITY-AMENDMENT-v0.1`  
Date of this package: 2026-10-11  
Approval record: `docs/approvals/IDENTITY_AMENDMENT_V0_1_DECISION_FORM.md`

The personal-contract approver approved all sixteen decisions on 2026-10-11, with the condition that this approval establishes the identity architecture only. It does not authorize database migrations, registry implementation, identity auto-resolution, merchant classification, or changes to existing financial interpretations.

The reconciliation is not repeated here. The sources are:

- `docs/contracts/M3_5_PROPOSED_IDENTITY_AMENDMENT.md`
- `docs/contracts/M3_5_CONTRACT_DECISION_REGISTER.md`
- `docs/architecture/M3_5_IDENTITY_CONTRACT_RECONCILIATION.md`
- `docs/implementation/M3_5_READINESS_REPORT.md`
- `docs/implementation/M3_7_INTEGRATION_REPORT.md`

The approval record is `docs/approvals/IDENTITY_AMENDMENT_V0_1_DECISION_FORM.md`. The blocker classes are `docs/approvals/IDENTITY_AMENDMENT_V0_1_BLOCKER_REGISTER.md`.

## What the approver is asked to do

For each decision ID-00 and ID-A through ID-O, record one of `APPROVED`, `REJECTED`, or `CHANGES_REQUESTED` on the decision form. Leave the form unsigned until that person writes it.

The form asks the approver to keep three acts separate: approval of the logical architecture, acceptance of the unresolved gaps in ID-H, ID-I, ID-J, and ID-N, and a later implementation authorization. The recommended condition on that form is:

> Approval of IDENTITY-AMENDMENT-v0.1 establishes the agreed identity architecture only. It does not authorize database migrations, registry implementation, identity auto-resolution, merchant classification, or changes to existing financial interpretations. These require separate implementation approval and applicable governance requirements.

The approver adopted that sentence on 2026-10-11. It is in force. The approval amends how D10-3 is read against F10C v1.2 and D10 v1.2. It does not edit those freezes in place.

## Baseline the approver should treat as current

| Milestone | Status |
| --- | --- |
| M3.5 amendment | Approved on 2026-10-11 as architecture only. Record: the decision form |
| M3.6 F10B structure | `PASS WITH GAPS`. Migration `0016_m3_6_f10b_structure.sql` publishes versioned structure. `PARSED` is withheld. A VPA role is `UNKNOWN_VPA`. An account token is not `SELF` |
| M3.7 pipeline | `PASS WITH GAPS`. F10C still reads same-owner parser fields. It does not read `intel.transaction_structure` |
| Latest migration | `0016_m3_6_f10b_structure.sql` |

M3.5 section 8 said a later registry needs an F10B structure version. That version now exists for a canonical narration. It is not a payer or payee role, and it is not a party resolution. F10C AC-01 still requires `transaction_structure_id` on a published party resolution. This pipeline does not publish `RESOLVED`.

## Decision matrix

Every row is **APPROVED** on 2026-10-11. Approver: the personal-contract approver. Record: `docs/approvals/IDENTITY_AMENDMENT_V0_1_DECISION_FORM.md`. Implementation remains unauthorized.

### ID-00

- Conflict: F10C v1.2 assigns party meaning. D10-3 changes several of those enums while saying it implements the freezes.
- Proposed resolution: F10C governs meaning. D10 v1.2 governs placement of entity, alias, identifier, and relationship rows in `intel`, and versioned policy in `ref`. D10-3 stays unadopted where it contradicts either.
- Frozen clauses: F10C v1.2 as the functional freeze. D10 v1.2 object catalogue, including `financial_entity`, `entity_identifier`, and `ref.entity_registry_rule`. D10 v1.2 reopening rule: a reopen needs a proven defect that cannot be met inside the freeze.
- Alternative considered: adopt D10-3 and treat the F10C enums as documentation.
- Compatibility: no runtime change. Current F10C outcomes stay `UNKNOWN` or `AMBIGUOUS`.
- Privacy: no new personal-data store. Precedence only.
- Status: **APPROVED**

### ID-A

- Conflict: F10C nature is `PERSON`, `ORGANIZATION`, `FINANCIAL_INSTITUTION`, `GOVERNMENT_BODY`, `PLATFORM_OR_INTERMEDIARY`, `UNKNOWN`. D10-3 `entity_nature` includes `MERCHANT`, `BILLER`, `EMPLOYER`, `INTERMEDIARY`, `RTA`, and other role names.
- Proposed resolution: keep the six F10C natures. `MERCHANT` is not a nature.
- Frozen clauses: F10C section 5. AC-10. AC-13, which keeps small-merchant scale off the entity type.
- Alternative considered: adopt the D10-3 nature check.
- Compatibility: a future entity row cannot use the pack's nature check.
- Privacy: a commercial role stays off the durable species of a party, so a later hint change does not relabel the entity.
- Status: **APPROVED**

### ID-B

- Conflict: F10C keeps commercial role on a separate hint. D10-3 stores several of those words as nature.
- Proposed resolution: hints stay on the resolution attempt: merchant, biller, employer candidate, RTA, gateway, marketplace, service provider, or unknown. Scale hint stays optional and non-core.
- Frozen clauses: F10C section 5. AC-12. AC-14. F10D: a scale hint cannot independently establish `MERCHANT_PURCHASE` or outrank higher bands.
- Alternative considered: store hints as `entity_nature`.
- Compatibility: the M3.3 hint column stays null.
- Privacy: a hint is stored with the owner-scoped attempt. It is not promoted into a global nature.
- Status: **APPROVED**

### ID-C

- Conflict: F10C and D10 name `entity_identifier` as its own object. D10-3 has no `entity_identifier` and stores VPA, merchant id, biller id, and account token as alias types.
- Proposed resolution: three layers. An observed token is evidence on one canonical version. A governed identifier attaches to one entity for an effective period, with provider or institution scope. An alias is a name, not a token.
- Frozen clauses: F10C section 12. AC-16. D10 comment that a masked identifier is not global. AC-03, which separates label, identifier, entity, owner relationship, and event.
- Alternative considered: fold tokens into aliases, as D10-3 does.
- Compatibility: M3.3 observations remain the observed layer. No governed identifier rows exist.
- Privacy: an observed token stays with the source owner. A person token is not a cross-owner graph. F10C section 20 allows a global registry only for governed non-personal entities.
- Status: **APPROVED**

### ID-D

- Conflict: F10C alias types are `LEGAL_NAME`, `BRAND`, `DISPLAY_NAME`, `NARRATION_VARIANT`, `VPA_LABEL`, `USER_ALIAS`, `LEGACY_ALIAS`. D10-3 uses `NAME`, `VPA`, `MERCHANT_ID`, `BILLER_ID`, `DOMAIN`, `ACCOUNT_TOKEN`, `OTHER`, and defaults alias confidence to `1`.
- Proposed resolution: use the F10C name types. A VPA label is display text beside a handle, not the handle. No default confidence.
- Frozen clauses: F10C alias list. AC-23. AC-36. AC-37, which keeps legacy category labels out of entity truth.
- Alternative considered: adopt the D10-3 alias types and the default confidence `1`.
- Compatibility: no alias rows exist to migrate.
- Privacy: `USER_ALIAS` and any other owner-scoped alias stay behind owner isolation. A default of `1` would present an unmeasured name as certain. That default is not adopted.
- Status: **APPROVED**

### ID-E

- Conflict: F10C owner relationship is `SELF`, `JOINT_SELF`, `RELATED_PARTY`, `EXTERNAL`, `UNKNOWN`. Entity links are `BRAND_OF`, `OPERATED_BY`, `INTERMEDIARY_FOR`, `SUBSIDIARY_OF`, `OUTLET_OF`, `SAME_GROUP_CANDIDATE`, `OTHER`. D10-3 uses `RELATED`, `EMPLOYER`, `CLIENT`, `DEPENDENT`, `OTHER` and omits `UNKNOWN`.
- Proposed resolution: owner link uses the five F10C values. Entity graph uses the F10C brand and operator list. Employer and client stay hints. Name similarity does not create a graph edge.
- Frozen clauses: F10C section 8. F10C section 12. AC-07. AC-05.
- Alternative considered: adopt the D10-3 relationship list.
- Compatibility: no relationship rows exist.
- Privacy: an owner relationship is scoped to that owner. The same party can be `SELF` for one owner and `EXTERNAL` for another. Employment is not written into the global graph as a relationship.
- Status: **APPROVED**

### ID-F

- Conflict: D10 names `ref.entity_registry_rule`. D10-3 does not create it.
- Proposed resolution: keep that table as the versioned policy a resolution cites. It is shared reference data. It is not an entity. Omission from the pack is a pack gap.
- Frozen clauses: D10 catalogue entry `entity_registry_rule`. F10C step 10. AC-33. AC-40, which stops user feedback from silently changing the global registry.
- Alternative considered: treat the omission as deletion of the object.
- Compatibility: the M3.3 policy table is a field allowlist. It is not this rule registry.
- Privacy: the rule row holds policy, not a party token.
- Status: **APPROVED**

### ID-G

- Conflict: F10C requires validity on aliases, identifiers, and relationships. D10-3 gives owner relationships an effective period and gives aliases status only.
- Proposed resolution: status plus an effective period on aliases, governed identifiers, owner relationships, and entity relationships. A row outside the transaction time is not evidence for that transaction. The row stays.
- Frozen clauses: F10C section 12. AC-26. AC-29. F10C section 19 `IDENTIFIER_REASSIGN`, which requires effective dates and collision handling.
- Alternative considered: status-only aliases, as in D10-3.
- Compatibility: historical M3.3 attempts have no entity period to rewrite.
- Privacy: closing a period stops later use. It does not erase the historical row. Erasure legality remains ID-N.
- Status: **APPROVED**

### ID-H

- Conflict: F10C keeps identity, nature, role, relationship, and alias confidence separate, and publishes no numeric scale. D10-3 defaults resolution confidence to `0` and alias confidence to `1`. F10F forbids one blended score as eligibility authority.
- Proposed resolution: no number is defined. Do not invent one. A missing score is not zero. Parser weights and UPI classifier scores are not this confidence.
- Frozen clauses: F10C section 14. AC-32. F10F v1.2.
- Alternative considered: adopt the D10-3 defaults `0` and `1`.
- Compatibility: M3.3 scores stay null. M3.6 does not copy parser confidence onto a structure.
- Privacy: storing `0` or `1` would look like a measured probability about a person or a merchant. Those defaults are not adopted.
- Status: **APPROVED**

### ID-I

- Conflict: F10C section 7 allows an exact tier-1 match to resolve, and tier 2 only above a versioned threshold. AC-04 requires `SELF` evidence above a configured threshold. The freeze never prints that number. Section 8 calls an exact `account_ownership` match authoritative for that account and period.
- Proposed resolution: numeric auto-resolution stays blocked. The only boolean path described is an exact counterparty-account match to an account `core.account_ownership` assigns to that owner at the transaction time, with matching scope and no material conflict. That path may establish `SELF` or `JOINT_SELF`. The account the transaction is posted to is not that match. Entity nature may stay `UNKNOWN`. A full `RESOLVED` entity still needs one conflict-free entity candidate. A handle, a name, P2M, or a repeated payee does not qualify. This path is described and is not authorized to build.
- Frozen clauses: F10C section 7. F10C section 8. AC-04. AC-05. AC-06. AC-11. AC-14.
- Alternative considered: block even the exact account match until a number exists.
- Compatibility: current outcomes stay `UNKNOWN` or `AMBIGUOUS`.
- Privacy: the boolean path uses an ownership row the owner already has. It does not match on a name or a handle, and it does not build a cross-owner graph.
- Status: **APPROVED**

### ID-J

- Conflict: F10C section 14 requires calibration against labelled regression data and false-positive cost. No labelled set is in the freeze. Legacy classifier weights are not that set.
- Proposed resolution: no calibration set is invented. A future number needs its own policy version and a named regression set. Until then, tier 2 and tier 3 do not auto-resolve.
- Frozen clauses: F10C section 14. AC-34. AC-35.
- Alternative considered: copy parser `parse_confidence` into the identity score.
- Compatibility: no score column is filled.
- Privacy: this amendment creates no labelled personal dataset.
- Status: **APPROVED**

### ID-K

- Conflict: F10C treats a verified owner VPA as strong `SELF` evidence when the ownership record is active and the scope matches. Narration such as "self" or "own" is supporting only. This database has `core.account_ownership` and no owner-VPA record.
- Proposed resolution: an owner-VPA assertion is owner-scoped verification evidence pointing at a governed VPA. It is not a global alias. Narration and parser fields do not create it. It does not exist until a later approved implementation.
- Frozen clauses: F10C section 8, including `VPA_OWNER_MATCH`. AC-05. AC-38. AC-39. F10B v2.0: a parsed handle is structural evidence. M3.6 stores the role `UNKNOWN_VPA`.
- Alternative considered: infer `SELF` from handle shape or from the words "self" or "own".
- Compatibility: no owner-VPA table is added.
- Privacy: the assertion, if later built, stays with that owner. A user saying "this is me" is a scoped correction, not a global name rule.
- Status: **APPROVED**

### ID-L

- Conflict: F10C says one in-scope alias or identifier attached to more than one entity is `AMBIGUOUS`. D10-3's alias unique index includes `entity_id`, so two active rows may share one normalized value.
- Proposed resolution: two active in-scope attachments for one scoped token or alias stay `AMBIGUOUS`. The pack's index shape is not adopted.
- Frozen clauses: F10C section 17. AC-23.
- Alternative considered: allow that unique key and keep both attachments active without ambiguity.
- Compatibility: M3.3 already keeps two same-owner VPAs `AMBIGUOUS`. M3.7 T10 passed on that behavior.
- Privacy: a shared handle is not silently attached to a second person or merchant.
- Status: **APPROVED**

### ID-M

- Conflict: F10C undo is a new version. `DEACTIVATE` keeps lineage. A stale correction loses to current verified evidence.
- Proposed resolution: revocation closes the effective period. Later resolutions ignore the row. Resolutions already published stay. Replay inserts another attempt. Nothing is rewritten in place.
- Frozen clauses: F10C section 18. F10C section 19, including `DEACTIVATE` and `IDENTIFIER_REASSIGN`.
- Alternative considered: delete the alias or identifier.
- Compatibility: no governed rows exist to revoke. M3.7 T15–T18 left prior interpretation rows in place when a new version was published.
- Privacy: revocation does not hard-delete party evidence. Past attempts can still hold a handle until ID-N's missing specification exists.
- Status: **APPROVED**

### ID-N

- Conflict: F10C section 20 names the Data Governance, Consent, Privacy & Retention specification for retention and erasure legality. That document is not in the personal bundle, the business bundle, or the repository. Status of the source: `MISSING_SOURCE`.
- Proposed resolution: record `MISSING_SOURCE`. This amendment authorizes no hard delete and defines no retention period. Any later erasure follows F10A `ERASED_REFERENCE_ONLY`, F10L L35 invalidation without fabricated history, and D10 tombstone behavior. Person identifiers stay out of a cross-owner graph. Raw handles stay off logs and outbox payloads.
- Frozen clauses: F10C section 20. F10C section 19 `AUTHORIZED_ERASURE`. F10A erasure workflow and `ERASED_REFERENCE_ONLY`. F10L L35. D10: authorized erasure is invalidation and tombstone; legal retention stays external.
- Alternative considered: invent a retention period.
- Compatibility: the ledger and M3.3 evidence stay. M3.7 confirmed an imported UPI outbox payload did not contain the handle.
- Privacy: this is the privacy decision. Approving it accepts a recorded gap. It does not supply the missing specification.
- Status: **APPROVED**

### ID-O

- Conflict: migration `0015` created `intel.entity_observation` and `intel.transaction_party_resolution` for observations and for `UNKNOWN` or `AMBIGUOUS` attempts. Those rows have no `transaction_structure_id`. F10C AC-01 requires that id on a published resolution. D10-3 would `CREATE TABLE IF NOT EXISTS` a different `intel.entity_observation`, which would leave the M3.3 table in place.
- Proposed resolution: do not alter `0015`. Do not reuse its table names for the D10-3 shapes. Existing attempts stay historical under `F10C-v1.2`. A future `RESOLVED` row must cite a structure id. Existing rows are not backfilled and their outcomes are not changed.
- Frozen clauses: F10C AC-01. AC-02. AC-30. D10 placement of future entity objects in `intel`.
- Alternative considered: reload D10-3 with `CREATE TABLE IF NOT EXISTS`.
- Compatibility: current F10C outcomes unchanged. M3.6 and M3.7 did not edit `0001`–`0015`. `0016` is the F10B structure migration and is also left unchanged by this package.
- Privacy: historical observations are not rewritten, reassigned, or deleted by this amendment.
- Status: **APPROVED**

## Count

Sixteen decisions: ID-00 and ID-A through ID-O. All **APPROVED** on 2026-10-11, subject to the architecture-only condition.

## Evidence the form should cite

- F10C v1.2, especially sections 5, 7, 8, 12, 14, 17, 18, 19, and 20, and AC-01 through AC-07, AC-10 through AC-14, AC-16, AC-23, AC-26, AC-29, AC-30, AC-32 through AC-40.
- D10 v1.2 catalogue entries for `financial_entity`, `entity_identifier`, `entity_registry_rule`, and the tombstone paragraph.
- D10-3 as the unadopted pack where it contradicts those clauses.
- F10B v2.0 structural-evidence boundary, as implemented under M3.6 with the gaps in that report.
- F10D v1.2 and F10E v1.2 only as downstream consequences that this amendment does not activate.
- F10F v1.2 on blended scores.
- M3.7 integration report for the running pipeline.
