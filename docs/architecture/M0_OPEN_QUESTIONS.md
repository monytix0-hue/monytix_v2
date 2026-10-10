# M0 Open Questions

These items block a correct implementation choice. M0 does not guess them.

| ID | Question | Why it is open | Needed before |
| --- | --- | --- | --- |
| OQ-01 | Does one human ever own both a personal `core.owner` and a business `core.owner` in the same session, and how is the active owner selected? | D10 separates actor and owner. F9I shows a P / BIZ mode label on Live (`F9B2-0001`, `F9B2-0002`) but the mode is marked static client copy. No API in the audited F9 extract switches owner type | M1 auth and M8 Live |
| OQ-02 | Confirm the column-level map from B10Q `ingest` / `parse` / `normalize` / `canonical` onto D10 `core` (CF-01). Which B10 columns have no D10 home? | Both packs are frozen. Loading both creates two ledgers | M1 |
| OQ-03 | Are Journey and M-Points in the F10 workbook still product requirements after D10 Table 19 retired `rewards.*` and journey? | CF-02. Eighteen workbook scenarios are already marked BLOCKED | M5 and M7 |
| OQ-04 | Should MoneyMoments v2 habits and 12 nudge rules be re-specified on top of F10G signals, or is that package archival only? | D10 says RETIRE nudges and selective salvage of daily signals. The M0 brief still lists habits and nudges as product scope | M7 |
| OQ-05 | Is UPI classifier v3 a superset of the v2 design's 22 signals, or does it change precedence? | Design document is v2. Later SQL file is v3. No FINAL FREEZE mark was found on either | M3 |
| OQ-06 | May classification execute as the supplied SQL functions, or must those functions be ported to Python so policy versions stay in F10 services? | D10 §18 discourages hidden classification procedures. The supplied engines are SQL | M3 |
| OQ-07 | What is the exact F10E category and subcategory count, and does it equal the workbook's 26 / 145? | F10-E2E-001 states 26/145. F10E v1.2 is authoritative. Counts were not reconciled in M0 | M3 |
| OQ-08 | Which F9H payload tables are complete enough to generate OpenAPI, given F9H-01 (nested read models), F9H-02 (decision actions), F9H-03 (mission contribution), F9H-04 (category correction), F9H-05 (rewards authority)? | F9 §14 says not to silently reconcile P0 items. The workbook sheet 10 repeats them as OPEN | M1–M5 API work |
| OQ-09 | Does personal decision publication use the business states REQUIRED / MISSION_RELEVANT / AVAILABLE / SUPPRESSED? | Personal Master §13 defines financial eligibility and mission reveal. B10Q v1.3 Table 7 names the four states for D01–D18 only | M5 |
| OQ-10 | How does a business legal entity relate to `core.owner`? | CF-19. B10E party resolution and D10 owner are different concepts that share words | M6 |
| OQ-11 | Where are Gmail OAuth client, mailbox scope, and message retention specified? | D10 `source_connection` includes email. This audit did not find a Gmail API field dictionary in F9 extracts. F10A is the intake authority and must be read for the adapter contract before build | M2 |
| OQ-12 | What object-storage vendor and bucket policy are approved for statement bytes? | D10 §19 says bytes are outside Postgres. No vendor is named in the repository | M1 |
| OQ-13 | Is Firebase the only identity provider, and which project id is production? | Stack brief says Firebase. No project id is in `.env.example`. D10 stores provider subject on `authenticated_actor` and forbids storing credentials | M1 |
| OQ-14 | Personal-v1 partition posture is "not yet" (D10 FD-04). Is any business table required to be partitioned at first deploy because B10Q already assumes volume? | Not established by this audit | M6 |
| OQ-15 | `mobile.zip` contents are unknown. Do they contain Flutter screens that must be ported, or only design exports? | File absent. Native stubs exist and must not be overwritten from imagination | M8 |
| OQ-16 | F9I records 164 high-severity content gaps and says dynamic numbers must not be hardcoded. Which gaps are release blockers versus accepted static copy? | Sheet `00_Summary`: 1,367 elements, 274 rows with gap notes, 164 high. Element-level closure was not done in M0 | M8 |
| OQ-17 | Parser v4 concurrency: the reference describes three stages and error codes. It does not, in the sections read, define a lock protocol when two workers parse the same batch | Idempotency must come from D10 source hashes, not from an undocumented SQL assumption | M2 |
| OQ-18 | Does F10F's multi-dimension confidence replace the rulebook's single `confidence_score` of 0.0–1.0? | F10F forbids one blended "92%" as authority. The rulebook reference still stores one score | M3 |
| OQ-19 | Which primary-weight column is binding for personal decisions when F10I and workbook sheet 02 disagree (CF-21)? | Example: D10 and D11 | M5 |

No open question above was closed by a default in the architecture documents. Where a document states a proposal, the matching conflict id is the authority for whether work may start.
