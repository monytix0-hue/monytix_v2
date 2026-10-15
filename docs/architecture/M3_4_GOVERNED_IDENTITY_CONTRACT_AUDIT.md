# M3.4 governed identity contract audit

Status: audit only. Date: 2026-10-11. No migration, API, entity table, or merchant classification was added.

Sources read: D10 v1.2 FINAL FREEZE, F10C v1.2, F10B v2.0, F10D v1.2, F10E v1.2, F10F v1.2, F10-0 v1.0, and the D10-3 transaction-intelligence pack (`D10_3_transaction_intelligence.sql` plus its readme). Compared with M3.1–M3.3 reports and migrations `0001`–`0015`. UPI Classifier v3 was not executed. F10C lists it as legacy evidence, not as the identity authority.

## Purpose of this audit

M3.3 left party identity unresolved because no governed registry exists. This milestone asks whether the frozen architecture authorizes that registry, and whether an implementation may start.

## What the freezes agree on

F10C's job is who or what is involved. It does not decide the financial event, category, purpose, or behaviour. Its core rule is: observed label, identifier, entity, relationship, and financial meaning are different objects.

D10 v1.2 names these intelligence objects: `financial_entity`, `entity_alias`, `entity_identifier`, `entity_relationship`, `transaction_party_resolution`. It names `ref.entity_registry_rule` as the versioned mapping policy. DB37 and the sharing rule say one global non-private entity may be reused by personal and business owners, while owner-specific aliases, corrections, and relationships stay behind owner row-level security.

F10C section 12 gives an entity a stable id, aliases a type and a validity period, and identifiers a type plus provider or institution scope. Section 19 says a merge, split, alias change, or identifier reassignment is an audited event that replays affected resolutions. It does not erase lineage.

F10A `core.account_ownership` is the authority for known Monytix accounts. A merchant or biller is not that account. `SELF` is a relationship to an owner, not an entity species. The same institution can be `SELF` for one owner and external for another.

## Conflicts that block a build

These are disagreements inside the frozen set. This audit does not pick a winner.

| Topic | F10C v1.2 / D10 v1.2 catalogue | D10-3 SQL pack |
| --- | --- | --- |
| Entity nature | `PERSON`, `ORGANIZATION`, `FINANCIAL_INSTITUTION`, `GOVERNMENT_BODY`, `PLATFORM_OR_INTERMEDIARY`, `UNKNOWN`. `MERCHANT` is a commercial hint, not a nature | `entity_nature` includes `MERCHANT`, `EMPLOYER`, `BILLER`, `INTERMEDIARY`, and other role names |
| Identifier object | `entity_identifier` is its own object. D10 also names `ref.entity_registry_rule` | No `entity_identifier` table and no `entity_registry_rule`. VPA, merchant id, and biller id are `entity_alias` types |
| Alias vocabulary | `LEGAL_NAME`, `BRAND`, `DISPLAY_NAME`, `NARRATION_VARIANT`, `VPA_LABEL`, `USER_ALIAS`, `LEGACY_ALIAS` | `NAME`, `VPA`, `MERCHANT_ID`, `BILLER_ID`, `DOMAIN`, `ACCOUNT_TOKEN`, `OTHER` |
| Owner relationship | `SELF`, `JOINT_SELF`, `RELATED_PARTY`, `EXTERNAL`, `UNKNOWN` | `SELF`, `JOINT_SELF`, `RELATED`, `EXTERNAL`, `EMPLOYER`, `CLIENT`, `DEPENDENT`, `OTHER` |
| Validity | Aliases, identifiers, and relationships may carry `effective_from` / `effective_to` | Owner relationship has those dates. Alias has `ACTIVE` / `INACTIVE` / `REVOKED` and no effective period |
| Confidence | Separate identity, nature, role, relationship, and alias scores. A composite must not hide a weak part. Thresholds are versioned. Legacy classifier numbers are not truth | One `resolution_confidence` on the attempt, default `0`. Alias confidence defaults to `1` |
| Resolution anchor | F10C requires the logical transaction, canonical version, and F10B `transaction_structure_id` | The pack requires `transaction_structure_id` as well. This database has no `intel.transaction_structure` |

F10F v1.2 forbids one blended score as the authority for eligibility. That agrees with F10C's separate dimensions and disagrees with a single defaulted resolution score.

