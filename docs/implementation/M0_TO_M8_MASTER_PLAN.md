# M0 to M8 Master Plan

M0 is documentation. This plan does not authorize starting M1 in the same change set. Each later phase starts only when its dependencies are accepted.

Labels: **SOURCE_REQUIREMENT**, **ARCHITECTURAL_PROPOSAL**, **OPEN_DECISION**.

Rollback for every phase: forward-fix inside the phase, or restore the previous migration checkpoint and route traffic to the previous service build. Do not drop archived evidence (D10 §23.1, AC-038).

## M0 — Source audit and architecture reconciliation

| | |
| --- | --- |
| Scope | Read the repository and supplied contracts. Write the M0 document set. No DDL, no engine rewrite, no mobile edits, no deploy |
| Dependencies | None |
| Database changes | None |
| Backend endpoints | None |
| Intelligence components | None |
| Mobile dependencies | None. `mobile.zip` recorded missing |
| Tests | API stub suite 13 passed. Intelligence stub suite 15 passed. No financial case executed |
| Acceptance criteria | Fourteen M0 documents exist. Conflicts are listed and not silently closed. Working status is backed by the tests above or marked unverified |
| Security requirements | No new secrets. No production data in the documents |
| Rollback strategy | Delete or revise the M0 documents. No runtime to roll back |

Status of this phase: complete as an audit with gaps. See `M0_IMPLEMENTATION_REPORT.md`.

## M1 — Infrastructure, authentication, canonical ledger

| | |
| --- | --- |
| Scope | Node 24 image, PostgreSQL 17, private intelligence network, Firebase verification, database roles, D10-1 foundation, stop using the stub `public.transactions` as a write target, object-storage pointer design, outbox and idempotency tables for the foundation |
| Dependencies | M0. Closure or an explicit waiver for CF-01 before any business canonical table is created. OQ-12 and OQ-13 answered enough to name storage and Firebase project |
| Database changes | Reviewed D10-1 only, after it verifies on PostgreSQL 17. Do not apply parser, rulebook, MoneyMoments, or B10Q V004+ in this phase. Do not drop `0001_init.sql` objects until a later non-destructive migration replaces readers. Prefer a new migrator over `docker-entrypoint-initdb.d` for further DDL |
| Backend endpoints | Authenticated health remains. Session verification. No financial POST until idempotency and RLS exist |
| Intelligence components | Process health only. Role cannot insert canonical money |
| Mobile dependencies | None required to finish server foundation. Shells stay as they are |
| Tests | D10-1 verify script. RLS cross-owner denial. Revoked token denied. Idempotency table present. Stub suites still pass |
| Acceptance criteria | Eight schemas exist. Actor and owner are distinct. Application role does not bypass RLS. Fresh volume does not make `public.transactions` the canonical ledger |
| Security requirements | All items listed as "before any financial row" in `M0_SECURITY_ARCHITECTURE.md` |
| Rollback strategy | Restore the pre-M1 image and database volume from the backup taken at phase start. D10-1 is additive. Rolling back the app must not require dropping `core` if later data might already exist; if M1 is the only wave, a volume restore is acceptable because no production ledger exists yet |

## M2 — Source ingestion and transaction parsing

| | |
| --- | --- |
| Scope | Source connection, batch, document, extraction run, logical transaction, canonical version. Parser v4 algorithms behind Python, persisted as structure versions. Statement upload. Manual transaction path from F9 TRACE-01 |
| Dependencies | M1. CF-03 accepted (do not create `txn_fact` as truth). OQ-17 closed by the batch lock design |
| Database changes | D10-2 tables. Reference seed of v4 format registry into `ref`, not the legacy pipeline tables |
| Backend endpoints | `POST /v1/transactions/manual`, `POST /v1/imports`, signed upload completion. Gmail remains out until OQ-11 |
| Intelligence components | Parsing service. Partial status and v4 error codes preserved |
| Mobile dependencies | None to certify the server. Clients stay untouched |
| Tests | D10 DB01, DB02, DB03, DB05, DB06. One fixture per v4 channel family. Duplicate upload |
| Acceptance criteria | Two uploads of one file produce one logical transaction and two evidence links when content matches. Unresolved account is not READY. Amount stays positive |
| Security requirements | Signed URLs, size limits, malware scan policy, narration redaction in logs |
| Rollback strategy | Disable ingest routes. Keep documents. Do not delete evidence rows |

## M3 — UPI classification and financial rulebook

| | |
| --- | --- |
| Scope | VPA, provider, merchant signals, F10C party, F10D precedence, F10E taxonomy, F10F eligibility. Rulebook catalogues split into registries |
| Dependencies | M2. OQ-05 v2/v3 diff. OQ-06 SQL-versus-Python. OQ-07 taxonomy count. CF-06 code namespace |
| Database changes | D10-3 interpretation tables and `ref` seeds |
| Backend endpoints | Read current head. Category correction stays blocked (F9H-04) |
| Intelligence components | UPI scorer, event resolver, taxonomy resolver |
| Mobile dependencies | None |
| Tests | Precedence cases in the parsing reconciliation. Owner isolation. Unknown stays unknown |
| Acceptance criteria | Card bill is not a second expense when purchases exist. Internal transfer is excluded from income and expense. User correction does not rewrite source text |
| Security requirements | Raw VPA not returned on Live DTOs |
| Rollback strategy | Activate previous policy version. Old resolutions remain |

## M4 — Personal evidence, weights, and states

