# M3.2 F10E contract audit

Status: audit complete before implementation. Date: 2026-10-11.

Source read: `F10E_Monytix_Category_Subcategory_Purpose_Taxonomy_v1.2_FINAL_FREEZE.docx` inside `frs/Monytix_Personal_Deployment_Bundle.zip`. Compared with F10D v1.2, D10 v1.2 as already adopted in M0, the v2 financial-event catalogue, the M3.1 architecture note and mapping contract, migrations `0001` through `0013`, and `intel.financial_event_resolution`. The UPI classifier pack was not mounted. F10E section 23 demotes its merchant-category hint to F10C.

## 1. Purpose

F10E answers what a resolved financial event was for, and how it should be organized for a person to read. The core question in the freeze is: F10D answers what happened financially; F10E answers what it was for.

It assigns a reporting category, an optional subcategory, and an optional purpose. It does not decide the financial event, and it does not repair an unknown event by choosing a category.

## 2. Frozen terminology

| Term | Meaning in v1.2 |
| --- | --- |
| Category | Where the use belongs. Codes in section 7, such as `FOOD_DINING` and `GROCERIES_HOUSEHOLD` |
| Subcategory | A child of one category in one taxonomy version. Representative English names are listed. Stable subcategory codes are not |
| Purpose | Why, or in what context. Orthogonal to the category tree. Codes in section 10 |
| `UNKNOWN` | The dimension could apply, and the evidence is not good enough |
| `NOT_APPLICABLE` | The event structure makes that dimension meaningless. Not a parser failure |
| `OTHER_MERCHANT` | Merchant-spend event truth exists, and no finer use class is defensible. Not a synonym of `UNKNOWN` |
| `PROVISIONAL` | A best candidate exists and is below the strong threshold |
| `AMBIGUOUS` | Two or more compatible candidates remain |
| `INVALIDATED` | A prior attempt superseded by an upstream, taxonomy, or correction change |

Section 7 publishes 20 category codes. It does not publish income, transfer, loan, investment, insurance, cash, or credit-card payment as spend categories. The workbook sentence of 26 categories and 145 subcategories remains CF-10. This audit does not treat that sentence as the taxonomy.

## 3. Inputs

Section 2 requires the logical transaction, the canonical version, the current F10D event resolution, event family and subtype, analytics treatment, F10C parties, relationships, components, and supporting narration that cannot override the event.

M3.1 stores `logical_transaction_id`, the canonical version, `resolution_outcome`, `event_family` or null, the matched rule, evidence references, and `is_current`. It does not store event subtype, analytics treatment, party resolution, components, or refund relationships.

## 4. Outputs

Separate `category_resolution` and `purpose_resolution` rows in schema `intel`, which M0 already names as the database authority. Each row anchors to the exact event resolution and a taxonomy version. Category and purpose each have their own status, and a current flag. Semantic outbox meanings are `CATEGORY_RESOLUTION_AVAILABLE` and `PURPOSE_RESOLUTION_AVAILABLE`. A10 owns transport. No public classify route is named.

## 5. Preconditions

A personal owner, an owned account, and a current F10D interpretation. Business owners are outside this personal taxonomy. A category may be resolved only inside the event constraint for that family. Merchant-use classification expects `MERCHANT_PURCHASE`. That family is not produced by the mounted F10D rules.

## 6. Rule precedence

Eligibility is the first pipeline stage: the F10D family and status decide whether a spend category is even allowed. After that, evidence tiers run from a scoped human correction, to structured item or biller evidence, to a governed entity mapping, to an exact alias, and only then to lexical or model hints. A lower tier cannot outrank an applicable higher tier. Narration cannot turn `CREDIT_CARD_PAYMENT` into a merchant category. Purpose uses its own tiers and is not copied from the category.

## 7. Ownership boundaries

F10D owns the event. F10E owns category, subcategory, and purpose. F10C owns the economic party. F10F owns blended confidence and exception handling. F10G owns behaviour and signals. Needs, wants, impulse, essentiality, and budget buckets are not taxonomy truth. Personal rules are not applied to a business owner. UPI merchant categories are not F10E truth.

## 8. Versioning

Every resolution records the taxonomy version and the event resolution it consumed. A new taxonomy version or a new event resolution inserts a new attempt. Historical attempts stay queryable. One current category attempt and one current purpose attempt exist per logical transaction. Node merges and splits must not rewrite history. Display names can change without changing codes.

## 9. Evidence

Spend categories require merchant, biller, alias, or item evidence that is compatible with `MERCHANT_PURCHASE` or another explicitly permitted family. Purpose requires evidence that itself carries context. A grocery category does not create a purpose. Refund category inheritance requires a verified `REFUND_OF`, `REVERSAL_OF`, or `CHARGEBACK_OF` relationship. Cash withdrawal does not prove what the cash was spent on. This database has none of the party, biller, item, correction, or relationship records those rules name.

## 10. Unresolved conflicts

| Id | Conflict | Disposition |
| --- | --- | --- |
| C1 | Section 8 allows cash category `UNKNOWN` or `NOT_APPLICABLE`. AC-33 says insufficient evidence is `UNKNOWN` or `AMBIGUOUS`, not `NOT_APPLICABLE` | Do not assign a spend category. Store `UNKNOWN`, which both clauses allow. Amendment: cash use stays `UNKNOWN` until usage evidence exists |
| C2 | `category_confidence` and `purpose_confidence` are required, and v1.2 defines no scale and no value for a structural outcome | Leave the numeric columns null. Do not invent a score. F10F remains the confidence specification |
| C3 | Purpose `NOT_APPLICABLE` is required for several families, and section 16 has no purpose-specific reason code for that status | Category rows use `CATEGORY_NOT_APPLICABLE`. Purpose rows with that status reuse the same code and record this gap. No new reason code is invented |
| C4 | `INVALIDATED` describes a superseded attempt. Rewriting the old status would change history | Keep the old status and clear `is_current`, matching the canonical head-pointer pattern |
| C5 | CF-10, workbook 26/145 versus 20 section-7 codes | Seed the 20 codes. Do not invent the rest |
| C6 | Section 2 inputs include F10C parties, subtypes, components, and relationships. Those objects are not implemented | Merchant classification, refund inheritance, and component classification are `BLOCKED_DEPENDENCY` |

No conflict was found that lets F10E rewrite a canonical amount or an F10D family. That work stops if a later rule would do either.
