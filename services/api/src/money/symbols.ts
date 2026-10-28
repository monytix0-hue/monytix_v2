/**
 * Currency symbols and the countries that use them.
 *
 * Two tiers only:
 *   - unambiguous: the glyph means exactly one ISO code (₹, £, €, ₩, ฿, ₦, R$).
 *   - ambiguous: the glyph needs another signal ($ across a dozen dollars).
 *
 * Nothing here guesses. `detect.ts` owns the resolution order.
 */

export type UnambiguousCurrency = {
  code: string;
  symbol: string;
  minorUnits: number;
  /** Digits between groups. `[]` means the currency does not group by habit. */
  groupSizes: number[];
};

/** Glyphs that identify one currency with no further evidence. */
export const unambiguousSymbols: Record<string, string> = {
  "₹": "INR",
  "₨": "PKR",
  "£": "GBP",
  "€": "EUR",
  "₩": "KRW",
  "฿": "THB",
  "₦": "NGN",
  "₱": "PHP",
  "₫": "VND",
  "₪": "ILS",
  "₺": "TRY",
  "₴": "UAH",
  "₸": "KZT",
  "৳": "BDT",
};

/**
 * The rupee sign is shared by India, Pakistan, Sri Lanka and Nepal.
 * `ref.currency` and the ISO set decide; the glyph alone is only a hint.
 */
export const rupeeFamily = new Set(["INR", "PKR", "LKR", "NPR", "MUR", "SCR"]);

/**
 * `$` is not a currency. Prefixed forms are.
 * Longest first so `US$` is not read as `$`.
 */
export const dollarPrefixes: Array<{ token: string; code: string }> = [
  { token: "US$", code: "USD" },
  { token: "U$S", code: "USD" },
  { token: "CA$", code: "CAD" },
  { token: "C$", code: "CAD" },
  { token: "A$", code: "AUD" },
  { token: "AU$", code: "AUD" },
  { token: "NZ$", code: "NZD" },
  { token: "HK$", code: "HKD" },
  { token: "SG$", code: "SGD" },
  { token: "S$", code: "SGD" },
  { token: "MX$", code: "MXN" },
  { token: "AR$", code: "ARS" },
  { token: "R$", code: "BRL" },
  { token: "CL$", code: "CLP" },
  { token: "CO$", code: "COP" },
  { token: "NT$", code: "TWD" },
];

/** Countries whose home currency is a dollar, in resolution priority when several apply. */
export const dollarCountries: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  AU: "AUD",
  NZ: "NZD",
  SG: "SGD",
  HK: "HKD",
  MX: "MXN",
  AR: "ARS",
  CL: "CLP",
  CO: "COP",
  TW: "TWD",
  JM: "JMD",
  BS: "BSD",
  BB: "BBD",
  BZ: "BZD",
  BM: "BMD",
  KY: "KYD",
  LR: "LRD",
  NA: "NAD",
  TT: "TTD",
  ZW: "ZWL",
  PR: "USD",
  EC: "USD",
  SV: "USD",
  PA: "USD",
};

/** Country -> default currency for the non-dollar cases we care about at first. */
export const countryCurrency: Record<string, string> = {
  ...dollarCountries,
  IN: "INR",
  GB: "GBP",
  IE: "EUR",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  PT: "EUR",
  FI: "EUR",
  GR: "EUR",
  LU: "EUR",
  SK: "EUR",
  SI: "EUR",
  EE: "EUR",
  LV: "EUR",
  LT: "EUR",
  MT: "EUR",
  CY: "EUR",
  HR: "EUR",
  CH: "CHF",
  LI: "CHF",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  IS: "ISK",
  PL: "PLN",
  CZ: "CZK",
  HU: "HUF",
  RO: "RON",
  BG: "BGN",
  RS: "RSD",
  TR: "TRY",
  UA: "UAH",
  RU: "RUB",
  IL: "ILS",
  AE: "AED",
  SA: "SAR",
  QA: "QAR",
  KW: "KWD",
  BH: "BHD",
  OM: "OMR",
  JO: "JOD",
  LB: "LBP",
  EG: "EGP",
  MA: "MAD",
  TN: "TND",
  DZ: "DZD",
  NG: "NGN",
  GH: "GHS",
  KE: "KES",
  TZ: "TZS",
  UG: "UGX",
  ZA: "ZAR",
  MU: "MUR",
  SC: "SCR",
  PK: "PKR",
  BD: "BDT",
  LK: "LKR",
  NP: "NPR",
  CN: "CNY",
  JP: "JPY",
  KR: "KRW",
  TW: "TWD",
  TH: "THB",
  VN: "VND",
  ID: "IDR",
  MY: "MYR",
  PH: "PHP",
  KH: "KHR",
  LA: "LAK",
  MM: "MMK",
  BR: "BRL",
  AR: "ARS",
  CL: "CLP",
  CO: "COP",
  PE: "PEN",
  UY: "UYU",
  BO: "BOB",
  PY: "PYG",
  VE: "VES",
  CR: "CRC",
  GT: "GTQ",
  DO: "DOP",
};

