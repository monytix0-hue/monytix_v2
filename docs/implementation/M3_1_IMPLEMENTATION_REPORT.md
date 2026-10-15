# M3.1 implementation report

Verdict: **PASS**

The personal financial-event rulebook is a versioned interpretation of the current canonical transaction. It uses the F10D v1.2 vocabulary. Unknown stays unknown. A new rulebook version adds a row. Canonical money columns stay unchanged. Owners are isolated. Production Cloudflare R2 and ClamAV are unchanged and remain separate environment gates. F10E taxonomy is not started.

## Files

| Path | Change |
| --- | --- |
| `database/migrations/0013_m3_1_financial_event.sql` | Rule catalogue, resolution versions, guarded writer |
| `scripts/migrate.sh` | Registers `0013_m3_1_financial_event.sql` as `M3-1-FINANCIAL-EVENT` |
| `services/api/src/imports/interpret.ts` | Thin call to the writer |
| `services/api/src/imports/extract.ts` | Interprets after a statement extraction is mapped |
| `services/api/src/transactions/manual.ts` | Interprets after a manual create or replay. A failure there does not undo the canonical insert |
| `services/api/tests/financial-event.integration.test.ts` | PostgreSQL 17 cases T01–T25 |
| `services/api/package.json` | Adds that test to the package script |
| `docs/architecture/M3_1_FINANCIAL_EVENT_ARCHITECTURE.md` | Audit, precedence, and lifecycle |
| `docs/contracts/M3_1_RULEBOOK_MAPPING_CONTRACT.md` | Versioned mapping amendment |
| `docs/qa/M3_1_FINANCIAL_EVENT_TEST_MATRIX.md` | Case results |

Migrations `0001` through `0012` were not edited. No classify route was added.

## Migration

`0013_m3_1_financial_event.sql` was applied to local PostgreSQL 17 (`monytixv2-postgres-1`, database `monytix`) and registered as `M3-1-FINANCIAL-EVENT`.

`ref.financial_event_rule` holds the six mounted rules under `F10D-v1.2`. `intel.financial_event_resolution` is unique on logical transaction, canonical version, and rulebook version, with one current row per logical transaction. Row level security is enabled. `ops.interpret_financial_event` is `SECURITY DEFINER`. Execute is granted to `monytix_api` only.

## Lifecycle and precedence

The writer loads seeded clauses. Same direction, no exclusion, and any matching clause selects a rule. The lowest matching band wins. One family resolves. Two families in that band are `AMBIGUOUS`. None is `UNKNOWN`. Evidence is the canonical description, `reversal_indicator`, and parser fields on source records whose document owner is the same owner. A repeat of the same canonical version and rulebook version is a replay. A second version inserts a new current row and leaves the first row's family and rule code. The outbox event `FINANCIAL_EVENT_INTERPRETED` is inserted in that same transaction.

## Tests

`services/api/tests/financial-event.integration.test.ts`: 1 passed, 0 failed. `npx tsc -p tsconfig.json --noEmit` in `services/api` passed. Details are in the test matrix. T01 confirms direction `OUT` is not an expense. T06 confirms loan disbursement is not invented as `BORROWING`.

Manual-transaction and statement-mapping integration tests were run again on the same database: 9 passed. The extract-worker file skipped because that test also requires host-published MinIO and ClamAV. T18 already calls `ops.interpret_extraction_run`, which is the function the worker invokes after mapping.

## Security

The API role cannot insert resolutions. The intelligence role cannot execute the writer. Another actor, another owner, and a business owner do not receive a personal classification. Cross-owner source records are not stored as evidence. Rollback removes both the resolution and the outbox row.

## Known gaps

`MERCHANT_PURCHASE`, proven `INTERNAL_TRANSFER`, salary `INCOME`, and `BORROWING` need F10C or lender evidence that this slice does not have, so they stay `UNKNOWN`. Insurance, investment, tax, fee, and person-transfer catalogue rows were not mounted for the same reason. UPI v3, the legacy SQL engine, blended confidence, and F10E categories stay out. F10D's `PROVISIONAL` status is not a stored outcome; candidate evidence is `UNKNOWN`.

## Verdict

**PASS.** The mounted labels are the freeze's labels, unknown is explicit, interpretations are versioned, canonical money is unchanged, and owner isolation holds.
