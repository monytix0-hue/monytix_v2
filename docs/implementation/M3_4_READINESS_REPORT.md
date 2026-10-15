# M3.4 readiness report

Verdict: **BLOCKED_CONTRACT**

The frozen architecture names a governed identifier registry. It does not authorize implementing one now. F10C v1.2, the D10 v1.2 catalogue, and the D10-3 SQL pack disagree on entity nature, where an identifier lives, alias types, relationship names, effective dates, and confidence. No migration was written. No API, entity table, or merchant classification was added.

## 1. Frozen contract findings

F10C resolves who or what is involved and stops before financial meaning. D10 puts `financial_entity`, `entity_alias`, `entity_identifier`, and `entity_relationship` in `intel`, and the versioned mapping policy in `ref.entity_registry_rule`. Global non-private entities may be shared. Owner aliases and relationships may not. `SELF` requires ownership evidence. `MERCHANT` in F10C is a commercial hint. P2M, a bare VPA, a repeated name, and a business-looking word do not resolve an entity.

The D10-3 pack is the executable wave for F10B–F10F and is not a harmless extra. It stores `MERCHANT` as an entity nature, stores VPA and merchant id as alias types, omits `entity_identifier` and `ref.entity_registry_rule`, and uses one resolution confidence with a default. Those choices contradict F10C and the D10 catalogue. The audit is `docs/architecture/M3_4_GOVERNED_IDENTITY_CONTRACT_AUDIT.md`.

## 2. Existing database capabilities

Migrations `0001`–`0015` provide ledger identity, account ownership, institution reference, parser observations, and an F10C attempt that stays `UNKNOWN` or `AMBIGUOUS`. `ref.institution` is a bank and provider master. It is not a merchant registry. `core.financial_account.masked_identifier` is display evidence. The schema comment says a last-4 is never globally unique. There is no owner-VPA map and no `intel.financial_entity`.

## 3. Authorized identifier types

F10C's observation list and F10B's structural catalogue are authorized as vocabularies. They are not the same list as D10-3's seeded `ref.transaction_identifier_type`. A new F10B type may be stored as `OTHER_IDENTIFIER` with its source type preserved. Promotion to a first-class F10C type requires a resolution rule that actually depends on it.

## 4. Evidence and verification

Tier 1 may auto-resolve when scope and validity match. Tier 2 may resolve only above a versioned threshold after collision checks. Tier 3 needs a curated, active, collision-free alias. Tier 4 and tier 5 never resolve alone. The threshold numbers and the calibration set are not in the freeze. Confidence must stay null until they are.

## 5. Entity governance model

An entity id survives a display-name change. Aliases and identifiers have scope and validity. The same alias text may match several candidates and must stay `AMBIGUOUS`. Merge, split, and reassignment append history and replay affected attempts. Person identifiers must not become a cross-owner graph. Retention and erasure belong to a data-governance specification that F10C cites and that this bundle does not contain as a final freeze.

## 6. Identity-resolution dependencies

F10B `transaction_structure` and `transaction_identifier` are not mounted. D10-3's resolution row requires a structure id. M3.3 observations come from parser fields, which is a narrower input than F10B. A registry match also needs governed rows that do not exist. Applying the D10-3 script would collide with `intel.entity_observation` from migration `0015`.

## 7. F10D and F10E implications

After a real `SELF` or `JOINT_SELF` match to owned endpoints, F10D may test `INTERNAL_TRANSFER`. After a resolved merchant or economic party, an `OUT` direction, and failure of every higher band, F10D may test `MERCHANT_PURCHASE`. Identity alone does not assign either family. The rules mounted in M3.1 stay as they are.

`MERCHANT_PURCHASE` unlocks consideration of the F10E merchant-use codes. It does not select one. `OTHER_MERCHANT` is only for known merchant spend whose use class is still unresolved. `FINANCIAL_SERVICES` still waits on `FEE_CHARGE`. Specific codes wait on a section 12 tier: correction, structured product or biller evidence, a governed entity-to-category map, or an exact alias in context.

## 8. Missing contract decisions

- Which freeze wins when F10C and D10-3 disagree on nature, alias, identifier, relationship names, and confidence
- The numeric threshold and the labelled set used to calibrate it
- Whether an owner VPA is a relationship to an entity, an identifier ownership row, or both
- The data-governance specification for erasure
- A public API, if any, for corrections

## 9. Implementation readiness

Not ready. Building the D10-3 tables would violate F10C. Building a new shape invented to "reconcile" them would invent a contract. Leaving M3.3 as the unresolved observation layer is the authorized current behaviour.

## 10. Recommended next milestone

A contract-reconciliation note that records one vocabulary for entity nature, identifier versus alias, effective dates, and confidence, citing the winning freeze clause for each conflict. Do not write a migration in that note. After that decision, the first implementation slice is still F10B structure and typed identifiers, then registry rows, then `SELF` and merchant hints. Merchant categories stay after a real `MERCHANT_PURCHASE` and a section 12 use-class map.

The matrix is `docs/contracts/M3_4_IDENTITY_DEPENDENCY_MATRIX.md`.
