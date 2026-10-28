/**
 * Locale-aware amount reading.
 *
 * Three things bite here and none of them are optional:
 *
 * 1. The decimal mark is the *last* separator, not always a dot. `1.234,56`
 *    is German, `1,234.56` is English, `1,50,000.00` is Indian grouping.
 * 2. Digits are not always ASCII. Arabic-Indic, Eastern Arabic-Indic, Devanagari
 *    and Persian digits all appear in real bank mail.
 * 3. A numeric capture must be one token. `/(\d[\d.,\s]*\d)/` will happily swallow
 *    "1,180.00 12,500.00" as a single number, because whitespace groups match too.
 *
 * `dates.ts` is not reusable: it only strips ₹ and $, and it assumes one date shape.
 */

const digitMap: Record<string, string> = {
  // Arabic-Indic
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  // Eastern Arabic-Indic (Persian variants share most glyphs, ۴ and ۵ differ)
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  // Devanagari
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
  // Bengali
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

/** Fold every supported digit system to ASCII. Leaves other characters alone. */
export function normalizeDigits(text: string): string {
  let out = "";
  for (const ch of text) {
    out += digitMap[ch] ?? ch;
  }
  return out;
}

export type ParsedAmount = {
  /** Two-decimal string, matching the existing spot column contract. */
  amount: string;
  /** The literal fragment that was read, for evidence. */
  raw: string;
  index: number;
  /** True when grouping or a decimal part was present, i.e. this looked like money. */
  looksMonetary: boolean;
};

export type SeparatorStyle = "last-separator" | "dot" | "comma" | "unknown";

/**
 * Decide which of `.` and `,` is the decimal mark.
 *
 * - Both present: the one that appears last wins. `1.234,56` -> comma,
 *   `1,234.56` -> dot.
 * - Only one present, appearing once: decimal if the fraction is not a clean
 *   group of three, otherwise a thousands separator. `1.50` -> decimal,
 *   `1,500` -> thousands.
 * - Only one present, appearing more than once: separator, unless the last
 *   group is not three digits and is the final group (`1.234.567,89` is already
 *   covered by the both-present case; `1,50,000` is Indian grouping).
 */
export function classifySeparators(token: string): SeparatorStyle {
  const lastDot = token.lastIndexOf(".");
  const lastComma = token.lastIndexOf(",");

  if (lastDot >= 0 && lastComma >= 0) {
    return lastDot > lastComma ? "dot" : "comma";
  }

  if (lastDot < 0 && lastComma < 0) {
    return "unknown";
  }

  const mark = lastDot >= 0 ? "." : ",";
  const parts = token.split(mark);

  if (parts.length === 2) {
    const fraction = parts[1] ?? "";
    // A single separator followed by exactly three digits is a group, unless the
    // leading part is 0 ("0.500") where it reads as a decimal fraction.
    if (fraction.length === 3 && (parts[0] ?? "").length > 0 && parts[0] !== "0") {
      return "unknown";
    }
    return mark === "." ? "dot" : "comma";
  }

  // More than one occurrence is grouping. Indian lakh ("1,50,000") included.
  return "unknown";
}

/**
 * Turn one numeric token into a two-decimal string.
 * Returns null when the token cannot be a positive number.
 */
export function parseNumericToken(token: string): { value: number; style: SeparatorStyle } | null {
  const cleaned = normalizeDigits(token).trim();
  if (!/^[0-9][0-9.,\u00a0' ’]*[0-9]$|^[0-9]$/.test(cleaned)) {
    return null;
  }

  const style = classifySeparators(cleaned);
  let integerPart = cleaned;
  let fractionPart = "";

  if (style === "dot") {
    const cut = cleaned.lastIndexOf(".");
    integerPart = cleaned.slice(0, cut);
    fractionPart = cleaned.slice(cut + 1);
  } else if (style === "comma") {
    const cut = cleaned.lastIndexOf(",");
    integerPart = cleaned.slice(0, cut);
    fractionPart = cleaned.slice(cut + 1);
  }

  // Everything that is not a digit is now grouping noise.
  integerPart = integerPart.replace(/[^0-9]/g, "");
  fractionPart = fractionPart.replace(/[^0-9]/g, "");

  if (!integerPart) {
    return null;
  }
  if (fractionPart.length > 6) {
    // 0.1234567 is not an amount; it is usually a rate or an account fragment.
    return null;
  }

  const value = Number(`${integerPart}.${fractionPart || "0"}`);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  // Guard against a swallowed range such as "1,180.00 12" becoming 11800012.
  if (integerPart.length > 15) {
    return null;
  }

  return { value, style };
}

/**
 * Find money-shaped tokens in free text.
 *
 * The capture is deliberately narrow: optional prefix glyph or code, then a
 * single run of digits with at most one internal separator style. Whitespace is
 * only allowed as a group separator when the surrounding groups are exactly
 * three digits, which is the only case a bank writes "1 234,56".
 */
const numericToken = String.raw`\d{1,3}(?:[,.\u00a0' ’]\d{1,3})*(?:[,.]\d{1,4})?|\d+(?:[.,]\d{1,4})?`;

const amountTokenPattern = new RegExp(
  String.raw`(?<![0-9])(${numericToken})(?!\s*[0-9])(?!\s*%)`,
  "g",
);

export type AmountHit = ParsedAmount & {
  /** Characters immediately before the token, e.g. "₹", "USD", "Rs." */
  prefix: string;
  /** Characters immediately after the token, e.g. "USD", "rupees" */
  suffix: string;
};

/**
 * All plausible monetary tokens in `text`, in order.
 *
 * `excludeIndices` lets a caller drop a span already consumed as a balance or a
 * date. Ranges are half-open.
 */
export function findAmounts(text: string, excludeIndices: Array<[number, number]> = []): AmountHit[] {
  const normalized = normalizeDigits(text);
  const hits: AmountHit[] = [];

  for (const match of normalized.matchAll(amountTokenPattern)) {
    const start = match.index ?? 0;
    const raw = match[1] ?? "";
    const end = start + raw.length;

    if (excludeIndices.some(([from, to]) => start < to && end > from)) {
      continue;
    }

    const parsed = parseNumericToken(raw);
    if (!parsed) {
      continue;
    }

    const before = normalized.slice(Math.max(0, start - 6), start);
    const after = normalized.slice(end, Math.min(normalized.length, end + 12));

    // A long unseparated digit run is a reference, a card number or an account.
    // Money in a bank alert does not reach ten integer digits, and every real
    // amount of that size carries grouping.
    const integerDigits = raw.replace(/[^0-9]/g, "").length;
    const hasSeparator = /[.,]/.test(raw);
    if (!hasSeparator && integerDigits >= 10) {
      continue;
    }

    hits.push({
      amount: parsed.value.toFixed(2),
      raw,
      index: start,
      // A bare run of digits is a reference, a card suffix or a year far more
      // often than it is money. Unadorned money is written with a decimal or with
      // grouping; anything else needs a symbol or a code next to it, which the
      // caller checks separately.
      looksMonetary: /[.,]/.test(raw),
      prefix: before,
      suffix: after,
    });
  }

  return hits;
}

/**
 * Currency marks that can precede a number. `Rs`/`RE` are abbreviation forms used
 * across South Asia and the Gulf; the rupee glyph family is handled separately by
 * `detect.ts` because one glyph covers several countries.
 */
const symbolBefore = /(?:₹|₨|£|€|¥|₩|฿|₦|₱|₫|₪|₺|₴|₸|৳|\$|R\$|(?<![A-Za-z])(?:RS|RE)\.?)\s*$/i;
const codeBefore = /\b([A-Z]{3})\s*$/;
const codeAfter = /^\s*([A-Z]{3})\b/;
const wordAfter = /^\s*(?:rupees?|dollars?|euros?|pounds?|yen|won|baht|naira|dirhams?|riyals?|taka|pesos?)\b/i;

/** What the text immediately around a hit says about its currency, before ISO resolution. */
export function prefixCode(hit: AmountHit): string | null {
  const code = hit.prefix.match(codeBefore)?.[1];
  return code ?? null;
}

export function hasSymbol(hit: AmountHit): boolean {
  return symbolBefore.test(hit.prefix);
}

export function suffixCode(hit: AmountHit): string | null {
  return hit.suffix.match(codeAfter)?.[1] ?? null;
}

export function hasWordUnit(hit: AmountHit): boolean {
  return wordAfter.test(hit.suffix);
}

/**
 * Whether a hit is money rather than a reference, a card suffix or a year.
 *
 * A decimal or grouping settles it. Otherwise the token must be marked as money
 * by an adjacent currency code, symbol or unit — "Rs 99" is an amount, "99" on
 * its own is not.
 */
export function isMonetaryHit(hit: AmountHit): boolean {
  if (hit.looksMonetary) return true;
  if (hasSymbol(hit)) return true;
  if (hasWordUnit(hit)) return true;
  const before = prefixCode(hit);
  if (before && /^[A-Z]{3}$/.test(before)) return true;
  const after = suffixCode(hit);
  return Boolean(after && /^[A-Z]{3}$/.test(after));
}
