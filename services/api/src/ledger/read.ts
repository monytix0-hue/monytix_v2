import pg from "pg";

export type LedgerRead = {
  listTransactions(input: ListInput): Promise<TransactionPage>;
  accountSummaries(ownerId: string): Promise<AccountSummary[]>;
  overview(input: OverviewInput): Promise<Overview>;
  close(): Promise<void>;
};

export type ListInput = {
  ownerId: string;
  limit: number;
  cursor: string | null;
  from: string | null;
  to: string | null;
  accountId: string | null;
  direction: "IN" | "OUT" | null;
  eventFamily: string | null;
};

export type TransactionItem = {
  logicalTransactionId: string;
  canonicalTransactionVersionId: string;
  accountId: string;
  amount: string | null;
  currency: string | null;
  direction: string;
  transactionDate: string | null;
  description: string | null;
  duplicateOutcome: string;
  changeProvenance: string;
  financialEvent: {
    outcome: string;
    family: string | null;
    rulebookVersion: string;
    matchedRuleCode: string | null;
  } | null;
  financialUse: {
    categoryStatus: string;
    categoryCode: string | null;
    taxonomyVersion: string;
    purposeStatus: string | null;
    purposeCode: string | null;
  } | null;
  party: {
    status: string;
    version: string;
  } | null;
};

export type TransactionPage = {
  items: TransactionItem[];
  nextCursor: string | null;
};

export type MoneyTotal = {
  currency: string;
  inflow: string;
  outflow: string;
  count: number;
};

export type AccountSummary = {
  accountId: string;
  displayName: string | null;
  currency: string;
  transactionCount: number;
  totals: MoneyTotal[];
  availableBalance: {
    amount: string;
    currency: string;
    observedAt: string;
  } | null;
};

export type OverviewInput = {
  ownerId: string;
  from: string | null;
  to: string | null;
  currency: string | null;
};

export type Overview = {
  from: string | null;
  to: string | null;
  currencies: Array<{
    currency: string;
    inflow: string;
    outflow: string;
    ordinaryOutflow: string;
    transactionCount: number;
    events: Array<{ family: string | null; outcome: string; count: number; inflow: string; outflow: string }>;
    uses: Array<{ status: string; code: string | null; count: number }>;
    transactionsWithoutEvent: number;
    transactionsWithoutUse: number;
  }>;
};

type Row = {
  logical_transaction_id: string;
  canonical_transaction_version_id: string;
  financial_account_id: string;
  amount: string | null;
  currency_code: string | null;
  direction: string;
  transaction_date: Date | string | null;
  raw_description: string | null;
  duplicate_outcome: string;
  change_provenance: string;
  resolution_outcome: string | null;
  event_family: string | null;
  rulebook_version: string | null;
  matched_rule_code: string | null;
  category_status: string | null;
  category_code: string | null;
  taxonomy_version: string | null;
  purpose_status: string | null;
  purpose_code: string | null;
  party_status: string | null;
  f10c_version: string | null;
};

const excludedOrdinaryFamilies = ["INTERNAL_TRANSFER", "PERSON_TRANSFER", "CREDIT_CARD_PAYMENT", "LOAN_REPAYMENT"];

