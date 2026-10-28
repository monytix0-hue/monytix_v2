import { openPool } from "../db/pool.js";
import { knownCurrencyCodes } from "../money/symbols.js";

/**
 * Owner preferences: the three settings that decide how money is read and shown.
 *
 * - `defaultCurrencyCode` is the *home* currency. It is never a ledger mutation;
 *   every `core.canonical_transaction_version` row keeps its booked currency and
 *   reads convert at display time.
 * - `timezoneName` decides which calendar date a transaction falls on, and
 *   supplies the offset for alert timestamps that carry none.
 * - `countryCode` picks the vocabulary pack and resolves an ambiguous `$`.
 */

export type OwnerPreferences = {
  defaultCurrencyCode: string;
  timezoneName: string;
  countryCode: string | null;
  locale: string | null;
  updatedAt: string | null;
};

export type PreferencesError =
  | "owner_not_found"
  | "invalid_currency"
  | "invalid_timezone"
  | "invalid_country"
  | "invalid_locale"
  | "empty_patch";

export type PreferencesStore = {
  read(ownerId: string): Promise<OwnerPreferences | null>;
  /** Validates the whole patch before writing, so a rejection leaves no partial row. */
  write(ownerId: string, patch: PreferencesPatch): Promise<
    | { ok: true; preferences: OwnerPreferences; warnings: PreferencesWarning[] }
    | { ok: false; error: PreferencesError }
  >;
  /** Currencies the owner actually holds, so the UI can warn on a mismatch. */
  heldCurrencies(ownerId: string): Promise<string[]>;
  close(): Promise<void>;
};

export type PreferencesPatch = {
  defaultCurrencyCode?: string;
  timezoneName?: string;
  countryCode?: string | null;
  locale?: string | null;
};

export type PreferencesWarning = {
  code: "no_account_in_currency" | "currency_not_quoted";
  message: string;
  currency: string;
};

const ownerUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const countryCodePattern = /^[A-Z]{2}$/;

/** `Intl` knows the IANA database, so no timezone list needs to be shipped. */
export function isValidTimeZone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** `de-DE`, `en-IN`, or a bare language. Rejects anything `Intl` cannot parse. */
export function isValidLocale(value: string): boolean {
  if (!value || value.length > 35) return false;
  try {
    return Intl.getCanonicalLocales(value).length > 0;
  } catch {
    return false;
  }
}

export function isSupportedCurrency(value: string): boolean {
  return knownCurrencyCodes.has(value);
}

type OwnerRow = {
  default_currency_code: string;
  timezone_name: string;
  country_code: string | null;
  locale: string | null;
  updated_at: Date | string | null;
};