D10-3 also cannot be applied as written onto this database. Migration `0015` already created `intel.entity_observation` and `intel.transaction_party_resolution` with the M3.3 shape. The pack uses `CREATE TABLE IF NOT EXISTS` for `intel.entity_observation` and a different `intel.entity_resolution` name. A later load would leave the existing observation table in place and would not become the F10C registry.

## Answers

**A. Registry.** The architecture authorizes a governed entity and identifier registry as named objects and as F10C pipeline step 10. It does not authorize building one until the conflicts above are closed. Status: `PARTIALLY_AUTHORIZED` as a concept, `BLOCKED_CONTRACT` as an implementation.

**B. Schema.** D10 puts entity, alias, identifier, and relationship rows in `intel`. It puts the versioned mapping policy in `ref.entity_registry_rule`. Owner observations stay owner-scoped. `core` remains the ledger. The D10-3 pack follows `intel` for rows and does not create the `ref` rule table.

**C. Identifier types.** F10C observation types are `LABEL`, `VPA`, `ACCOUNT_TOKEN`, `CARD_TOKEN`, `MERCHANT_ID`, `TERMINAL_ID`, `BILLER_ID`, `BANK_ID`, `BIC`, `IFSC`, `RTA_TOKEN`, `FOLIO_TOKEN`, `LINKED_DEPOSIT_ACCOUNT_TOKEN`, `SWEEP_REFERENCE`, and `OTHER_IDENTIFIER`. F10B v2.0 publishes a longer structural catalogue, including `UPI_RRN`, `VPA`, `IFSC`, `BILLER_ID_RAW`, `MERCHANT_ID_RAW`, `TERMINAL_ID_RAW`, and masked account or card tokens. New F10B types may arrive as `OTHER_IDENTIFIER` with `source_identifier_type` retained. D10-3 seeds a shorter `ref.transaction_identifier_type` list (`PAYER_VPA`, `PAYEE_VPA`, `MID_RAW`, `BILLER_ID_RAW`, and others). Those three lists are not the same vocabulary.

**D. Ownership verification.** Tier 1 is F10A account ownership, a trusted provider entity id, or a verified owner VPA or account mapping, and it may resolve only when scope and validity match. A user statement that an account is theirs is an audited, scoped correction. It does not mark every matching name as `SELF`. This database has `core.account_ownership` and `core.financial_account.provider_account_reference`. It has no owner-VPA table.

**E. Merchant and biller versus user accounts.** They are separate. User accounts live in `core.financial_account` with `core.account_ownership`. Merchant and biller identity, when governed, is a global non-private entity. Owner-specific aliases stay isolated. F10C section 20 forbids turning person identifiers into a cross-owner social graph.

**F. Aliases.** F10C section 12. A curated, collision-free, active alias may resolve and must keep provenance. The same alias text may point at more than one candidate, and text alone cannot force a merge. D10-3's unique index includes `entity_id`, so two active aliases may share one normalized value. F10C section 17 then requires `AMBIGUOUS`.

**G. Conflicts.** Two strong identifiers stay unresolved as competing candidates. A name that looks like a merchant loses to a verified owner VPA on the relationship dimension. A gateway handle and a merchant label stay two parties. One alias mapped to several merchants is `AMBIGUOUS`. Legacy classifier output loses to a matched merchant id. F10B partial identifiers are not completed by invention.

**H. Revocation and correction.** Corrections are new versioned rows. They do not rewrite narration, canonical money, or the prior resolution. A stale or revoked correction does not outrank current verified evidence. Alias removal and identifier reassignment replay only the affected candidates. Deactivation keeps history. Authorized erasure is deferred to the cross-cutting data-governance specification, which is cited by F10C section 20 and was not present as a final freeze in the personal bundle.

**I. One identifier, many entities over time.** F10C allows it through `IDENTIFIER_REASSIGN`, with effective dates, collision handling, and high scrutiny. Historical handles remain auditable after deactivation. The D10-3 alias table can mark `REVOKED` and then attach the same normalized value to another entity, and it does not store the effective period F10C requires.

**J. Versioning.** Every resolution cites the logical transaction, canonical version, F10B structure id, and policy version. A new threshold, registry row, or correction inserts a new attempt. DB10 says an entity correction creates new lineage only. M3.3 already versions `F10C-v1.2` attempts. It does not version entities, because it creates none.