const listSql = `
SELECT
  cv.logical_transaction_id,
  cv.canonical_transaction_version_id,
  cv.financial_account_id,
  cv.amount::text AS amount,
  cv.currency_code,
  cv.direction,
  cv.transaction_date,
  cv.raw_description,
  cv.duplicate_outcome,
  cv.change_provenance,
  e.resolution_outcome,
  e.event_family,
  e.rulebook_version,
  e.matched_rule_code,
  c.category_status,
  c.category_code,
  c.taxonomy_version,
  p.purpose_status,
  p.purpose_code,
  party.resolution_status AS party_status,
  party.f10c_version
FROM core.canonical_transaction_version cv
JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
LEFT JOIN intel.financial_event_resolution e
  ON e.logical_transaction_id = cv.logical_transaction_id
 AND e.canonical_transaction_version_id = cv.canonical_transaction_version_id
 AND e.is_current
LEFT JOIN intel.category_resolution c
  ON c.financial_event_resolution_id = e.financial_event_resolution_id
 AND c.is_current
LEFT JOIN intel.purpose_resolution p
  ON p.financial_event_resolution_id = e.financial_event_resolution_id
 AND p.is_current
LEFT JOIN intel.transaction_party_resolution party
  ON party.logical_transaction_id = cv.logical_transaction_id
 AND party.canonical_transaction_version_id = cv.canonical_transaction_version_id
 AND party.is_current
WHERE cv.is_current = true
  AND lt.identity_status = 'ACTIVE'
  AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
  AND ($1::uuid IS NULL OR cv.financial_account_id = $1)
  AND ($2::text IS NULL OR cv.direction = $2)
  AND ($3::date IS NULL OR cv.transaction_date >= $3)
  AND ($4::date IS NULL OR cv.transaction_date <= $4)
  AND (
    $5::date IS NULL
    OR cv.transaction_date < $5
    OR (cv.transaction_date = $5 AND cv.logical_transaction_id < $6::uuid)
  )
  AND ($8::text IS NULL OR (e.resolution_outcome = 'RESOLVED' AND e.event_family = $8))
ORDER BY cv.transaction_date DESC, cv.logical_transaction_id DESC
LIMIT $7
`;

export function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { date: string; id: string } | null {
  try {
    const text = Buffer.from(cursor, "base64url").toString("utf8");
    const split = text.indexOf("|");
    if (split < 10) {
      return null;
    }
    const date = text.slice(0, split);
    const id = text.slice(split + 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[0-9a-f-]{36}$/i.test(id)) {
      return null;
    }
    return { date, id };
  } catch {
    return null;
  }
}