| | |
| --- | --- |
| Scope | F10G signals and F10H/F10J ten-weight profile. Insufficiency preserved |
| Dependencies | M3 |
| Database changes | D10-4 evidence and context tables |
| Backend endpoints | Weight fields inside the Live read model only after F9H-01 nested schema is closed or explicitly waived |
| Intelligence components | Signal and weight jobs |
| Mobile dependencies | F9I weight summary cannot be hardcoded |
| Tests | D10 DB16–DB19. Coverage gap is not zero. Quiz row immutable |
| Acceptance criteria | Exactly W1–W10. No blended financial score. `INSUFFICIENT_EVIDENCE` is distinct from a low band |
| Security requirements | Weight rows are owner-scoped |
| Rollback strategy | Previous profile snapshot becomes current by pointer, not by delete |

## M5 — Personal decisions, missions, outcomes, M.I.L.E.

| | |
| --- | --- |
| Scope | D1–D30, M01–M48, six M.I.L.E. families, impact dedupe |
| Dependencies | M4. F9H-02 and F9H-03 closed before those commands ship. CF-02 decision on Journey and points. OQ-09 publication states |
| Database changes | D10-5 action tables |
| Backend endpoints | Decision and mission routes that are DEFINED_IN_SOURCE and not BLOCKED |
| Intelligence components | Eligibility then rank. Mission cannot suppress a safety gate |
| Mobile dependencies | Still no screen rewrite required for server acceptance |
| Tests | Workbook sheet 02 positive and guard row per decision, rewritten onto F10I language where CF-02 applies. D10 DB20–DB23 |
| Acceptance criteria | High weight alone does not publish a decision. One economic event does not double-book impact. Finalized M.I.L.E. is append-only |
| Security requirements | Decision writes audited with actor id |
| Rollback strategy | Supersede evaluations. Do not mutate finalized mile rows to undo a bad release; post adjustments |

## M6 — Business intelligence and decisions

| | |
| --- | --- |
| Scope | B10A–B10O behavior on the shared evidence spine. Eighteen business decisions. Visibility states. Projection queue |
| Dependencies | M1 CF-01 mapping. M2 evidence spine. Personal phases may proceed in parallel only if they do not fork `logical_transaction`. OQ-10 legal entity |
| Database changes | Mapped B10Q objects. Apply v1.1 then v1.3 V031–V040. Do not apply colliding v1.2 numbers |
| Backend endpoints | Those named by the business Step 4 registry, after transcription |
| Intelligence components | Narration, classify, weights BW01–BW04, states, B10K visibility |
| Mobile dependencies | Business UI workbook. No client hardcoding of eligibility |
| Tests | B10Q T001–T009 on PostgreSQL 17. Table 11 scenarios, including growth suppressed by weak liquidity |
| Acceptance criteria | Mission never creates a decision. SUPPRESSED is not actionable. Credits are not assumed revenue |
| Security requirements | Tenant RLS using `b10q_current_tenant_id()` or the D10 owner setting, one mechanism, not two conflicting session variables |
| Rollback strategy | Stop J-K2 workers. Previous visibility version remains current if the new job is halted before supersede. Do not delete history |

## M7 — Habits, nudges, MolyBot, notifications

| | |
| --- | --- |
| Scope | Only the part CF-08 and OQ-04 allow. MolyBot explanations from stored lineage. FCM registration |
| Dependencies | M4 for any signal-based habit. M5 or M6 for explanations of decisions. Security controls for MolyBot |
| Database changes | None from MoneyMoments SQL unless the conflict is closed in favor of a mapped subset |
| Backend endpoints | MolyBot and FCM are MISSING_SPECIFICATION until schemas exist. Do not ship a free-text SQL tool |
| Intelligence components | Explanation assembler. Optional habit job |
| Mobile dependencies | Notification permission UX. Still no Flutter |
| Tests | Cross-owner prompt injection does not return other tenants. Nudge does not treat insufficient data as a bad habit |
| Acceptance criteria | MolyBot answers cite the authenticated owner only. No habit implies a negative condition from missing evidence |
| Security requirements | Allow-listed tools, redaction, rate limit |
| Rollback strategy | Disable the MolyBot route. Ledger unchanged |

## M8 — Native mobile integration and end-to-end certification

| | |
| --- | --- |
| Scope | Wire Android and iOS shells to the authenticated API. Bind F9 widgets to read models. Run the F10 workbook cases that are not blocked |
| Dependencies | M2–M5 for personal certification. M6 for business screens. F9H blockers closed or excluded with a written waiver. `mobile.zip` still does not gate native work. It gates any Flutter port |
| Database changes | None beyond defects found in certification |
| Backend endpoints | The DEFINED_IN_SOURCE set used by the screens under test |
| Intelligence components | Full personal chain. Business chain for business screens |
| Mobile dependencies | Existing `apps/android` and `apps/ios`. Do not replace them with generated Flutter |
| Tests | F10 exit criteria that remain in force after CF-02. Device token storage. Offline and stale states from F9 F10.3. Not unit tests alone |
| Acceptance criteria | A real device completes manual transaction, import, decision read, and isolation negative tests. Dynamic numbers match API fields. 164 high F9I gaps are closed or waived |
| Security requirements | Keychain and encrypted Android storage. No token in logs |
| Rollback strategy | Ship the previous store binary. Server remains backward compatible for one API version |

## Dependency sketch

```
M0 → M1 → M2 → M3 → M4 → M5 → M8
              ↘ M6 ─────────↗
                 M4 → M7 → M8
```

M6 can start after M1 and M2 if CF-01 is closed. It must not invent a second transaction id.

## Explicitly out of every phase until a conflict closes

- Loading parser v2–v3.2, UPI v2 and v3 together, rulebook v1 and v2, and MoneyMoments as live schemas
- Journey and M-Points as canonical ledgers (CF-02)
- Dropping legacy or stub tables
- Implementing F9H-02, F9H-03, F9H-04, or F9H-05 by invention
- Modifying Flutter code that is not in the repository
