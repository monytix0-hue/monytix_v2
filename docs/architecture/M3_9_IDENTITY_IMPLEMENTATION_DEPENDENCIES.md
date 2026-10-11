# M3.9 identity implementation dependencies

Status: planning only. Date: 2026-10-11.  
Baseline: `IDENTITY-AMENDMENT-v0.1` is **ARCHITECTURE_APPROVED** on 2026-10-11.  
Record: `docs/approvals/IDENTITY_AMENDMENT_V0_1_DECISION_FORM.md`.

This sequence is a planning order. It is not authorization to build any box.

```text
Approved identity architecture (ID-00 through ID-O)
        |
        v
Governed entity model (ID-A, ID-00)
        |
        v
Identifier and alias model (ID-C, ID-D, ID-G, ID-L)
        |
        v
Evidence and relationship model (ID-E, ID-I, ID-K, ID-M)
        |
        v
Identity resolution (ID-F, ID-H, ID-I, ID-J, ID-O, F10C AC-01)
        |
        v
Verified commercial identity (ID-B)
        |
        v
Financial-event eligibility (F10D INTERNAL_TRANSFER, MERCHANT_PURCHASE)
        |
        v
Merchant categorization (F10E)
```

The running F10B, F10C, F10D, and F10E pipeline stays where M3.7 left it. Observed party evidence already exists under migration `0015`. Versioned structure already exists under migration `0016`. Those rows are inputs a later resolver may cite. They are not a registry.

## What each stage consumes

| Stage | Consumes | Does not consume |
| --- | --- | --- |
| Governed entity | F10C nature list. D10 placement in `intel` | A commercial hint. A narration label. D10-3's `MERCHANT` nature |
| Identifier and alias | An entity, for a governed identifier. A source field, for an observed token. F10C alias types | Parser confidence. A VPA stored as an alias. A last-4 treated as globally unique |
| Evidence and relationship | `core.account_ownership` for the boolean account path. A governed owner-VPA assertion for a handle path. F10B structure id on a future published resolution | The posting account as the counterparty. The words "self" or "own". P2M as identity. Historical `0015` rows rewritten in place |
| Identity resolution | One current policy version (`ref.entity_registry_rule`). One conflict-free entity candidate for `RESOLVED`. Canonical version plus `transaction_structure_id` (F10C AC-01) | A numeric score. Classifier weights. Two active attachments for one scoped token |
| Verified commercial identity | A governed identifier or a collision-free alias under a published policy | Amount, repetition, or P2M alone. Entity nature |
| Financial-event eligibility | `SELF` or `JOINT_SELF` plus both owned ends, before `INTERNAL_TRANSFER` can be tested. A resolved economic party, direction `OUT`, and failed higher bands, before `MERCHANT_PURCHASE` can be tested | A scale hint by itself. Current F10D outcomes |
| Merchant categorization | A `MERCHANT_PURCHASE` event, then an F10E section 12 tier. `OTHER_MERCHANT` stays the residual when the merchant is known and the use class is not | An F10C hint. A user category stored on a manual source payload |

## Replay rule already approved

A structure change, an ownership change, or a registry change inserts a new resolution attempt. The previous attempt stays. A new policy version does not rewrite migration `0015`. Revocation closes an effective period and affects only later attempts.

## F10B place in the sequence

M3.6 publishes a structure version. A future `RESOLVED` attempt must cite that id. The current F10C writer does not read `intel.transaction_structure`. Payer and payee roles are not a final grammar in parser v4, so a VPA on that structure remains `UNKNOWN_VPA` until a later governed assertion exists. Citing the structure id and deciding who the party is are different steps. Only the first is a prerequisite already present in the database.
