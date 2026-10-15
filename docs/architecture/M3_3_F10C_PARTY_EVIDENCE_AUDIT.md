# M3.3 F10C party-evidence audit

Status: audit complete before implementation. Date: 2026-10-11.

Source read: `F10C_Monytix_Entity_Counterparty_Intelligence_v1.2_FINAL_FREEZE.docx` in the personal bundle. Compared with F10D v1.2, F10E v1.2, parser v4 as mounted in migration `0008`, the M3.1 and M3.2 reports, and migrations `0001` through `0014`. UPI Classifier v3 was not executed. Parser v4 already stores a `_classifier_version` of `v3.1` inside some field objects. That number is not F10C authority.

## Purpose

F10C resolves who or what is involved in a transaction. It does not decide what financial event occurred, and it does not assign a category or a purpose. The freeze's own boundary is: a visible party or a verified self relationship may be published; income, shopping, salary, and internal-transfer exclusion may not.

## Frozen vocabulary

| Dimension | Values |
| --- | --- |
| Entity nature | `PERSON`, `ORGANIZATION`, `FINANCIAL_INSTITUTION`, `GOVERNMENT_BODY`, `PLATFORM_OR_INTERMEDIARY`, `UNKNOWN` |
| Owner relationship | `SELF`, `JOINT_SELF`, `RELATED_PARTY`, `EXTERNAL`, `UNKNOWN`. `SELF` is a relationship, not an entity type |
| Commercial hint | `MERCHANT`, `BILLER`, `EMPLOYER_CANDIDATE`, `RTA`, `PAYMENT_GATEWAY`, `MARKETPLACE`, `SERVICE_PROVIDER`, `UNKNOWN`. A hint is not an event |
| Scale hint | `SMALL_MERCHANT_CANDIDATE`, `ESTABLISHED_MERCHANT_CANDIDATE`, `UNKNOWN`. Not a core identity |
| Resolution status | `RESOLVED`, `PROVISIONAL`, `AMBIGUOUS`, `UNKNOWN`, `NOT_APPLICABLE`, `INVALIDATED` |
| Observation type | `LABEL`, `VPA`, `ACCOUNT_TOKEN`, `CARD_TOKEN`, `MERCHANT_ID`, `TERMINAL_ID`, `BILLER_ID`, `BANK_ID`, `BIC`, `IFSC`, and the other typed tokens in section 4 |

`UNKNOWN` means a counterparty may exist and cannot be resolved. `NOT_APPLICABLE` means the evidence shows that a reusable external party is structurally unnecessary. A missing candidate is not `NOT_APPLICABLE`.

## Evidence and identity

Tier 1 is verified account or VPA ownership. Tier 2 is a validated persistent identifier plus collision checks. Tier 3 is a governed alias. Tier 4, including P2M and P2P markers, only supports. Tier 5, including name shape, business words, and repetition, never resolves an entity by itself.

`SELF` requires an ownership or identifier match. The same name as the owner is not enough. The words "self" or "own" are not enough. The account a transaction is posted to is the owner's own ledger account. It is not evidence that the counterparty is self.

One observation must not automatically become one permanent entity. Person identifiers must not become a cross-owner graph. A UPI handle does not prove a merchant, a category, a purpose, an internal transfer, income, or an expense.

## What this database already has

Parser v4, already mounted, can place `counterparty_vpa`, `counterparty_name`, `counterparty_ifsc`, `counterparty_bank`, and `counterparty_account` on `core.source_record.raw_record_payload.fields`. Those are F10B observations. There is no governed merchant registry, no owner-VPA registry, no alias table, and no entity table. M3.1 does not emit `MERCHANT_PURCHASE`. M3.2 does not assign spend categories.

## Confidence

F10C keeps identity, nature, role, relationship, and alias confidence separate. A composite score must not hide those parts. Legacy classifier numbers are not permanent truth. Parser v4's `parse_confidence` can exceed 1 and is tied to the embedded classifier version, so it is not copied into an F10C score.

## Conflicts, versions, and ownership

Two strong identifiers that disagree stay `AMBIGUOUS`. A name alone stays unresolved. A new resolver version inserts a new attempt. Personal resolutions do not run for a business owner. Evidence is limited to source documents owned by the same owner. F10C does not update F10D or F10E.

## Dependencies

Reusable entity resolution, `SELF`, merchant identity, and merchant categories need registries and ownership maps this database does not have. Those outcomes stay blocked. Structured observations and an explicit unresolved or ambiguous status do not.
