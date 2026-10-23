import pg from "pg";
import { openPool } from "../db/pool.js";

export type LedgerRead = {
  listTransactions(input: ListInput): Promise<TransactionPage>;
  transactionFilters(ownerId: string): Promise<TransactionFilters>;
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
  category: string | null;
  subcategory: string | null;
  eventFamily: string | null;
};

export type FilterChoice = {
  code: string;
  name: string;
};

export type CategoryFilter = FilterChoice & {
  subcategories: FilterChoice[];
};

export type TransactionFilters = {
  categories: CategoryFilter[];
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
  categoryCode: string | null;
  categoryName: string | null;
  subcategoryCode: string | null;
  subcategoryName: string | null;
  accountName: string | null;
  reference: string | null;
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
  subcategory_code: string | null;
  category_name: string | null;
  subcategory_name: string | null;
  account_display_name: string | null;
  source_reference: string | null;
  taxonomy_version: string | null;
  purpose_status: string | null;
  purpose_code: string | null;
  party_status: string | null;
  f10c_version: string | null;
};

const excludedOrdinaryFamilies = ["INTERNAL_TRANSFER", "PERSON_TRANSFER", "CREDIT_CARD_PAYMENT", "LOAN_REPAYMENT"];

const pageFilters = `
  cv.is_current = true
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
  AND (
    $8::text IS NULL
    OR ($8 = 'none' AND COALESCE(choice.category_code, resolved.category_code) IS NULL)
    OR ($8 <> 'none' AND COALESCE(choice.category_code, resolved.category_code) = $8)
  )
  AND (
    $9::text IS NULL
    OR ($9 = 'none' AND COALESCE(choice.subcategory_code, resolved.subcategory_code) IS NULL)
    OR ($9 <> 'none' AND COALESCE(choice.subcategory_code, resolved.subcategory_code) = $9)
  )
`;

const categoryLaterals = `
LEFT JOIN LATERAL (
  SELECT choice.category_code, choice.subcategory_code
    FROM core.category_choice choice
   WHERE choice.logical_transaction_id = cv.logical_transaction_id
   ORDER BY choice.is_explicit DESC
   LIMIT 1
) choice ON true
LEFT JOIN LATERAL (
  SELECT cr.category_code, cr.subcategory_code
    FROM intel.financial_event_resolution er
    JOIN intel.category_resolution cr
      ON cr.financial_event_resolution_id = er.financial_event_resolution_id
     AND cr.is_current
   WHERE er.logical_transaction_id = cv.logical_transaction_id
     AND er.canonical_transaction_version_id = cv.canonical_transaction_version_id
     AND er.is_current
   LIMIT 1
) resolved ON true
`;

const interpretationJoins = `
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
`;

const listColumns = `
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
  cv.chosen_category AS category_code,
  cv.chosen_subcategory AS subcategory_code,
  cat.display_name AS category_name,
  sub.display_name AS subcategory_name,
  fa.account_display_name,
  cv.source_reference,
  c.taxonomy_version,
  p.purpose_status,
  p.purpose_code,
  party.resolution_status AS party_status,
  party.f10c_version
`;

const listSql = `
SELECT ${listColumns}
FROM (
  SELECT cv.logical_transaction_id, cv.canonical_transaction_version_id, cv.financial_account_id,
         cv.amount, cv.currency_code, cv.direction, cv.transaction_date, cv.raw_description,
         cv.duplicate_outcome, cv.change_provenance, cv.source_reference,
         COALESCE(choice.category_code, resolved.category_code) AS chosen_category,
         COALESCE(choice.subcategory_code, resolved.subcategory_code) AS chosen_subcategory
    FROM core.canonical_transaction_version cv
    JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
    ${categoryLaterals}
   WHERE ${pageFilters}
   ORDER BY cv.transaction_date DESC, cv.logical_transaction_id DESC
   LIMIT $7
) cv
${interpretationJoins}
LEFT JOIN core.financial_account fa ON fa.financial_account_id = cv.financial_account_id
LEFT JOIN ref.taxonomy_category cat
  ON cat.taxonomy_version = 'F10E-v1.2' AND cat.category_code = cv.chosen_category
LEFT JOIN ref.taxonomy_subcategory sub
  ON sub.taxonomy_version = 'F10E-v1.2' AND sub.subcategory_code = cv.chosen_subcategory
ORDER BY cv.transaction_date DESC, cv.logical_transaction_id DESC
`;

