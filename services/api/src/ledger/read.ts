import pg from "pg";
import { openPool } from "../db/pool.js";
import { createFxReader, type FxReader } from "../money/fx.js";
import { reviewThreshold } from "../money/detect.js";
import { convertRows, moneyText, type ConvertedMonthlyRow, type ConvertedTotals, type FxGap } from "./display.js";

export type LedgerRead = {
  listTransactions(input: ListInput): Promise<TransactionPage>;
  transactionFilters(ownerId: string): Promise<TransactionFilters>;
  accountSummaries(ownerId: string): Promise<AccountSummary[]>;
  overview(input: OverviewInput): Promise<Overview>;
  insights(input: InsightsInput): Promise<Insights>;
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
  weights: FilterChoice[];
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
  weightName: string | null;
  weightCode: string | null;
  reference: string | null;
  /**
   * The other two layers of money the plan names.
   *
   * `amount`/`currency` above are *as booked*. `stated` is *as stated*: what the
   * alert wrote before the issuer converted it, carried on the canonical row's
   * `original_*` pair. It is `null` when the alert named one currency only, which
   * means "same as booked", not "unknown".
   */
  stated: { amount: string | null; currency: string | null } | null;
  /**
   * How sure the parser was that `currency` is right, and why. `basis` is the
   * evidence class (`EXPLICIT_ISO`, `TLD_OR_COUNTRY`, `OWNER_DEFAULT`, ...).
   * A low confidence is what raises the "Currency uncertain — review" row rather
   * than letting a guessed code pass as booked truth.
   */
  currencyBasis: string | null;
  currencyConfidence: number | null;
  currencyUncertain: boolean;
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
  /**
   * Convert each row into this currency at its own date. Booked figures stay in
   * the response; the converted roll-up is additive.
   */
  displayCurrency?: string | null;
};

export type Overview = {
  from: string | null;
  to: string | null;
  /** The currency every `converted` block is expressed in, when one was asked for. */
  displayCurrency: string | null;
  /** Present only when `displayCurrency` was requested. */
  displayTotals?: {
    currency: string;
    inflow: string;
    outflow: string;
    ordinaryOutflow: string;
    complete: boolean;
    missingRows: number;
    gaps: FxGap[];
  };
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
    /** Converted at each row's own date. Additive; the booked figures above are unchanged. */
    converted?: {
      currency: string;
      inflow: string;
      outflow: string;
      ordinaryOutflow: string;
      complete: boolean;
      missingRows: number;
      gaps: FxGap[];
    };
  }>;
};

export type InsightsInput = {
  ownerId: string;
  from: string | null;
  to: string | null;
  currency: string | null;
  /** Convert the summary into this currency. Booked totals are unchanged. */
  displayCurrency?: string | null;
};