function rowToPreferences(row: OwnerRow): OwnerPreferences {
  return {
    defaultCurrencyCode: row.default_currency_code.trim(),
    timezoneName: row.timezone_name,
    countryCode: row.country_code ? row.country_code.trim() : null,
    locale: row.locale,
    updatedAt: row.updated_at === null
      ? null
      : row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}

const selectColumns = `
  btrim(default_currency_code) AS default_currency_code,
  timezone_name,
  nullif(upper(btrim(metadata->>'country_code')), '') AS country_code,
  nullif(btrim(metadata->>'locale'), '') AS locale,
  updated_at`;

export function createPreferencesStore(databaseUrl: string): PreferencesStore {
  const pool = openPool(databaseUrl, 2);

  async function heldCurrencies(ownerId: string): Promise<string[]> {
    if (!ownerUuid.test(ownerId)) return [];
    const result = await pool.query<{ currency_code: string }>(
      `SELECT DISTINCT btrim(a.base_currency_code) AS currency_code
         FROM core.account_ownership o
         JOIN core.financial_account a ON a.financial_account_id = o.financial_account_id
        WHERE o.owner_id = $1::uuid
          AND o.relationship_status = 'ACTIVE'
          AND o.effective_to IS NULL
          AND o.verification_state <> 'REVOKED'
          AND a.lifecycle_status = 'ACTIVE'
        ORDER BY 1`,
      [ownerId],
    );
    return result.rows.map((row) => row.currency_code);
  }

  /** Codes a rate is actually published for, so the UI can warn before a rate gap. */
  async function quotedCurrencies(): Promise<Set<string>> {
    const result = await pool.query<{ code: string }>(
      `SELECT DISTINCT btrim(quote_code) AS code FROM finance.fx_rates
        UNION
       SELECT DISTINCT btrim(quote_code) AS code FROM finance.manual_fx_rates`,
    );
    return new Set(result.rows.map((row) => row.code));
  }

  return {
    async read(ownerId) {
      if (!ownerUuid.test(ownerId)) return null;
      const result = await pool.query<OwnerRow>(
        `SELECT ${selectColumns} FROM core.owner WHERE owner_id = $1::uuid`,
        [ownerId],
      );
      const row = result.rows[0];
      return row ? rowToPreferences(row) : null;
    },

    heldCurrencies,

    async write(ownerId, patch) {
      if (!ownerUuid.test(ownerId)) {
        return { ok: false, error: "owner_not_found" };
      }

      const hasCurrency = Object.prototype.hasOwnProperty.call(patch, "defaultCurrencyCode");
      const hasTimezone = Object.prototype.hasOwnProperty.call(patch, "timezoneName");
      const hasCountry = Object.prototype.hasOwnProperty.call(patch, "countryCode");
      const hasLocale = Object.prototype.hasOwnProperty.call(patch, "locale");
      if (!hasCurrency && !hasTimezone && !hasCountry && !hasLocale) {
        return { ok: false, error: "empty_patch" };
      }

      let currency: string | null = null;
      if (hasCurrency) {
        currency = (patch.defaultCurrencyCode ?? "").trim().toUpperCase();
        if (!isSupportedCurrency(currency)) {
          return { ok: false, error: "invalid_currency" };
        }
      }
      let timezone: string | null = null;
      if (hasTimezone) {
        timezone = (patch.timezoneName ?? "").trim();
        if (!isValidTimeZone(timezone)) {
          return { ok: false, error: "invalid_timezone" };
        }
      }
      let country: string | null = null;
      if (hasCountry) {
        const raw = (patch.countryCode ?? "").trim().toUpperCase();
        if (raw !== "" && !countryCodePattern.test(raw)) {
          return { ok: false, error: "invalid_country" };
        }
        country = raw === "" ? null : raw;
      }
      let locale: string | null = null;
      if (hasLocale) {
        const raw = (patch.locale ?? "").trim();
        if (raw !== "" && !isValidLocale(raw)) {
          return { ok: false, error: "invalid_locale" };
        }
        locale = raw === "" ? null : raw;
      }

      const result = await pool.query<OwnerRow>(
        `UPDATE core.owner
            SET default_currency_code = COALESCE($2::char(3), default_currency_code),
                timezone_name = COALESCE($3, timezone_name),
                metadata = metadata
                  || CASE WHEN $4::boolean THEN jsonb_build_object('country_code', $5::text) ELSE '{}'::jsonb END
                  || CASE WHEN $6::boolean THEN jsonb_build_object('locale', $7::text) ELSE '{}'::jsonb END,
                updated_at = clock_timestamp()
          WHERE owner_id = $1::uuid
          RETURNING ${selectColumns}`,
        [
          ownerId,
          hasCurrency ? currency : null,
          hasTimezone ? timezone : null,
          hasCountry,
          country,
          hasLocale,
          locale,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        return { ok: false, error: "owner_not_found" };
      }
      const preferences = rowToPreferences(row);

      // Warn rather than refuse. An owner may set a home currency before adding
      // the account that holds it, and blocking that would be surprising.
      const warnings: PreferencesWarning[] = [];
      if (hasCurrency && currency) {
        const held = await heldCurrencies(ownerId);
        if (held.length > 0 && !held.includes(currency)) {
          warnings.push({
            code: "no_account_in_currency",
            message: `No active account is held in ${currency}. Totals will be converted from ${held.join(", ")}.`,
            currency,
          });
        }
        const quoted = await quotedCurrencies();
        if (currency !== "EUR" && !quoted.has(currency)) {
          warnings.push({
            code: "currency_not_quoted",
            message: `No FX rate is published for ${currency} yet, so display totals will be flagged until one is.`,
            currency,
          });
        }
      }

      return { ok: true, preferences, warnings };
    },

    async close() {
      await pool.end();
    },
  };
}
