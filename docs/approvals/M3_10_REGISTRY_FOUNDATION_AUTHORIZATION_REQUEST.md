# M3.10 governed registry foundation authorization request

Request status: **GRANTED** on 2026-10-11  
Date of this request: 2026-10-11  
Architecture baseline: `IDENTITY-AMENDMENT-v0.1`, **ARCHITECTURE_APPROVED**  
Architecture revision: `fb0e2ac24403b5b289bad6cf16ee35d72ddfc0ef`  
Approval evidence: `docs/approvals/IDENTITY_AMENDMENT_V0_1_DECISION_FORM.md`  
Plan: `docs/implementation/M3_9_READINESS_REPORT.md`

The personal-contract approver granted this request on 2026-10-11. The grant authorizes a later implementation of the structures in the cover below, under the condition in the decision record. This file does not itself add a migration, table, route, or change to the running F10B–F10E pipeline. No personal name was supplied, and none was added.

## What this request covers

If granted, a following implementation milestone could add only these structures:

| Structure | Bound |
| --- | --- |
| Non-personal entity | F10C natures only: `PERSON` is not used for a global party, and `MERCHANT` is not a nature. Allowed natures for this request are `ORGANIZATION`, `FINANCIAL_INSTITUTION`, `GOVERNMENT_BODY`, `PLATFORM_OR_INTERMEDIARY`, and `UNKNOWN` |
| Non-personal governed identifier | Typed token on one such entity, with provider or institution scope and an effective period. Two active in-scope attachments for one scoped token stay `AMBIGUOUS` |
| Non-personal alias | F10C name types on those entities: `LEGAL_NAME`, `BRAND`, `DISPLAY_NAME`, `NARRATION_VARIANT`, `VPA_LABEL`, `LEGACY_ALIAS`. Confidence stays null. A VPA label is not a VPA. A handle is not an alias |
| Registry policy | `ref.entity_registry_rule` as the version a future resolution would cite. This request includes no numeric threshold and no calibration set |

`PERSON` appears in the F10C nature list and is excluded from this request wherever the row would be global or shared across owners.

## What this request excludes

A grant of this request would still leave these unauthorized:

- Global person identity
- Cross-owner person identifiers
- `USER_ALIAS` and any other owner-scoped personal alias
- Owner-VPA verification and `SELF` or `JOINT_SELF`, including the boolean account-match path
- Automatic identity resolution and any `RESOLVED` party attempt
- Commercial hints, `MERCHANT_PURCHASE`, `INTERNAL_TRANSFER`, and merchant spend categories
- Numeric confidence, tier 2, tier 3, and a calibration set
- Retention periods, hard delete, and any other privacy behavior still owned by the missing Data Governance, Consent, Privacy & Retention specification
- Rewriting or backfilling migration `0015`
- Reloading D10-3 onto existing table names
- Changes to canonical money, F10B structure publication, F10D events, or F10E categories
- Identifier reassignment procedure. Who may reassign is still undefined

Existing observations stay `UNKNOWN` or `AMBIGUOUS`. A future `RESOLVED` row is outside this request and would still need its own authorization, a structure id, and one conflict-free candidate.

## Condition

Adopted: **yes**

> Granting M3.10 authorizes a later implementation of non-personal entity, identifier, alias, and registry-policy structures only. It does not authorize global person identity, cross-owner person identifiers, automatic resolution, commercial classification, privacy or retention rules, or changes to existing financial interpretations.

## Decision

| Field | Record |
| --- | --- |
| Request | M3.10 governed registry foundation |
| Approver identity | Personal-contract approver. No personal name was supplied with the instruction |
| Approver role | Personal-contract approver |
| Decision date | 2026-10-11 |
| Disposition | GRANTED |
| Condition adopted | yes |
| Signature | Written instruction recorded 2026-10-11. No handwritten signature and no personal name were supplied |

Disposition is `GRANTED` for the cover above and for the exclusions in this request. The exclusions stay unauthorized.