const listFamilySql = `
SELECT ${listColumns}
FROM (
  SELECT cv.logical_transaction_id, cv.canonical_transaction_version_id, cv.financial_account_id,
         cv.amount, cv.currency_code, cv.direction, cv.transaction_date, cv.raw_description,
         cv.duplicate_outcome, cv.change_provenance, cv.source_reference,
         COALESCE(choice.category_code, resolved.category_code) AS chosen_category,
         COALESCE(choice.subcategory_code, resolved.subcategory_code) AS chosen_subcategory
    FROM core.canonical_transaction_version cv
    JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
    JOIN intel.financial_event_resolution e
      ON e.logical_transaction_id = cv.logical_transaction_id
     AND e.canonical_transaction_version_id = cv.canonical_transaction_version_id
     AND e.is_current
    ${categoryLaterals}
   WHERE ${pageFilters}
     AND e.resolution_outcome = 'RESOLVED'
     AND e.event_family = $10
   ORDER BY cv.transaction_date DESC, cv.logical_transaction_id DESC
   LIMIT $7
) cv
${interpretationJoins}
LEFT JOIN core.financial_account fa ON fa.financial_account_id = cv.financial_account_id
LEFT JOIN ref.taxonomy_category cat
  ON cat.taxonomy_version = 'F10E-v1.2' AND cat.category_code = cv.chosen_category
LEFT JOIN ref.taxonomy_subcategory sub
  ON sub.taxonomy_version = 'F10E-v1.2' AND sub.subcategory_code = cv.chosen_subcategory
ORDER BY cv.transaction_date DESC, cv.logical_transaction_id DESC
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
    categoryCode: row.category_code,
    categoryName: row.category_name,
    subcategoryCode: row.subcategory_code,
    subcategoryName: row.subcategory_name,
    accountName: row.account_display_name,
    reference: row.source_reference,
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
  const pool = openPool(databaseUrl);

  async function withOwner<T>(ownerId: string, read: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.owner_id', $1, true)", [ownerId]);
      await client.query("SELECT set_config('jit', 'off', true)");
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
        const params = [
          input.accountId,
          input.direction,
          input.from,
          input.to,
          cursor?.date ?? null,
          cursor?.id ?? null,
          input.limit + 1,
          input.category,
          input.subcategory,
        ];
        const rows = await client.query<Row>(
          input.eventFamily ? listFamilySql : listSql,
          input.eventFamily ? [...params, input.eventFamily] : params,
        );
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

    async transactionFilters(ownerId) {
      return withOwner(ownerId, async (client) => {
        const rows = await client.query<{
          category_code: string | null;
          subcategory_code: string | null;
          category_name: string | null;
          subcategory_name: string | null;
        }>(
          `SELECT DISTINCT
                  COALESCE(choice.category_code, resolved.category_code) AS category_code,
                  COALESCE(choice.subcategory_code, resolved.subcategory_code) AS subcategory_code,
                  cat.display_name AS category_name,
                  sub.display_name AS subcategory_name
             FROM core.canonical_transaction_version cv
             JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
             ${categoryLaterals}
             LEFT JOIN ref.taxonomy_category cat
               ON cat.taxonomy_version = 'F10E-v1.2'
              AND cat.category_code = COALESCE(choice.category_code, resolved.category_code)
             LEFT JOIN ref.taxonomy_subcategory sub
               ON sub.taxonomy_version = 'F10E-v1.2'
              AND sub.subcategory_code = COALESCE(choice.subcategory_code, resolved.subcategory_code)
            WHERE cv.is_current
              AND lt.identity_status = 'ACTIVE'
              AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'`,
        );
        const grouped = new Map<string, { name: string; subcategories: Map<string, string> }>();
        let uncategorized = false;
        for (const row of rows.rows) {
          if (!row.category_code) {
            uncategorized = true;
            continue;
          }
          const current = grouped.get(row.category_code) ?? {
            name: row.category_name ?? row.category_code,
            subcategories: new Map<string, string>(),
          };
          if (row.subcategory_code) {
            current.subcategories.set(row.subcategory_code, row.subcategory_name ?? row.subcategory_code);
          }
          grouped.set(row.category_code, current);
        }
        const categories = [...grouped.entries()]
          .sort((left, right) => left[1].name.localeCompare(right[1].name))
          .map(([code, value]) => ({
            code,
            name: value.name,
            subcategories: [
              { code: "none", name: "Not recorded" },
              ...[...value.subcategories.entries()]
                .sort((left, right) => left[1].localeCompare(right[1]))
                .map(([subCode, name]) => ({ code: subCode, name })),
            ],
          }));
        if (uncategorized) {
          categories.push({ code: "none", name: "Not recorded", subcategories: [] });
        }
        return { categories };
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
          events: Array<{ family: string | null; outcome: string; count: number; inflow: string; outflow: string }> | null;
          uses: Array<{ status: string; code: string | null; count: number }> | null;
        }>(
          `WITH current_rows AS MATERIALIZED (
             SELECT cv.currency_code, cv.amount, cv.direction,
                    e.event_family, e.resolution_outcome, e.financial_event_resolution_id,
                    c.category_status,
                    COALESCE(
                      (SELECT choice.category_code
                         FROM core.category_choice choice
                        WHERE choice.logical_transaction_id = cv.logical_transaction_id
                        ORDER BY choice.is_explicit DESC
                        LIMIT 1),
                      c.category_code
                    ) AS category_code,
                    c.category_resolution_id
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
           )
           SELECT currency_code,
                  COALESCE(sum(amount) FILTER (WHERE direction = 'IN'), 0)::text AS inflow,
                  COALESCE(sum(amount) FILTER (WHERE direction = 'OUT'), 0)::text AS outflow,
                  COALESCE(sum(amount) FILTER (
                    WHERE direction = 'OUT'
                      AND resolution_outcome = 'RESOLVED'
                      AND event_family <> ALL ($3::text[])
                  ), 0)::text AS ordinary_outflow,
                  count(*)::int AS count,
                  count(*) FILTER (WHERE financial_event_resolution_id IS NULL)::int AS without_event,
                  count(*) FILTER (WHERE category_resolution_id IS NULL)::int AS without_use,
                  (
                    SELECT jsonb_agg(jsonb_build_object(
                      'family', event_family,
                      'outcome', outcome,
                      'count', count,
                      'inflow', inflow,
                      'outflow', outflow
                    ) ORDER BY event_family)
                    FROM (
                      SELECT event_family,
                             COALESCE(resolution_outcome, 'UNAVAILABLE') AS outcome,
                             count(*)::int AS count,
                             COALESCE(sum(amount) FILTER (WHERE direction = 'IN'), 0)::text AS inflow,
                             COALESCE(sum(amount) FILTER (WHERE direction = 'OUT'), 0)::text AS outflow
                        FROM current_rows grouped
                       WHERE grouped.currency_code = current_rows.currency_code
                       GROUP BY event_family, resolution_outcome
                    ) event_rows
                  ) AS events,
                  (
                    SELECT jsonb_agg(jsonb_build_object(
                      'status', status,
                      'code', code,
                      'count', count
                    ) ORDER BY status, code)
                    FROM (
                      SELECT COALESCE(category_status, 'UNAVAILABLE') AS status,
                             category_code AS code,
                             count(*)::int AS count
                        FROM current_rows grouped
                       WHERE grouped.currency_code = current_rows.currency_code
                       GROUP BY category_status, category_code
                    ) use_rows
                  ) AS uses
             FROM current_rows
            GROUP BY currency_code
            ORDER BY currency_code`,
          [input.from, input.to, excludedOrdinaryFamilies, input.currency],
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
            events: total.events ?? [],
            uses: total.uses ?? [],
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
