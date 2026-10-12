import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { createLedgerRead } from "../src/ledger/read.js";

const adminUrl = process.env.M2_TEST_ADMIN_URL ?? "postgres://monytix:monytix@127.0.0.1:5432/monytix";
const apiUrl = process.env.M2_TEST_DATABASE_URL ?? "postgres://monytix_api:monytix_api_local@127.0.0.1:5432/monytix";
const scales = [1_000, 10_000, 100_000];

function percentile(values: number[], rank: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1));
  return Math.round(sorted[index] ?? 0);
}

async function timed(run: () => Promise<unknown>): Promise<{ p50: number; p95: number; p99: number }> {
  const samples: number[] = [];
  for (let sample = 0; sample < 20; sample += 1) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }
  return { p50: percentile(samples, 50), p95: percentile(samples, 95), p99: percentile(samples, 99) };
}

function dockerStats(): Promise<string> {
  return new Promise((resolve) => {
    execFile("docker", ["stats", "--no-stream", "--format", "{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}", "monytixv2-postgres-1"], (error, stdout) => {
      resolve(error ? "unavailable" : stdout.trim());
    });
  });
}

const childTables = [
  "intel.entity_observation",
  "intel.transaction_party_resolution",
  "intel.transaction_structure",
  "intel.purpose_resolution",
  "intel.category_resolution",
  "intel.financial_event_resolution",
  "core.transaction_evidence_link",
  "core.source_record_disposition",
];

