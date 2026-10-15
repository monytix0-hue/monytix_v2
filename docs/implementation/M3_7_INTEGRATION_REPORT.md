# M3.7 integration report

Verdict: **PASS WITH GAPS**

The four layers run together on one canonical transaction without rewriting money, inventing an entity, or assigning a merchant category. No integration defect required a code or schema change. `IDENTITY-AMENDMENT-v0.1` remains proposed.

## 1. Verdict

**PASS WITH GAPS.** T01–T13 and T15–T25 passed. T14 confirmed that a second parser version does not exist, so a parser upgrade was not executed. The known gaps from M3.2, M3.3, and M3.6 are unchanged.

## 2. Actual execution order

Statement worker: map, F10B, F10D, F10E, F10C. Manual post: canonical insert, then the same four calls. F10E is the only step that reads another intelligence row. The others do not.

## 3. Dependency matrix

`docs/architecture/M3_7_INTELLIGENCE_PIPELINE_DEPENDENCIES.md`.

F10B reads the canonical narration. F10D reads the canonical narration and same-owner parser channel, subtype, and format. F10E reads the current F10D resolution. F10C reads same-owner parser fields. F10C does not read `intel.transaction_structure`.

## 4. Integration defects

None that failed a test. The map function's success value is `mapped`, which the new test now expects. That was a test expectation, not a product defect.

F10C still does not consume the F10B structure. The freeze requires a structure id on a `RESOLVED` publication, and this pipeline does not publish `RESOLVED`. The unapproved identity amendment is what would authorize a later join. The existing evidence path stays.

## 5. Changes made

`services/api/tests/intelligence-pipeline.integration.test.ts` was added and registered in the API test script. Migrations `0001`–`0016` were not edited. No registry, owner-VPA, `SELF`, `MERCHANT_PURCHASE`, category, confidence, or retention rule was added.

## 6. Tests executed

The matrix is `docs/qa/M3_7_INTEGRATION_TEST_MATRIX.md`. One PostgreSQL 17 test, pass, about 549 ms, as `monytix_api`.

## 7. Versioning and replay

Same idempotency key replayed the manual transaction. A second pipeline call did not add a second structure or event. New F10B, F10C, F10D, and F10E versions each inserted a row and left the previous row's status or family intact. Rollback removed the in-flight structure. Two concurrent callers left one structure and one event.

## 8. Security

Another actor is `forbidden`. A second owner's VPA on the evidence link created no observation. A business owner is `business_isolated` on all four writers and gets no event row. Outbox payloads for the imported UPI transaction did not contain the handle. Historical logical ids on account `01a12b2d-3324-71e2-8fbd-4faf2ec90b2a` were unchanged.

## 9. Remaining blockers

Governed registry. Approval of `IDENTITY-AMENDMENT-v0.1`. Privacy and erasure specification. Numeric confidence and the `PARSED` threshold. Owner-VPA and `SELF`. `MERCHANT_PURCHASE` and F10E merchant categories. A second parser version. Production R2 and ClamAV.

## 10. Recommended next milestone

The personal-contract approver accepts or rejects `IDENTITY-AMENDMENT-v0.1`. Do not start the registry, `SELF`, or merchant categories before that decision and the missing privacy specification.