function dateText(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function mapItem(row: Row): TransactionItem {
  return {
    logicalTransactionId: row.logical_transaction_id,
    canonicalTransactionVersionId: row.canonical_transaction_version_id,
    accountId: row.financial_account_id,
    amount: row.amount,
    currency: row.currency_code?.trim() ?? null,
    direction: row.direction,
    transactionDate: dateText(row.transaction_date),
    description: row.raw_description,
    duplicateOutcome: row.duplicate_outcome,
    changeProvenance: row.change_provenance,
    financialEvent: row.resolution_outcome
      ? {
          outcome: row.resolution_outcome,
          family: row.event_family,
          rulebookVersion: row.rulebook_version ?? "",
          matchedRuleCode: row.matched_rule_code,
        }
      : null,
    financialUse: row.category_status
      ? {
          categoryStatus: row.category_status,
          categoryCode: row.category_code,
          taxonomyVersion: row.taxonomy_version ?? "",
          purposeStatus: row.purpose_status,
          purposeCode: row.purpose_code,
        }
      : null,
    party: row.party_status
      ? {
          status: row.party_status,
          version: row.f10c_version ?? "",
        }
      : null,
  };
}

export function createLedgerRead(databaseUrl: string): LedgerRead {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });

  async function withOwner<T>(ownerId: string, read: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.owner_id', $1, true)", [ownerId]);
      const value = await read(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async listTransactions(input) {
      const cursor = input.cursor ? decodeCursor(input.cursor) : null;
      return withOwner(input.ownerId, async (client) => {
        const rows = await client.query<Row>(listSql, [
          input.accountId,
          input.direction,
          input.from,
          input.to,
          cursor?.date ?? null,
          cursor?.id ?? null,
          input.limit + 1,
          input.eventFamily,
        ]);
        const page = rows.rows.slice(0, input.limit).map(mapItem);
        const extra = rows.rows.length > input.limit ? page[page.length - 1] : null;
        return {
          items: page,
          nextCursor: extra?.transactionDate
            ? encodeCursor(extra.transactionDate, extra.logicalTransactionId)
            : null,
        };
      });
    },

    async accountSummaries(ownerId) {
      return withOwner(ownerId, async (client) => {
        const accounts = await client.query<{
          financial_account_id: string;
          account_display_name: string | null;
          base_currency_code: string;
        }>(
          `SELECT financial_account_id, account_display_name, base_currency_code
             FROM core.financial_account
            ORDER BY financial_account_id`,
        );
        const totals = await client.query<{
          financial_account_id: string;
          currency_code: string;
          count: number;
          inflow: string;
          outflow: string;
        }>(
          `SELECT cv.financial_account_id,
                  cv.currency_code,
                  count(*)::int AS count,
                  COALESCE(sum(cv.amount) FILTER (WHERE cv.direction = 'IN'), 0)::text AS inflow,
                  COALESCE(sum(cv.amount) FILTER (WHERE cv.direction = 'OUT'), 0)::text AS outflow
             FROM core.canonical_transaction_version cv
             JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
            WHERE cv.is_current
              AND lt.identity_status = 'ACTIVE'
              AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
              AND cv.amount IS NOT NULL
              AND cv.currency_code IS NOT NULL
            GROUP BY cv.financial_account_id, cv.currency_code`,
        );
        const balances = await client.query<{
          financial_account_id: string;
          balance_amount: string;
          currency_code: string;
          observed_at: Date;
        }>(
          `SELECT DISTINCT ON (financial_account_id)
                  financial_account_id, balance_amount::text, currency_code, observed_at
             FROM core.balance_snapshot
            WHERE balance_type = 'AVAILABLE'
            ORDER BY financial_account_id, observed_at DESC`,
        );
        return accounts.rows.map((account) => {
          const accountTotals = totals.rows.filter((row) => row.financial_account_id === account.financial_account_id);
          const balance = balances.rows.find((row) => row.financial_account_id === account.financial_account_id);
          return {
            accountId: account.financial_account_id,
            displayName: account.account_display_name,
            currency: account.base_currency_code.trim(),
            transactionCount: accountTotals.reduce((sum, row) => sum + row.count, 0),
            totals: accountTotals.map((row) => ({
              currency: row.currency_code.trim(),
              inflow: row.inflow,
              outflow: row.outflow,
              count: row.count,
            })),
            availableBalance: balance
              ? {
                  amount: balance.balance_amount,
                  currency: balance.currency_code.trim(),
                  observedAt: balance.observed_at.toISOString(),
                }
              : null,
          };
        });
      });
    },

    async overview(input) {
      return withOwner(input.ownerId, async (client) => {
        const totals = await client.query<{
          currency_code: string;
          inflow: string;
          outflow: string;
          ordinary_outflow: string;
          count: number;
          without_event: number;
          without_use: number;
        }>(
          `SELECT cv.currency_code,
                  COALESCE(sum(cv.amount) FILTER (WHERE cv.direction = 'IN'), 0)::text AS inflow,
                  COALESCE(sum(cv.amount) FILTER (WHERE cv.direction = 'OUT'), 0)::text AS outflow,
                  COALESCE(sum(cv.amount) FILTER (
                    WHERE cv.direction = 'OUT'
                      AND e.resolution_outcome = 'RESOLVED'
                      AND e.event_family <> ALL ($3::text[])
                  ), 0)::text AS ordinary_outflow,
                  count(*)::int AS count,
                  count(*) FILTER (WHERE e.financial_event_resolution_id IS NULL)::int AS without_event,
                  count(*) FILTER (WHERE c.category_resolution_id IS NULL)::int AS without_use
             FROM core.canonical_transaction_version cv
             JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
             LEFT JOIN intel.financial_event_resolution e
               ON e.logical_transaction_id = cv.logical_transaction_id
              AND e.canonical_transaction_version_id = cv.canonical_transaction_version_id
              AND e.is_current
             LEFT JOIN intel.category_resolution c
               ON c.financial_event_resolution_id = e.financial_event_resolution_id
              AND c.is_current
            WHERE cv.is_current
              AND lt.identity_status = 'ACTIVE'
              AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
              AND cv.amount IS NOT NULL
              AND cv.currency_code IS NOT NULL
              AND ($1::date IS NULL OR cv.transaction_date >= $1)
              AND ($2::date IS NULL OR cv.transaction_date <= $2)
              AND ($4::text IS NULL OR cv.currency_code = $4)
            GROUP BY cv.currency_code
            ORDER BY cv.currency_code`,
          [input.from, input.to, excludedOrdinaryFamilies, input.currency],
        );
        const events = await client.query<{
          currency_code: string;
          event_family: string | null;
          resolution_outcome: string;
          count: number;
          inflow: string;
          outflow: string;
        }>(
          `SELECT cv.currency_code,
                  e.event_family,
                  COALESCE(e.resolution_outcome, 'UNAVAILABLE') AS resolution_outcome,
                  count(*)::int AS count,
                  COALESCE(sum(cv.amount) FILTER (WHERE cv.direction = 'IN'), 0)::text AS inflow,
                  COALESCE(sum(cv.amount) FILTER (WHERE cv.direction = 'OUT'), 0)::text AS outflow
             FROM core.canonical_transaction_version cv
             JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
             LEFT JOIN intel.financial_event_resolution e
               ON e.logical_transaction_id = cv.logical_transaction_id
              AND e.canonical_transaction_version_id = cv.canonical_transaction_version_id
              AND e.is_current
            WHERE cv.is_current
              AND lt.identity_status = 'ACTIVE'
              AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
              AND cv.amount IS NOT NULL
              AND cv.currency_code IS NOT NULL
              AND ($1::date IS NULL OR cv.transaction_date >= $1)
              AND ($2::date IS NULL OR cv.transaction_date <= $2)
              AND ($3::text IS NULL OR cv.currency_code = $3)
            GROUP BY cv.currency_code, e.event_family, e.resolution_outcome
            ORDER BY cv.currency_code, e.event_family`,
          [input.from, input.to, input.currency],
        );
        const uses = await client.query<{
          currency_code: string;
          category_status: string;
          category_code: string | null;
          count: number;
        }>(
          `SELECT cv.currency_code,
                  COALESCE(c.category_status, 'UNAVAILABLE') AS category_status,
                  c.category_code,
                  count(*)::int AS count
             FROM core.canonical_transaction_version cv
             JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
             LEFT JOIN intel.financial_event_resolution e
               ON e.logical_transaction_id = cv.logical_transaction_id
              AND e.canonical_transaction_version_id = cv.canonical_transaction_version_id
              AND e.is_current
             LEFT JOIN intel.category_resolution c
               ON c.financial_event_resolution_id = e.financial_event_resolution_id
              AND c.is_current
            WHERE cv.is_current
              AND lt.identity_status = 'ACTIVE'
              AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
              AND cv.amount IS NOT NULL
              AND cv.currency_code IS NOT NULL
              AND ($1::date IS NULL OR cv.transaction_date >= $1)
              AND ($2::date IS NULL OR cv.transaction_date <= $2)
              AND ($3::text IS NULL OR cv.currency_code = $3)
            GROUP BY cv.currency_code, c.category_status, c.category_code
            ORDER BY cv.currency_code, c.category_status, c.category_code`,
          [input.from, input.to, input.currency],
        );
        return {
          from: input.from,
          to: input.to,
          currencies: totals.rows.map((total) => ({
            currency: total.currency_code.trim(),
            inflow: total.inflow,
            outflow: total.outflow,
            ordinaryOutflow: total.ordinary_outflow,
            transactionCount: total.count,
            events: events.rows
              .filter((row) => row.currency_code.trim() === total.currency_code.trim())
              .map((row) => ({
                family: row.event_family,
                outcome: row.resolution_outcome,
                count: row.count,
                inflow: row.inflow,
                outflow: row.outflow,
              })),
            uses: uses.rows
              .filter((row) => row.currency_code.trim() === total.currency_code.trim())
              .map((row) => ({
                status: row.category_status,
                code: row.category_code,
                count: row.count,
              })),
            transactionsWithoutEvent: total.without_event,
            transactionsWithoutUse: total.without_use,
          })),
        };
      });
    },

    async close() {
      await pool.end();
    },
  };
}
