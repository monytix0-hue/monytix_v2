# M3.3 F10C party mapping

Status: adopted for structured observations. Date: 2026-10-11.

This is a versioned reading of F10C v1.2. It does not edit the freeze. It does not create a reusable entity, assign `SELF` or `MERCHANT`, or assign a spend category.

## Implemented

| Requirement | Contract | Input | Output |
| --- | --- | --- | --- |
| Observation, not an entity | One observation must not become a permanent entity | Same-owner parser `fields` named in `ref.party_observation_field` | `intel.entity_observation`. `entity_id` stays null |
| Structured fields | Parser v4 already emits these keys | `counterparty_vpa`, `counterparty_account`, `counterparty_name`, `counterparty_bank`, `counterparty_ifsc` | Observation types `VPA`, `ACCOUNT_TOKEN`, `LABEL`, `BANK_ID`, `IFSC`. Role `VISIBLE_COUNTERPARTY` |
| Same-owner evidence | Personal scope | `core.transaction_evidence_link` joined to `core.source_document.owner_id` | Another owner's source is ignored |
| Missing evidence | `UNKNOWN` is not `NOT_APPLICABLE` | No structured field | Status `UNKNOWN`, reason `NO_ENTITY_CANDIDATE` |
| Name only | Tier 5 never resolves | A label and no strong identifier | `UNKNOWN`, reason `WEAK_LABEL_ONLY` |
| One unregistered VPA | A handle is not a person or a merchant | Exactly one normalized VPA | `UNKNOWN`, reasons `VPA_ROLE_AMBIGUOUS` and `NO_ENTITY_CANDIDATE` |
| Conflicting strong identifiers | Do not pick a winner | Two distinct normalized VPAs or account tokens | `AMBIGUOUS`, reason `MULTIPLE_ENTITY_CANDIDATES`. Both observation ids stay in `evidence_references` |
| Repeated handle | Frequency does not prove one person | The same normalized VPA on two logical transactions | Two attempts. Both `entity_id` null. Same normalized value |
| Same name, different handle | Do not collapse homonyms | Two logical transactions | Two attempts. Distinct normalized VPAs |
| Version | A new resolver version does not rewrite history | Policy row plus copied field rows | New attempt. Prior row stays, `is_current` false |
| Replay | Same logical transaction, canonical version, and F10C version | Second call | Outcome `replay`. No second outbox row |
| Provenance | Section 6 of the brief | Source record, parser `parse_version`, field name, canonical version, `F10C-v1.2` | Stored on the observation and the attempt. Outbox carries ids and status only |
| Isolation | Personal pipeline | `owner_type <> PERSON` | Outcome `business_isolated`. No row |

`ops.resolve_transaction_party` is `SECURITY DEFINER`. `monytix_api` may execute it and may not insert the tables. `monytix_intelligence` may not execute it. The statement worker and the manual store call it after F10D and F10E. There is no classify route. Canonical money, F10D family, and F10E category status are not updated.

Normalization is comparison only: a VPA is lower-cased and trimmed, a label is upper-cased. The raw value stays on the observation row, which is readable only through owner row-level security. It is not copied into the outbox.

## Not copied

Parser `parse_confidence` and `fields._confidence` are legacy classifier weights. A probed UPI line produced `1.12`, which is outside 0–1. F10C says those numbers are not identity truth. `source_confidence`, `identity_confidence`, and `overall_resolution_confidence` stay null. The shape check rejects a resolved entity, a `SELF` relationship, a commercial hint, and a non-null score.

## Deferred

| Requirement | Why it is blocked |
| --- | --- |
| Reusable `financial_entity` | No governed registry. Person identifiers must not become a cross-owner graph |
| `SELF` and `VPA_OWNER_MATCH` | No owner-VPA or counterparty-account ownership map. The posting account is the owner's ledger account, not the counterparty |
| `MERCHANT`, `BILLER`, alias match | No merchant, biller, or alias registry. P2M text and narration words are supporting only |
| Intermediary versus economic party | Needs a governed gateway list, not a token split |
| Merchant spend category | F10D does not emit `MERCHANT_PURCHASE`. F10E keeps that constraint blocked |
| UPI Classifier v3 as a product | F10C does not require the pack. Parser v4 fields are the only signal read |
