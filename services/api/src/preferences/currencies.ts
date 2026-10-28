import { openPool } from "../db/pool.js";
import { knownCurrencyCodes, minorUnitsFor } from "../money/symbols.js";

/**
 * `ref.currency`, read once and cached.
 *
 * The clients could call the platform's CLDR directly and mostly do. This exists
 * for the two cases where platform data is not enough:
 *
 *  1. A code the device locale has never heard of still has to render something.
 *     `monetary` and the separators here make that possible without a guess.
 *  2. The server formats evidence strings ("₹1,180.00", "USD 14.00") and must agree
 *     with what the app will render, so both read the same row.
 *
 * A lookup failure is never fatal: `currencyFormats` falls back to the in-process
 * ISO list, which is the same data for every code the engine can detect.
 */

export type CurrencyFormat = {
  code: string;
  displayName: string;
  /** `null` when the currency has no glyph and is written as its ISO code. */
  symbol: string | null;
  minorUnits: number;
  /** `null` when the currency does not group. Otherwise right-to-left widths. */
  groupSizes: number[] | null;
  decimalSeparator: string;
  groupSeparator: string;
  monetary: boolean;
};

type Row = {
  currency_code: string;
  display_name: string;
  symbol: string | null;
  minor_units: number;
  group_sizes: number[] | null;
  decimal_separator: string;
  group_separator: string;
  monetary: boolean;
};

function toFormat(row: Row): CurrencyFormat {
  return {
    code: row.currency_code.trim(),
    displayName: row.display_name,
    symbol: row.symbol,
    minorUnits: Number(row.minor_units),
    groupSizes: row.group_sizes,
    decimalSeparator: row.decimal_separator,
    groupSeparator: row.group_separator,
    monetary: row.monetary,
  };
}

/** The in-process list, used when the table has not been migrated yet. */
function fallback(code: string): CurrencyFormat {
  return {
    code,
    displayName: code,
    symbol: null,
    minorUnits: minorUnitsFor(code),
    groupSizes: code === "INR" ? [2, 2, 3] : [3],
    decimalSeparator: ".",
    groupSeparator: ",",
    monetary: knownCurrencyCodes.has(code),
  };
}

export type CurrencyDirectory = {
  /** Every row, ordered by code. */
  list(): Promise<CurrencyFormat[]>;
  /** One code, or the in-process fallback when the table has no row. */
  get(code: string): Promise<CurrencyFormat>;
  /** `{ INR: {...}, USD: {...} }` for a fixed set, for a client's format cache. */
  forCodes(codes: string[]): Promise<Record<string, CurrencyFormat>>;
  close(): Promise<void>;
};

export function createCurrencyDirectory(databaseUrl: string): CurrencyDirectory {
  const pool = openPool(databaseUrl, 2);
  let cache: Map<string, CurrencyFormat> | null = null;

  async function load(): Promise<Map<string, CurrencyFormat>> {
    if (cache) return cache;
    try {
      const result = await pool.query<Row>(
        `SELECT currency_code::text, display_name, symbol, minor_units,
                group_sizes, decimal_separator, group_separator, monetary
           FROM ref.currency
          ORDER BY currency_code`,
      );
      const map = new Map<string, CurrencyFormat>();
      for (const row of result.rows) {
        const format = toFormat(row);
        map.set(format.code, format);
      }
      // A reference table is small and changes only by migration, so a cache that
      // never expires is correct; the process restarts with every deploy.
      if (map.size > 0) {
        cache = map;
        return map;
      }
    } catch {
      // Pre-0060 database, or no grant: the fallback below is the same data for
      // every code the detector can produce.
    }
    cache = new Map();
    return cache;
  }

  return {
    async list() {
      const map = await load();
      return [...map.values()];
    },

    async get(code: string) {
      const normalised = code.trim().toUpperCase();
      const map = await load();
      return map.get(normalised) ?? fallback(normalised);
    },

    async forCodes(codes) {
      const map = await load();
      const out: Record<string, CurrencyFormat> = {};
      for (const raw of codes) {
        const code = raw.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(code) || out[code]) continue;
        out[code] = map.get(code) ?? fallback(code);
      }
      return out;
    },

    async close() {
      await pool.end();
    },
  };
}