/**
 * Top-level domains used by banks in markets where the sender address is the
 * only country signal. Mapped to the country, not the currency: the dollar
 * table above resolves US to USD, .ca to CAD, and so on.
 */
export const senderTldCountries: Record<string, string> = {
  "co.in": "IN",
  "in": "IN",
  "co.uk": "GB",
  "uk": "GB",
  "ie": "IE",
  "de": "DE",
  "fr": "FR",
  "es": "ES",
  "it": "IT",
  "nl": "NL",
  "be": "BE",
  "at": "AT",
  "pt": "PT",
  "pl": "PL",
  "ch": "CH",
  "se": "SE",
  "no": "NO",
  "dk": "DK",
  "fi": "FI",
  "ae": "AE",
  "sa": "SA",
  "qa": "QA",
  "ng": "NG",
  "ke": "KE",
  "za": "ZA",
  "pk": "PK",
  "bd": "BD",
  "lk": "LK",
  "np": "NP",
  "co.jp": "JP",
  "jp": "JP",
  "co.kr": "KR",
  "kr": "KR",
  "co.th": "TH",
  "th": "TH",
  "com.sg": "SG",
  "sg": "SG",
  "com.my": "MY",
  "my": "MY",
  "co.id": "ID",
  "id": "ID",
  "com.ph": "PH",
  "ph": "PH",
  "com.vn": "VN",
  "vn": "VN",
  "com.au": "AU",
  "au": "AU",
  "co.nz": "NZ",
  "nz": "NZ",
  "ca": "CA",
  "us": "US",
  "com.mx": "MX",
  "mx": "MX",
  "com.br": "BR",
  "br": "BR",
  "com.ar": "AR",
  "ar": "AR",
  "cl": "CL",
  "co": "CO",
  "com.tr": "TR",
  "tr": "TR",
  "com.hk": "HK",
  "hk": "HK",
  "com.tw": "TW",
  "tw": "TW",
  "cn": "CN",
};

/** Currencies whose minor unit is not 2 digits. */
export const zeroDecimalCurrencies = new Set([
  "JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF", "XPF", "PYG", "RWF", "VUV", "KMF", "DJF", "GNF", "BIF",
]);

/** Currencies that normally show three decimals. */
export const threeDecimalCurrencies = new Set(["BHD", "KWD", "OMR", "JOD", "TND", "LYD", "IQD"]);

export function minorUnitsFor(code: string): number {
  if (zeroDecimalCurrencies.has(code)) return 0;
  if (threeDecimalCurrencies.has(code)) return 3;
  return 2;
}

/**
 * Grouping by convention: 2-2-3 for the Indian lakh system, 3-3-3 elsewhere.
 * Clients format from platform locale, but the API needs this when it renders
 * a string itself (log lines, excerpts).
 */
export function groupSizesFor(code: string): number[] {
  return code === "INR" || code === "PKR" || code === "LKR" || code === "NPR" || code === "BDT"
    ? [3, 2]
    : [3];
}

/** The curated whole-token ISO set. Matching `\b[A-Z]{3}\b` would hit THE, VPA, ATM. */
export const knownCurrencyCodes = new Set([
  "AED", "ARS", "AUD", "BGN", "BHD", "BRL", "CAD", "CHF", "CLP", "CNY", "COP", "CRC", "CZK",
  "DKK", "DOP", "DZD", "EGP", "EUR", "GBP", "GHS", "GTQ", "HKD", "HUF", "IDR", "ILS", "INR",
  "ISK", "JMD", "JOD", "JPY", "KES", "KHR", "KRW", "KWD", "KZT", "LAK", "LKR", "MAD", "MMK",
  "MUR", "MXN", "MYR", "NGN", "NOK", "NPR", "NZD", "OMR", "PEN", "PHP", "PKR", "PLN", "PYG",
  "QAR", "RON", "RSD", "RUB", "SAR", "SCR", "SEK", "SGD", "THB", "TND", "TRY", "TTD", "TWD",
  "TZS", "UAH", "UGX", "USD", "UYU", "VES", "VND", "XAF", "XOF", "XPF", "ZAR", "ZWL",
]);

/**
 * Tokens that are three uppercase letters but are never a currency in an
 * alert body. Kept explicit so the ISO scan cannot be loosened by accident.
 * Most are handled by membership in `knownCurrencyCodes`, but a few of these
 * are real ISO codes that show up as ordinary words (ALL, TOP, PEN).
 */
export const isoFalseFriends = new Set([
  "THE", "AND", "FOR", "YOU", "YOUR", "NOT", "ARE", "WAS", "HAS", "PAY", "VIA", "REF", "UTR",
  "RRN", "OTP", "ATM", "UPI", "VPA", "IMPS", "NEFT", "RTGS", "CARD", "DEBIT", "CREDIT", "BAL",
  "AVL", "TXN", "AMT", "NET", "BANK", "ACCT", "DATE", "TIME", "INFO", "ALERT", "NEVER", "SHARE",
  // Real ISO codes that collide with common words.
  "ALL", "TOP", "PEN", "TRY", "END", "SEK", "MAD", "BAM", "GEL", "AWG", "LAK", "MOP",
]);