**K. Confidence scale.** F10C requires separate dimensions and says thresholds are configurable and versioned. It publishes no numbers. F10F forbids a blended score as eligibility authority. Legacy parser weights are not identity truth. Status: `NOT_SPECIFIED` for the numeric scale and the auto-resolve cutoff.

**L. What permits `RESOLVED`.** One candidate meets the resolution rules and there is no material conflict. Tier 1 may do that when scope and validity match. Tier 2 may do that above the unpublished versioned threshold after collision checks. A collision-free active curated alias may do that under tier 3. Tier 4 and tier 5 never do it alone. Missing evidence stays `UNKNOWN`, not `RESOLVED` and not `NOT_APPLICABLE`.

**M. What permits `SELF`.** An exact F10A ownership match for that account and effective period, or a verified owner VPA or account identifier whose ownership record is active and whose scope matches. A linked sweep account verified to the same owner may establish the relationship. The same name as the owner, the words "self" or "own", and round-trip patterns do not. F10C does not publish the internal-transfer exclusion. F10D does.

**N. What permits `MERCHANT`.** A trusted, scoped merchant or provider identifier, or a collision-free active curated alias. A business suffix, a P2M marker, a UPI handle, repetition, and a small-ticket pattern do not. `MERCHANT` here is the commercial hint in F10C, not an F10D event and not an F10E category. D10-3's use of `MERCHANT` as `entity_nature` conflicts with that split.

**O. F10D after identity.** Identity alone rarely proves an event. These families become eligible to be tested, not automatically assigned:

- `INTERNAL_TRANSFER` when `SELF` or `JOINT_SELF` matches an owned source and destination and the structure is compatible
- `MERCHANT_PURCHASE` when a merchant or economic party is resolved, direction is `OUT`, and every higher band has failed
- `PERSON_TRANSFER` when the party is an external person and no stronger income, loan, or refund evidence applies
- Lender, issuer, insurer, employer, government, and broker or AMC relationships can support the matching higher-band families only together with that family's own evidence

Already mounted rules (`EMI_001`, `EMI_002`, `CC_001`, `INC_040`, `CASH_001`, `INC_050`) do not gain new behaviour from a registry. `counterparty_scale_hint` still cannot create or override a family.

**P. F10E after `MERCHANT_PURCHASE`.** The event is the gate. It does not select a category. Section 7 ties `FOOD_DINING`, `GROCERIES_HOUSEHOLD`, `MOBILITY_TRANSPORT`, `TRAVEL`, `HEALTH_MEDICAL`, `SHOPPING_RETAIL`, `PERSONAL_CARE`, `FITNESS_WELLNESS`, `ENTERTAINMENT_MEDIA`, `FAMILY_CHILDCARE`, `PETS`, and `GIFTS_CELEBRATIONS` to `MERCHANT_PURCHASE`. `HOUSING_HOME`, `UTILITIES_COMMUNICATION`, and `EDUCATION_LEARNING` also allow `BILL_PAYMENT`. `CHARITY_GIVING` also allows `PERSON_TRANSFER` when purpose evidence exists. `PROFESSIONAL_BUSINESS` still needs purpose evidence. `GOVERNMENT_CIVIC` follows `TAX_GOVERNMENT` or `MERCHANT_PURCHASE`. `FINANCIAL_SERVICES` follows `FEE_CHARGE`. `OTHER_MERCHANT` is allowed only when merchant-spend truth exists and the use class is still unresolved. A resolved merchant is helpful and is not mandatory for that residual. Choosing among the specific codes still needs F10E section 12 tiers: a scoped correction, structured biller or product evidence, a governed entity-to-category map, or an exact alias plus context. Name similarity remains supporting only.

## Existing database

Present and relevant: `ref.institution`, `core.financial_account` (`masked_identifier`, `provider_account_reference`), `core.financial_account_instrument` (card lineage, not a VPA), `core.account_ownership`, parser field observations, `intel.entity_observation`, and `intel.transaction_party_resolution`. The last two store signals and an unresolved or ambiguous attempt. They are not a registry.

Absent: `intel.financial_entity`, `intel.entity_alias`, `intel.entity_identifier`, `intel.owner_entity_relationship`, `intel.transaction_structure`, `intel.transaction_identifier`, `ref.entity_registry_rule`, and any merchant or biller seed.
