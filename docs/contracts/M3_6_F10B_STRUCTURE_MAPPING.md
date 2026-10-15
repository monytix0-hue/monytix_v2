# M3.6 F10B structure mapping

Status: adopted for structural publication only. Date: 2026-10-11.

`IDENTITY-AMENDMENT-v0.1` is not approved by this mapping.

## Implemented

| Requirement | Contract | Input | Output |
| --- | --- | --- | --- |
| Structural attempt | F10B sections 2–4 | Current READY canonical version | `intel.transaction_structure` for `F10B-v2.0` |
| Rail | Section 5 | Parser channel, only where it names a transport | `UPI`, `IMPS`, `NEFT`, `RTGS`, `ACH`, `NACH`, `CASH` for ATM, `CARD_NETWORK` for POS, `BILLPAY`, `CHEQUE`, otherwise `UNKNOWN` |
| Markers | Section 8 | Format key containing `P2A`, `P2M`, `P2P`, or `REV` | `observed_type_markers`. Not a subtype and not an entity |
| VPA | Section 12 | `fields.counterparty_vpa` with `@` and no spaces | Type `VPA`, role `UNKNOWN_VPA`, status `CANDIDATE` |
| UPI RRN | Section 12 | `fields.upi_rrn` of 12–14 digits on rail `UPI` | Type `UPI_RRN`, role `UNKNOWN_REFERENCE_ROLE` |
| IFSC | Section 12 | Full 11-character syntax | Type `IFSC`. Not a party |
| Account token | Section 12 | `fields.counterparty_account` | Type `ACCOUNT_TOKEN`, role `COUNTERPARTY_ACCOUNT`. Not ownership |
| Label | Section 12 | `fields.counterparty_name` | Type `COUNTERPARTY_LABEL_RAW`. Not a governed identifier |
| Direction | Section 4 | Parser marker versus canonical direction | `CONSISTENT`, `SOURCE_MARKER_ABSENT`, or `CONFLICT`. Canonical direction is not updated |
| Missing rail | Section 14 | Blank narration, or an event-shaped v4 subtype | `UNPARSED`, rail `UNKNOWN`, reason `NO_RAIL_MATCH` |
| Known rail | Section 14, no published field threshold | A mapped rail without a direction conflict | `PARTIAL`, not `PARSED` |
| Replay and version | Section 17 | Same canonical version and F10B version | `replay`. A new policy version inserts a new attempt |
| Isolation | Personal pipeline already used by F10D | Business owner | `business_isolated`. No row |

Outbox `TRANSACTION_STRUCTURE_AVAILABLE` carries ids, rail, and status. It does not carry the handle or the label.

## Deferred

| Requirement | Why |
| --- | --- |
| `PARSED` | No versioned field threshold is published |
| Numeric confidence | F10B requires the dimensions and does not publish the scale. Parser weights are not copied |
| Payer and payee roles | v4 formats are candidates, not final orientation grammar |
| Funding instrument and initiation | Left `UNKNOWN`. A UPI line is not treated as a debit card or a mandate |
| Full identifier catalogue | Merchant id, biller id, terminal id, cheque number, and the rest are not promoted from untyped narration |
| Separate attempt, token, format-match, and review tables | This slice stores one structure row and its identifiers |
| Registry, `SELF`, `MERCHANT_PURCHASE`, spend category | Still blocked on the unapproved amendment and their own evidence |
