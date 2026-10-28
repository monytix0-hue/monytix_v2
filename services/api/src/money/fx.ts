import pg from "pg";
import { openPool } from "../db/pool.js";

/**
 * Display-currency conversion.
 *
 * `finance.fx_rates` only holds EUR-based quotes, so every pair is a triangle
 * through EUR: Rate(A->B) = Rate(EUR->B) / Rate(EUR->A).
 *
 * Two rules shape the rest:
 *
 * - A missing rate is reported as missing. It is never `1.0` and never `0`
 *   substituting silently, because that would turn a display convenience into a
 *   wrong total.
 * - Rates are read as of the transaction's own date, using the latest row on or
 *   before it. Past rates are immutable, so the cache only needs a size cap.
 */

export type FxLookup = {
  rate: number;
  /** The date of the rate rows that produced it. */
  rateDate: string;
  /** `fx_rates`, `manual_fx_rates`, or a mix when the two legs differ. */
  source: "fx_rates" | "manual_fx_rates" | "mixed" | "identity";
};

export type FxResult =
  | { ok: true; rate: FxLookup }
  | { ok: false; reason: "missing_rate"; from: string; to: string; date: string };

export type FxReader = {
  /** Rate from `from` to `to` on `date` (inclusive, falling back to the latest prior row). */
  rate(from: string, to: string, date: string): Promise<FxResult>;
  /** Convert an amount, returning a two-decimal string or a flagged gap. */
  convert(amount: number, from: string, to: string, date: string): Promise<
    | { ok: true; amount: string; rate: number; rateDate: string; source: FxLookup["source"] }
    | { ok: false; reason: "missing_rate"; from: string; to: string; date: string }
  >;
  /** Drop the cache. Only needed when a manual rate is edited at runtime. */
  clear(): void;
};

const cacheLimit = 4096;

type Leg = { rate: number; rateDate: string; source: FxLookup["source"] };

/**
 * A bounded in-process cache. There is no Redis in `services/api` and no LRU
 * dependency; past rates never change, so a size cap is the whole policy.
 * Revisit if this ever runs multi-instance and the cap causes churn.
 */
class RateCache {
  private readonly entries = new Map<string, FxResult>();

  get(key: string): FxResult | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: FxResult): void {
    if (this.entries.size >= cacheLimit) {
      // Map preserves insertion order, so this evicts the oldest key.
      const oldest = this.entries.keys().next();
      if (!oldest.done) {
        this.entries.delete(oldest.value);
      }
    }
    this.entries.set(key, value);
  }

  clear(): void {
    this.entries.clear();
  }
}

function normalizeCode(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** The one query the reader makes. Exposed so tests can supply a fake source. */
export type RateSource = {
  latest(code: string, date: string): Promise<{ rate: string | number; rateDate: string | Date; source: string } | null>;
};

export function createFxReader(databaseUrl: string): FxReader {
  const cache = new RateCache();
  let pool: pg.Pool | null = null;

  function getPool(): pg.Pool {
    // `openPool` returns a cached pool and does not connect until the first query,
    // so constructing this reader on import costs nothing.
    if (!pool) {
      pool = openPool(databaseUrl, 2);
    }
    return pool;
  }

  return buildFxReader({
    latest: async (code, date) => {
      const result = await getPool().query<{ rate: string; rate_date: Date | string; source: string }>(
        `WITH quotes AS (
           SELECT rate, rate_date, 'manual_fx_rates'::text AS source, 0 AS priority
             FROM finance.manual_fx_rates
            WHERE base_code = 'EUR' AND quote_code = $1 AND rate_date <= $2
           UNION ALL
           SELECT rate, rate_date, 'fx_rates'::text AS source, 1 AS priority
             FROM finance.fx_rates
            WHERE base_code = 'EUR' AND quote_code = $1 AND rate_date <= $2
         )
         SELECT rate, rate_date, source
           FROM quotes
          ORDER BY rate_date DESC, priority ASC
          LIMIT 1`,
        [code, date],
      );
      const row = result.rows[0];
      if (!row) return null;
      return { rate: row.rate, rateDate: row.rate_date, source: row.source };
    },
  }, cache);
}

/** The pure part of the reader, split out so the triangle math is testable without Postgres. */
export function buildFxReader(source: RateSource, cache = new RateCache()): FxReader {
  /**
   * One leg: `EUR -> code` on the given date.
   *
   * `finance.manual_fx_rates` wins for its date because the ECB feed simply does
   * not quote AED, SAR, PKR, BDT or NGN.
   */
  async function leg(code: string, date: string): Promise<Leg | null> {
    if (code === "EUR") {
      return { rate: 1, rateDate: date, source: "identity" };
    }
    const row = await source.latest(code, date);
    if (!row) return null;
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const rateDate = row.rateDate instanceof Date
      ? row.rateDate.toISOString().slice(0, 10)
      : String(row.rateDate).slice(0, 10);
    return { rate, rateDate, source: row.source === "manual_fx_rates" ? "manual_fx_rates" : "fx_rates" };
  }

  async function lookup(from: string, to: string, date: string): Promise<FxResult> {
    const key = `${from}:${to}:${date}`;
    const cached = cache.get(key);
    if (cached) return cached;

    let value: FxResult;
    if (from === to) {
      value = { ok: true, rate: { rate: 1, rateDate: date, source: "identity" } };
    } else {
      const [fromLeg, toLeg] = await Promise.all([leg(from ?? "", date), leg(to, date)]);
      if (!fromLeg || !toLeg) {
        value = { ok: false, reason: "missing_rate", from, to, date };
      } else {
        const rate = toLeg.rate / fromLeg.rate;
        if (!Number.isFinite(rate) || rate <= 0) {
          value = { ok: false, reason: "missing_rate", from, to, date };
        } else {
          // Report the older of the two leg dates: that is the effective date of
          // this cross rate, and the one a reader should show.
          const rateDate = fromLeg.rateDate < toLeg.rateDate ? fromLeg.rateDate : toLeg.rateDate;
          const source =
            fromLeg.source === toLeg.source
              ? fromLeg.source
              : fromLeg.source === "identity"
                ? toLeg.source
                : toLeg.source === "identity"
                  ? fromLeg.source
                  : "mixed";
          value = { ok: true, rate: { rate, rateDate, source } };
        }
      }
    }

    cache.set(key, value);
    return value;
  }

  return {
    rate: async (from, to, date) => {
      const f = normalizeCode(from);
      const t = normalizeCode(to);
      const d = isIsoDate(date) ? date : new Date().toISOString().slice(0, 10);
      if (!/^[A-Z]{3}$/.test(f) || !/^[A-Z]{3}$/.test(t)) {
        return { ok: false, reason: "missing_rate", from: f, to: t, date: d };
      }
      return lookup(f, t, d);
    },

    convert: async (amount, from, to, date) => {
      const f = normalizeCode(from);
      const t = normalizeCode(to);
      const d = isIsoDate(date) ? date : new Date().toISOString().slice(0, 10);
      if (!Number.isFinite(amount)) {
        return { ok: false, reason: "missing_rate", from: f, to: t, date: d };
      }
      if (f === t) {
        return { ok: true, amount: amount.toFixed(2), rate: 1, rateDate: d, source: "identity" };
      }
      const result = await lookup(f, t, d);
      if (!result.ok) {
        return { ok: false, reason: "missing_rate", from: f, to: t, date: d };
      }
      return {
        ok: true,
        amount: (amount * result.rate.rate).toFixed(2),
        rate: result.rate.rate,
        rateDate: result.rate.rateDate,
        source: result.rate.source,
      };
    },

    clear: () => cache.clear(),
  };
}