export type Insights = {
  uncategorised: number;
  currency: string | null;
  /** The currency the `converted` block is expressed in, when one was asked for. */
  displayCurrency?: string | null;
  totals: {
    credit: string;
    debit: string;
    categorisedOutflow: string;
    uncategorisedOutflow: string;
  };
  /**
   * The same four figures in `displayCurrency`. Present only when one was
   * requested. `complete: false` means some rows had no rate and are excluded.
   */
  converted?: ConvertedTotals;
  monthlySummary: Array<{
    month: string;
    credit: string;
    debit: string;
    openingBalance: string;
    closingBalance: string;
    /**
     * Converted figures for the month. Booked strings above are untouched, so
     * nothing in this object ever mixes two currencies.
     */
    converted?: ConvertedMonthlyRow;
  }>;
  spendingAnalysis: {
    categories: Record<string, {
      name: string;
      totalAmount: string;
      subcategories: Record<string, string>;
      subcategoryNames: Record<string, string>;
      /** Converted total for this slice, when a display currency was requested. */
      convertedAmount?: string;
      fxMissing?: boolean;
    }>;
  };
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
  weight_name: string | null;
  weight_code: string | null;
  source_reference: string | null;
  taxonomy_version: string | null;
  original_amount: string | null;
  original_currency_code: string | null;
  currency_basis: string | null;
  currency_confidence: string | null;
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
  wm.name AS weight_name,
  mw.primary_weight_code::text AS weight_code,
  cv.source_reference,
  cv.original_amount,
  cv.original_currency_code,
  spot.currency_basis,
  spot.currency_confidence::text AS currency_confidence,
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
         cv.original_amount, cv.original_currency_code,
         -- Guarded: a non-uuid metadata value would raise rather than return NULL.
         CASE WHEN lt.identity_metadata->>'gmail_spot_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'
              THEN (lt.identity_metadata->>'gmail_spot_id')::uuid END AS gmail_spot_id,
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
LEFT JOIN core.movement_weight mw ON mw.logical_transaction_id = cv.logical_transaction_id
LEFT JOIN human_context.weight_master wm ON wm.code = mw.primary_weight_code
-- The spot is the only place the detector's evidence is recorded, and its RLS
-- policy is owner-scoped, so a row that is not this owner's simply does not join.
LEFT JOIN core.gmail_spot_transaction spot ON spot.gmail_spot_transaction_id = cv.gmail_spot_id
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
LEFT JOIN core.movement_weight mw ON mw.logical_transaction_id = cv.logical_transaction_id
LEFT JOIN human_context.weight_master wm ON wm.code = mw.primary_weight_code
LEFT JOIN core.gmail_spot_transaction spot ON spot.gmail_spot_transaction_id = cv.gmail_spot_id
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

/**
 * The *as stated* pair, or null when the alert named one currency.
 *
 * `core.canonical_transaction_version.original_*` is only populated when the card
 * alert actually stated a foreign amount. A NULL therefore means "same as booked",
 * and the client shows one number rather than a second "unknown" figure.
 */
function statedMoney(row: Row): { amount: string | null; currency: string | null } | null {
  const amount = row.original_amount;
  const currency = row.original_currency_code?.trim() ?? null;
  if (amount === null && currency === null) return null;
  // A stated pair that equals the booked pair is not a second layer of money.
  if (currency !== null && currency === (row.currency_code?.trim() ?? null)) return null;
  return { amount, currency };
}

/**
 * Whether the ledger should ask before trusting the booked currency.
 *
 * Three ways to be uncertain, and they are not the same:
 *   - the row has no currency at all, which is a defect rather than a guess;
 *   - the parser recorded no confidence (a spot promoted before the detector
 *     existed), so the code is booked but unverified;
 *   - the parser recorded a confidence below the review threshold.
 *
 * Only the last two are "review"; a missing currency is surfaced the same way
 * because a row the owner cannot read is worse than a row that asks.
 */
function isCurrencyUncertain(row: Row): boolean {
  const code = row.currency_code?.trim() ?? "";
  if (code.length === 0) return true;
  if (row.currency_confidence === null) return true;
  const confidence = Number(row.currency_confidence);
  return !Number.isFinite(confidence) || confidence < reviewThreshold;
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
    weightName: row.weight_name,
    weightCode: row.weight_code,
    reference: row.source_reference,
    stated: statedMoney(row),
    currencyBasis: row.currency_basis,
    currencyConfidence: row.currency_confidence === null ? null : Number(row.currency_confidence),
    currencyUncertain: isCurrencyUncertain(row),
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

export function createLedgerRead(databaseUrl: string, options: { fx?: FxReader } = {}): LedgerRead {
  const pool = openPool(databaseUrl);
  // Display conversion is read-only and cached; one reader per process is enough.
  const fx = options.fx ?? createFxReader(databaseUrl);

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
        const weights = await client.query<{ code: string; name: string }>(
          `SELECT code::text AS code, name
             FROM human_context.weight_master
            WHERE is_active
            ORDER BY display_order`,
        );
        return {
          categories,
          weights: weights.rows.map((row) => ({ code: row.code, name: row.name })),
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

        const display = (input.displayCurrency ?? "").trim().toUpperCase();
        const convertedByCurrency = new Map<string, {
          currency: string;
          inflow: string;
          outflow: string;
          ordinaryOutflow: string;
          complete: boolean;
          missingRows: number;
          gaps: FxGap[];
        }>();
        let displayTotals: Overview["displayTotals"];

        if (/^[A-Z]{3}$/.test(display)) {
          // Convert row by row, because each transaction has its own date. The booked
          // aggregates above cannot be converted at one spot rate without inventing a
          // number that reconciles with nothing.
          const rows = await client.query<{
            currency_code: string;
            amount: string;
            direction: string;
            transaction_date: Date | string | null;
            ordinary: boolean;
          }>(
            `SELECT cv.currency_code, cv.amount::text AS amount, cv.direction,
                    cv.transaction_date,
                    (e.resolution_outcome = 'RESOLVED' AND e.event_family <> ALL ($3::text[])) AS ordinary
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
                AND ($4::text IS NULL OR cv.currency_code = $4)`,
            [input.from, input.to, excludedOrdinaryFamilies, input.currency],
          );

          type Bucket = { inflow: number; outflow: number; ordinary: number; gaps: FxGap[]; missing: number };
          const buckets = new Map<string, Bucket>();
          const totals: Bucket & { currency: string } = {
            currency: display,
            inflow: 0,
            outflow: 0,
            ordinary: 0,
            gaps: [],
            missing: 0,
          };

          for (const row of rows.rows) {
            const code = row.currency_code.trim();
            const date = row.transaction_date
              ? (row.transaction_date instanceof Date
                ? row.transaction_date.toISOString().slice(0, 10)
                : String(row.transaction_date).slice(0, 10))
              : null;
            const amount = Number(row.amount);
            if (!Number.isFinite(amount)) continue;

            const bucket = buckets.get(code) ?? { inflow: 0, outflow: 0, ordinary: 0, gaps: [], missing: 0 };
            const result = await convertRows(fx, [{
              amount,
              currency: code,
              date,
            }], display);
            const value = result.complete ? result.total : 0;
            if (!result.complete) {
              bucket.missing += result.missingRows;
              totals.missing += result.missingRows;
              for (const gap of result.gaps) {
                if (!bucket.gaps.some((g) => g.from === gap.from && g.date === gap.date) && bucket.gaps.length < 10) {
                  bucket.gaps.push(gap);
                }
                if (!totals.gaps.some((g) => g.from === gap.from && g.date === gap.date) && totals.gaps.length < 10) {
                  totals.gaps.push(gap);
                }
              }
            }

            if (row.direction === "IN") {
              bucket.inflow += value;
              totals.inflow += value;
            } else if (row.direction === "OUT") {
              bucket.outflow += value;
              totals.outflow += value;
              if (row.ordinary) {
                bucket.ordinary += value;
                totals.ordinary += value;
              }
            }
            buckets.set(code, bucket);
          }

          for (const [code, bucket] of buckets) {
            convertedByCurrency.set(code, {
              currency: display,
              inflow: moneyText(bucket.inflow),
              outflow: moneyText(bucket.outflow),
              ordinaryOutflow: moneyText(bucket.ordinary),
              complete: bucket.missing === 0,
              missingRows: bucket.missing,
              gaps: bucket.gaps,
            });
          }

          displayTotals = {
            currency: display,
            inflow: moneyText(totals.inflow),
            outflow: moneyText(totals.outflow),
            ordinaryOutflow: moneyText(totals.ordinary),
            complete: totals.missing === 0,
            missingRows: totals.missing,
            gaps: totals.gaps,
          };
        }

        return {
          from: input.from,
          to: input.to,
          displayCurrency: convertedByCurrency.size > 0 || displayTotals ? display : null,
          ...(displayTotals ? { displayTotals } : {}),
          currencies: totals.rows.map((total) => {
            const code = total.currency_code.trim();
            return {
              currency: code,
              inflow: total.inflow,
              outflow: total.outflow,
              ordinaryOutflow: total.ordinary_outflow,
              transactionCount: total.count,
              events: total.events ?? [],
              uses: total.uses ?? [],
              transactionsWithoutEvent: total.without_event,
              transactionsWithoutUse: total.without_use,
              ...(convertedByCurrency.has(code) ? { converted: convertedByCurrency.get(code) } : {}),
            };
          }),
        };
      });
    },

    async insights(input) {
      return withOwner(input.ownerId, async (client) => {
        // Amounts are never mixed across currencies. When a caller omits the currency we
        // resolve the dominant recorded currency so the summary and the pie chart always agree.
        let currency = input.currency;
        if (!currency) {
          const dominant = await client.query<{ currency_code: string | null }>(
            `SELECT cv.currency_code
               FROM core.canonical_transaction_version cv
               JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
              WHERE cv.is_current
                AND lt.identity_status = 'ACTIVE'
                AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
                AND cv.amount IS NOT NULL
                AND cv.currency_code IS NOT NULL
                AND ($1::date IS NULL OR cv.transaction_date >= $1)
                AND ($2::date IS NULL OR cv.transaction_date <= $2)
              GROUP BY cv.currency_code
              ORDER BY count(*) DESC, cv.currency_code
              LIMIT 1`,
            [input.from, input.to],
          );
          currency = dominant.rows[0]?.currency_code?.trim() ?? null;
        }

        // 1. Uncategorised count
        const uncategorisedRows = await client.query<{ count: string }>(
          `SELECT count(*)::text
             FROM core.canonical_transaction_version cv
             JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
             ${categoryLaterals}
             WHERE cv.is_current
               AND lt.identity_status = 'ACTIVE'
               AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
               AND COALESCE(choice.category_code, resolved.category_code) IS NULL
               AND ($1::date IS NULL OR cv.transaction_date >= $1)
               AND ($2::date IS NULL OR cv.transaction_date <= $2)
               AND ($3::text IS NULL OR cv.currency_code = $3)`,
          [input.from, input.to, currency],
        );
        const uncategorised = parseInt(uncategorisedRows.rows[0]?.count ?? "0", 10);

        // 2. Monthly Summary
        const monthlyRows = await client.query<{
          month: string;
          credit: string;
          debit: string;
          balance: string | null;
        }>(
          `WITH monthly_totals AS (
             SELECT
               date_trunc('month', cv.transaction_date)::date AS month,
               COALESCE(sum(cv.amount) FILTER (WHERE cv.direction = 'IN'), 0)::text AS credit,
               COALESCE(sum(cv.amount) FILTER (WHERE cv.direction = 'OUT'), 0)::text AS debit
             FROM core.canonical_transaction_version cv
             JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
             WHERE cv.is_current
               AND lt.identity_status = 'ACTIVE'
               AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
               AND cv.amount IS NOT NULL
               AND ($1::date IS NULL OR cv.transaction_date >= $1)
               AND ($2::date IS NULL OR cv.transaction_date <= $2)
               AND ($3::text IS NULL OR cv.currency_code = $3)
             GROUP BY 1
           ),
           balances AS (
             SELECT month, sum(balance)::text AS balance
             FROM (
               SELECT DISTINCT ON (financial_account_id, date_trunc('month', observed_at))
                 date_trunc('month', observed_at)::date AS month,
                 balance_amount AS balance
               FROM core.balance_snapshot
               WHERE balance_type = 'AVAILABLE'
                 AND ($3::text IS NULL OR currency_code = $3)
               ORDER BY financial_account_id, date_trunc('month', observed_at), observed_at DESC
             ) per_account
             GROUP BY month
           )
           SELECT
             to_char(mt.month, 'YYYY-MM') AS month,
             mt.credit,
             mt.debit,
             b.balance
           FROM monthly_totals mt
           LEFT JOIN balances b ON b.month = mt.month
           ORDER BY mt.month DESC`,
          [input.from, input.to, currency],
        );

        const monthlySummary: Insights["monthlySummary"] = [];
        let previousClosing: number | null = null;
        for (const row of [...monthlyRows.rows].reverse()) {
          const credit = Number(row.credit);
          const debit = Number(row.debit);
          // Prefer an observed snapshot for the closing balance; otherwise roll forward from the
          // previous month. Opening is the prior closing when known, else derived from the closing.
          const closing: number = row.balance !== null ? Number(row.balance) : (previousClosing ?? 0) + credit - debit;
          const opening: number = previousClosing !== null ? previousClosing : closing - credit + debit;
          monthlySummary.push({
            month: row.month,
            credit: credit.toFixed(2),
            debit: debit.toFixed(2),
            openingBalance: opening.toFixed(2),
            closingBalance: closing.toFixed(2),
          });
          previousClosing = closing;
        }
        monthlySummary.reverse();

        // 3. Spending Analysis (outflow only, bucket for uncategorised spend)
        const spendingRows = await client.query<{
          category_code: string | null;
          category_name: string | null;
          subcategory_code: string | null;
          subcategory_name: string | null;
          amount: string;
        }>(
          `SELECT
               COALESCE(choice.category_code, resolved.category_code) AS category_code,
               cat.display_name AS category_name,
               COALESCE(choice.subcategory_code, resolved.subcategory_code) AS subcategory_code,
               sub.display_name AS subcategory_name,
               sum(cv.amount)::text AS amount
             FROM core.canonical_transaction_version cv
             JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
             ${categoryLaterals}
             LEFT JOIN ref.taxonomy_category cat
               ON cat.taxonomy_version = 'F10E-v1.2' AND cat.category_code = COALESCE(choice.category_code, resolved.category_code)
             LEFT JOIN ref.taxonomy_subcategory sub
               ON sub.taxonomy_version = 'F10E-v1.2' AND sub.subcategory_code = COALESCE(choice.subcategory_code, resolved.subcategory_code)
             WHERE cv.is_current
               AND lt.identity_status = 'ACTIVE'
               AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
               AND cv.amount IS NOT NULL
               AND cv.direction = 'OUT'
               AND ($1::date IS NULL OR cv.transaction_date >= $1)
               AND ($2::date IS NULL OR cv.transaction_date <= $2)
               AND ($3::text IS NULL OR cv.currency_code = $3)
             GROUP BY 1, 2, 3, 4
             ORDER BY 5 DESC`,
          [input.from, input.to, currency],
        );

        const spendingCategories: Insights["spendingAnalysis"]["categories"] = {};
        for (const row of spendingRows.rows) {
          const code = row.category_code ?? "none";
          const name = row.category_code ? row.category_name ?? row.category_code : "Not recorded";
          const current = spendingCategories[code] ?? {
            name,
            totalAmount: "0.00",
            subcategories: {},
            subcategoryNames: {},
          };
          current.totalAmount = (Number(current.totalAmount) + Number(row.amount)).toFixed(2);
          if (row.subcategory_code) {
            current.subcategories[row.subcategory_code] = (
              Number(current.subcategories[row.subcategory_code] ?? "0") + Number(row.amount)
            ).toFixed(2);
            current.subcategoryNames[row.subcategory_code] =
              row.subcategory_name ?? row.subcategory_code;
          }
          spendingCategories[code] = current;
        }

        const totalsRows = await client.query<{ credit: string; debit: string }>(
          `SELECT
             COALESCE(sum(cv.amount) FILTER (WHERE cv.direction = 'IN'), 0)::text AS credit,
             COALESCE(sum(cv.amount) FILTER (WHERE cv.direction = 'OUT'), 0)::text AS debit
           FROM core.canonical_transaction_version cv
           JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
          WHERE cv.is_current
            AND lt.identity_status = 'ACTIVE'
            AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
            AND cv.amount IS NOT NULL
            AND ($1::date IS NULL OR cv.transaction_date >= $1)
            AND ($2::date IS NULL OR cv.transaction_date <= $2)
            AND ($3::text IS NULL OR cv.currency_code = $3)`,
          [input.from, input.to, currency],
        );
        const debitTotal = Number(totalsRows.rows[0]?.debit ?? 0);
        const uncategorisedOutflow = Number(spendingCategories.none?.totalAmount ?? 0);
        const categorisedOutflow = Number((debitTotal - uncategorisedOutflow).toFixed(2));

        const bookedTotals = {
          credit: Number(totalsRows.rows[0]?.credit ?? 0).toFixed(2),
          debit: debitTotal.toFixed(2),
          categorisedOutflow: categorisedOutflow.toFixed(2),
          uncategorisedOutflow: uncategorisedOutflow.toFixed(2),
        };

        /**
         * Converted view.
         *
         * Booked totals above are untouched: a client that ignores `converted` sees
         * exactly what it saw before. Each row converts at its own date, and a
         * missing rate marks the month or slice rather than borrowing a neighbour's
         * rate or substituting 1.0.
         */
        const display = (input.displayCurrency ?? "").trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(display)) {
          return {
            uncategorised,
            currency,
            totals: bookedTotals,
            monthlySummary,
            spendingAnalysis: { categories: spendingCategories },
          };
        }

        const conversionCurrency = (currency ?? display).trim().toUpperCase();
        const rows = await client.query<{
          transaction_date: Date | string | null;
          amount: string;
          currency_code: string | null;
          direction: string;
          category_code: string | null;
          subcategory_code: string | null;
        }>(
          `SELECT cv.transaction_date,
                  cv.amount::text AS amount,
                  cv.currency_code,
                  cv.direction,
                  COALESCE(choice.category_code, resolved.category_code) AS category_code,
                  COALESCE(choice.subcategory_code, resolved.subcategory_code) AS subcategory_code
             FROM core.canonical_transaction_version cv
             JOIN core.logical_transaction lt ON lt.logical_transaction_id = cv.logical_transaction_id
             ${categoryLaterals}
            WHERE cv.is_current
              AND lt.identity_status = 'ACTIVE'
              AND cv.duplicate_outcome <> 'EQUIVALENT_SUPERSEDED'
              AND cv.amount IS NOT NULL
              AND ($1::date IS NULL OR cv.transaction_date >= $1)
              AND ($2::date IS NULL OR cv.transaction_date <= $2)
              AND ($3::text IS NULL OR cv.currency_code = $3)`,
          [input.from, input.to, currency],
        );

        type Slice = { credit: number; debit: number; missing: number; gaps: FxGap[] };
        const monthSlices = new Map<string, Slice>();
        const categorySlices = new Map<string, Slice>();
        const converted = {
          currency: display,
          credit: 0,
          debit: 0,
          categorised: 0,
          uncategorised: 0,
          missing: 0,
          gaps: [] as FxGap[],
        };

        const recordGap = (slice: Slice, gap: FxGap): void => {
          if (!slice.gaps.some((existing) => existing.from === gap.from && existing.date === gap.date) && slice.gaps.length < 10) {
            slice.gaps.push(gap);
          }
          if (!converted.gaps.some((existing) => existing.from === gap.from && existing.date === gap.date) && converted.gaps.length < 10) {
            converted.gaps.push(gap);
          }
        };

        for (const row of rows.rows) {
          const amount = Number(row.amount);
          if (!Number.isFinite(amount)) continue;
          const date = row.transaction_date
            ? (row.transaction_date instanceof Date
              ? row.transaction_date.toISOString().slice(0, 10)
              : String(row.transaction_date).slice(0, 10))
            : null;
          const result = await convertRows(fx, [{
            amount,
            currency: row.currency_code?.trim() || conversionCurrency,
            date,
          }], display);
          const value = result.complete ? result.total : 0;

          const month = date ? date.slice(0, 7) : "unknown";
          const monthSlice = monthSlices.get(month) ?? { credit: 0, debit: 0, missing: 0, gaps: [] };
          const categoryKey = row.direction === "OUT" ? (row.category_code ?? "none") : "";
          const categorySlice = categoryKey ? (categorySlices.get(categoryKey) ?? { credit: 0, debit: 0, missing: 0, gaps: [] }) : null;

          if (!result.complete) {
            monthSlice.missing += result.missingRows;
            converted.missing += result.missingRows;
            if (categorySlice) categorySlice.missing += result.missingRows;
            for (const gap of result.gaps) {
              recordGap(monthSlice, gap);
              if (categorySlice) recordGap(categorySlice, gap);
            }
          } else {
            if (row.direction === "IN") {
              converted.credit += value;
              monthSlice.credit += value;
            }
            if (row.direction === "OUT") {
              converted.debit += value;
              monthSlice.debit += value;
              if (categoryKey === "none") {
                converted.uncategorised += value;
              } else {
                converted.categorised += value;
              }
              if (categorySlice) categorySlice.debit += value;
            }
          }

          monthSlices.set(month, monthSlice);
          if (categorySlice && categoryKey) categorySlices.set(categoryKey, categorySlice);
        }

        // The converted roll-up must reconcile the same way the booked one does:
        // categorised + uncategorised = debit.
        const convertedUncategorised = Number(converted.uncategorised.toFixed(2));
        const convertedDebit = Number(converted.debit.toFixed(2));

        const convertedMonths: Insights["monthlySummary"] = monthlySummary.map((month) => {
          const slice = monthSlices.get(month.month);
          if (!slice) return month;
          return {
            ...month,
            converted: {
              currency: display,
              credit: moneyText(slice.credit),
              debit: moneyText(slice.debit),
              complete: slice.missing === 0,
              missingRows: slice.missing,
            },
          };
        });

        return {
          uncategorised,
          currency,
          displayCurrency: display,
          totals: bookedTotals,
          converted: {
            currency: display,
            credit: moneyText(converted.credit),
            debit: moneyText(convertedDebit),
            categorisedOutflow: moneyText(Number(converted.categorised.toFixed(2))),
            uncategorisedOutflow: moneyText(convertedUncategorised),
            complete: converted.missing === 0,
            missingRows: converted.missing,
            gaps: converted.gaps,
          },
          monthlySummary: convertedMonths,
          spendingAnalysis: {
            categories: Object.fromEntries(
              Object.entries(spendingCategories).map(([code, slice]) => {
                const convertedSlice = categorySlices.get(code);
                if (!convertedSlice) return [code, slice];
                return [code, {
                  ...slice,
                  convertedAmount: moneyText(convertedSlice.debit),
                  fxMissing: convertedSlice.missing > 0,
                }];
              }),
            ),
          },
        };
      });
    },

    async close() {
      await pool.end();
    },
  };
}