async function removeFixture(ownerId: string, accountIds: string[], displayName: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    for (const table of childTables) {
      await client.query(
        `DELETE FROM ${table} child
          USING core.logical_transaction lt
         WHERE child.logical_transaction_id = lt.logical_transaction_id
           AND lt.financial_account_id = ANY($1::uuid[])`,
        [accountIds],
      );
    }
    await client.query(
      `UPDATE core.canonical_transaction_version
          SET is_current = false
        WHERE financial_account_id = ANY($1::uuid[])`,
      [accountIds],
    );
    await client.query(
      `UPDATE core.logical_transaction
          SET current_canonical_version_id = NULL
        WHERE financial_account_id = ANY($1::uuid[])`,
      [accountIds],
    );
    await client.query(
      "DELETE FROM core.canonical_transaction_version WHERE financial_account_id = ANY($1::uuid[])",
      [accountIds],
    );
    await client.query(
      "DELETE FROM core.logical_transaction WHERE financial_account_id = ANY($1::uuid[])",
      [accountIds],
    );
    await client.query(
      "DELETE FROM core.account_ownership WHERE owner_id = $1 AND financial_account_id = ANY($2::uuid[])",
      [ownerId, accountIds],
    );
    await client.query(
      `DELETE FROM core.financial_account account
        WHERE account.financial_account_id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1 FROM core.account_ownership ownership
             WHERE ownership.financial_account_id = account.financial_account_id
          )`,
      [accountIds],
    );
    await client.query(
      `DELETE FROM core.owner owner
        WHERE owner.owner_id = $1
          AND owner.display_name = $2
          AND NOT EXISTS (
            SELECT 1 FROM core.account_ownership ownership
             WHERE ownership.owner_id = owner.owner_id
          )`,
      [ownerId, displayName],
    );
    await client.query("COMMIT");
    const left = await client.query<{ owners: string; accounts: string; logical_rows: string; canonical_rows: string }>(
      `SELECT
         (SELECT count(*) FROM core.owner WHERE owner_id = $1) AS owners,
         (SELECT count(*) FROM core.financial_account WHERE financial_account_id = ANY($2::uuid[])) AS accounts,
         (SELECT count(*) FROM core.logical_transaction WHERE financial_account_id = ANY($2::uuid[])) AS logical_rows,
         (SELECT count(*) FROM core.canonical_transaction_version WHERE financial_account_id = ANY($2::uuid[])) AS canonical_rows`,
      [ownerId, accountIds],
    );
    const row = left.rows[0];
    if (!row || [row.owners, row.accounts, row.logical_rows, row.canonical_rows].some((count) => Number(count) !== 0)) {
      throw new Error(`fixture rows remain ${JSON.stringify(row)}`);
    }
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const displayName = `perf-${Date.now()}`;
  let ownerId = "";
  let inr = "";
  let usd = "";
  const ledger = createLedgerRead(apiUrl);
  try {
  const owner = await admin.query<{ owner_id: string }>(
    "INSERT INTO core.owner (owner_type, display_name) VALUES ('PERSON', $1) RETURNING owner_id",
    [displayName],
  );
  ownerId = owner.rows[0]!.owner_id;
  const accounts = await admin.query<{ financial_account_id: string }>(
    `INSERT INTO core.financial_account (account_type, account_display_name, base_currency_code, lifecycle_status)
     VALUES ('SAVINGS', 'INR', 'INR', 'ACTIVE'), ('SAVINGS', 'USD', 'USD', 'ACTIVE')
     RETURNING financial_account_id`,
  );
  inr = accounts.rows[0]!.financial_account_id;
  usd = accounts.rows[1]!.financial_account_id;
  await admin.query(
    `INSERT INTO core.account_ownership (owner_id, financial_account_id, relationship_role, verification_state, relationship_status)
     VALUES ($1, $2, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE'), ($1, $3, 'PRIMARY_HOLDER', 'VERIFIED', 'ACTIVE')`,
    [ownerId, inr, usd],
  );
  await admin.query("CREATE TEMP TABLE perf_load (n integer PRIMARY KEY, logical_id uuid, version_id uuid, account_id uuid, direction text, currency char(3), duplicate text, txn_date date)");
  const results = [];
  let loaded = 0;
    for (const scale of scales) {
      const started = performance.now();
      await admin.query("BEGIN");
      await admin.query(
        `INSERT INTO perf_load (n, logical_id, version_id, account_id, direction, currency, duplicate, txn_date)
         SELECT n,
                ops.uuid_v7(),
                ops.uuid_v7(),
                CASE WHEN n % 5 = 0 THEN $2::uuid ELSE $1::uuid END,
                CASE WHEN n % 3 = 0 THEN 'IN' ELSE 'OUT' END,
                CASE WHEN n % 5 = 0 THEN 'USD' ELSE 'INR' END,
                CASE WHEN n % 20 = 0 THEN 'EQUIVALENT_SUPERSEDED' ELSE 'DISTINCT' END,
                DATE '2024-01-01' + (n % 1200)
           FROM generate_series($3::int, $4::int) AS n`,
        [inr, usd, loaded + 1, scale],
      );
      await admin.query(
        `INSERT INTO core.logical_transaction (logical_transaction_id, financial_account_id)
         SELECT logical_id, account_id FROM perf_load WHERE n > $1`,
        [loaded],
      );
      await admin.query(
        `INSERT INTO core.canonical_transaction_version (
           canonical_transaction_version_id, logical_transaction_id, version_no, is_current, financial_account_id,
           transaction_date, amount, direction, currency_code, raw_description, extraction_sequence,
           normalization_status, normalization_confidence, normalization_version, change_provenance, duplicate_outcome, reversal_indicator
         )
         SELECT version_id, logical_id, 1, false, account_id, txn_date, 10, direction, currency, 'perf', 1,
                'READY', 0, 'perf', 'MIGRATION_CORRECTION', duplicate, false
           FROM perf_load WHERE n > $1`,
        [loaded],
      );
      await admin.query(
        `INSERT INTO core.canonical_transaction_version (
           logical_transaction_id, version_no, is_current, financial_account_id, transaction_date, amount, direction, currency_code,
           raw_description, extraction_sequence, normalization_status, normalization_confidence, normalization_version,
           change_provenance, duplicate_outcome, reversal_indicator
         )
         SELECT logical_id, 2, false, account_id, txn_date, 999, direction, currency, 'replaced', 2,
                'READY', 0, 'perf', 'MIGRATION_CORRECTION', 'DISTINCT', false
           FROM perf_load WHERE n > $1 AND n % 20 = 0`,
        [loaded],
      );
      await admin.query(
        `UPDATE core.canonical_transaction_version cv
            SET is_current = true
           FROM perf_load p
          WHERE cv.canonical_transaction_version_id = p.version_id AND p.n > $1`,
        [loaded],
      );
      await admin.query(
        `UPDATE core.logical_transaction lt
            SET current_canonical_version_id = p.version_id
           FROM perf_load p
          WHERE lt.logical_transaction_id = p.logical_id AND p.n > $1`,
        [loaded],
      );
      await admin.query(
        `INSERT INTO intel.financial_event_resolution (
           logical_transaction_id, canonical_transaction_version_id, rulebook_version, matched_rule_code,
           precedence_band, resolution_outcome, event_family
         )
         SELECT logical_id, version_id, 'F10D-v1.2',
                CASE
                  WHEN n % 11 = 3 THEN NULL
                  WHEN n % 11 = 0 AND direction = 'OUT' THEN 'EMI_001'
                  WHEN n % 11 = 1 AND direction = 'OUT' THEN 'CC_001'
                  WHEN n % 11 = 2 THEN 'TRF_002'
                  WHEN direction = 'IN' THEN 'INC_040'
                  ELSE 'MER_001'
                END,
                CASE WHEN n % 11 = 3 THEN NULL ELSE 'P1' END,
                CASE WHEN n % 11 = 3 THEN 'UNKNOWN' ELSE 'RESOLVED' END,
                CASE
                  WHEN n % 11 = 3 THEN NULL
                  WHEN n % 11 = 0 AND direction = 'OUT' THEN 'LOAN_REPAYMENT'
                  WHEN n % 11 = 1 AND direction = 'OUT' THEN 'CREDIT_CARD_PAYMENT'
                  WHEN n % 11 = 2 THEN 'INTERNAL_TRANSFER'
                  WHEN direction = 'IN' THEN 'INCOME'
                  ELSE 'MERCHANT_PURCHASE'
                END
           FROM perf_load
          WHERE n > $1 AND duplicate = 'DISTINCT'`,
        [loaded],
      );
      await admin.query("COMMIT");
      loaded = scale;
      const loadMs = Math.round(performance.now() - started);
      const listMs = await timed(() => ledger.listTransactions({
        ownerId, limit: 20, cursor: null, from: null, to: null, accountId: null, direction: null, eventFamily: null,
      }));
      const summaryMs = await timed(() => ledger.accountSummaries(ownerId));
      const postgresDuring = dockerStats();
      const overviewMs = await timed(() => ledger.overview({ ownerId, from: "2024-01-01", to: "2027-12-31", currency: "INR" }));
      const molybotMs = await timed(async () => {
        await ledger.overview({ ownerId, from: "2026-10-01", to: "2026-10-31", currency: null });
        await ledger.listTransactions({
          ownerId, limit: 50, cursor: null, from: null, to: null, accountId: null, direction: null, eventFamily: "LOAN_REPAYMENT",
        });
      });
      const page = await ledger.listTransactions({
        ownerId, limit: 20, cursor: null, from: null, to: null, accountId: null, direction: null, eventFamily: null,
      });
      const overview = await ledger.overview({ ownerId, from: "2024-01-01", to: "2027-12-31", currency: "INR" });
      const summaries = await ledger.accountSummaries(ownerId);
      const api = new pg.Client({ connectionString: apiUrl });
      await api.connect();
      await api.query("BEGIN");
      await api.query("SELECT set_config('app.owner_id', $1, true)", [ownerId]);
      await api.query("SELECT set_config('jit', 'off', true)");
      const plan = await api.query<{ "QUERY PLAN": string }>(
        `EXPLAIN (ANALYZE, BUFFERS)
         SELECT cv.logical_transaction_id
           FROM core.canonical_transaction_version cv
           JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
          WHERE cv.is_current AND lt.identity_status = 'ACTIVE' AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
          ORDER BY cv.transaction_date DESC, cv.logical_transaction_id DESC
          LIMIT 20`,
      );
      await api.query("COMMIT");
      await api.end();
      const inrSummary = summaries.find((account) => account.accountId === inr);
      results.push({
        rows: scale,
        loadMs,
        listMs,
        summaryMs,
        overviewMs,
        molybotMs,
        page: page.items.length,
        currencies: overview.currencies.map((row) => row.currency),
        inrOutflow: overview.currencies[0]?.outflow,
        ordinaryOutflow: overview.currencies[0]?.ordinaryOutflow,
        summaryCurrencies: inrSummary?.totals.map((total) => total.currency),
        availableBalance: inrSummary?.availableBalance ?? null,
        heapMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
        postgres: await postgresDuring,
        plan: plan.rows
          .map((row) => row["QUERY PLAN"])
          .filter((line) => line.startsWith("Limit") || line.includes("Execution Time") || line.includes("Buffers:")),
      });
      console.log(JSON.stringify(results[results.length - 1]));
    }
  } finally {
    await admin.query("ROLLBACK").catch(() => undefined);
    await admin.end().catch(() => undefined);
    if (ownerId) {
      await removeFixture(ownerId, [inr, usd].filter((id) => id.length > 0), displayName);
    }
    await ledger.close();
  }
}

await main();
