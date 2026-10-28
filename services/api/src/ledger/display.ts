import type { FxReader } from "../money/fx.js";

/**
 * Display-currency conversion for read models.
 *
 * Three rules, and they are the whole design:
 *
 * 1. Booked totals are never replaced. A converted roll-up is additional data
 *    with its own field, so a client that ignores it keeps seeing exactly what
 *    it saw before.
 * 2. Each row converts at its *own* transaction date. Converting a quarter at one
 *    spot rate produces a number that does not reconcile with any statement.
 * 3. A missing rate is reported. The row keeps its booked amount, gains
 *    `fxMissing`, and contributes nothing to the converted total — which is
 *    reported as partial rather than silently understated.
 */

export type FxGap = {
  from: string;
  to: string;
  date: string;
  reason: "missing_rate";
};

export type ConvertedTotals = {
  /** The currency the converted figures are in. */
  currency: string;
  /** Converted figures, in `currency`. Only meaningful when `complete` is true. */
  credit: string;
  debit: string;
  categorisedOutflow: string;
  uncategorisedOutflow: string;
  /** False when at least one row had no rate; the figures then exclude those rows. */
  complete: boolean;
  /** Rows that could not be converted, so the client can say how many. */
  missingRows: number;
  /** At most a handful, for the review row. */
  gaps: FxGap[];
};

export type ConvertedMonthlyRow = {
  /** The currency the converted figures are in. */
  currency: string;
  credit: string;
  debit: string;
  /** False when a row in the month had no rate; the figures then exclude it. */
  complete: boolean;
  missingRows: number;
};

export type CurrencyReport = {
  /** The booked currency these rows are in. */
  currency: string;
  inflow: string;
  outflow: string;
  ordinaryOutflow: string;
  transactionCount: number;
  /** Converted into the display currency, at each row's own date. */
  converted?: {
    currency: string;
    inflow: string;
    outflow: string;
    ordinaryOutflow: string;
    complete: boolean;
    missingRows: number;
    gaps: FxGap[];
  };
};

const gapLimit = 10;

/** Deduplicate gaps and bound the list: a client needs examples, not a ledger dump. */
function collectGap(gaps: FxGap[], gap: FxGap): boolean {
  const seen = gaps.some((existing) => existing.from === gap.from && existing.date === gap.date);
  if (!seen && gaps.length < gapLimit) {
    gaps.push(gap);
  }
  return false;
}

export type MoneyRow = {
  amount: number;
  currency: string;
  /** `YYYY-MM-DD`. A row with no date cannot be converted and is reported as a gap. */
  date: string | null;
};

/**
 * Convert a list of booked rows into `display`.
 *
 * Returns the converted sum plus the completeness signal. Precision follows the
 * caller's `toFixed`: this is display money, and the booked figures stay exact.
 */
export async function convertRows(
  fx: FxReader,
  rows: MoneyRow[],
  display: string,
  decimals = 2,
): Promise<{
  total: number;
  complete: boolean;
  missingRows: number;
  gaps: FxGap[];
  /** Per-row results in input order, for callers that build a series. */
  converted: Array<{ amount: number; rateDate: string | null; fxMissing: boolean }>;
}> {
  const gaps: FxGap[] = [];
  const converted: Array<{ amount: number; rateDate: string | null; fxMissing: boolean }> = [];
  let total = 0;
  let missingRows = 0;

  for (const row of rows) {
    if (!row.date) {
      missingRows += 1;
      collectGap(gaps, { from: row.currency, to: display, date: "unknown", reason: "missing_rate" });
      converted.push({ amount: 0, rateDate: null, fxMissing: true });
      continue;
    }
    if (row.currency === display) {
      total += row.amount;
      converted.push({ amount: row.amount, rateDate: row.date, fxMissing: false });
      continue;
    }
    const result = await fx.convert(row.amount, row.currency, display, row.date);
    if (!result.ok) {
      missingRows += 1;
      collectGap(gaps, { from: row.currency, to: display, date: row.date, reason: "missing_rate" });
      converted.push({ amount: 0, rateDate: null, fxMissing: true });
      continue;
    }
    total += Number(result.amount);
    converted.push({ amount: Number(result.amount), rateDate: result.rateDate, fxMissing: false });
  }

  return {
    total: Number(total.toFixed(decimals)),
    complete: missingRows === 0,
    missingRows,
    gaps,
    converted,
  };
}

/** Format a numeric total the way every other figure in the ledger is formatted. */
export function moneyText(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

/**
 * Card spend needs its fee split to reconcile.
 *
 * A forex markup and the GST on it are separate ledger rows. A pie chart built
 * only on `fee_role = 'BASE'` understates international card spend by the markup
 * and the tax on it, which is exactly the amount a user is looking for when they
 * ask what a foreign purchase really cost.
 */
export type LandedCost = {
  baseAmount: string;
  fcyMarkup: string;
  gstTax: string;
  totalLanded: string;
  currency: string;
};

export function landedCostText(base: number, markup: number, tax: number, currency: string): LandedCost {
  return {
    baseAmount: moneyText(base),
    fcyMarkup: moneyText(markup),
    gstTax: moneyText(tax),
    totalLanded: moneyText(base + markup + tax),
    currency,
  };
}
