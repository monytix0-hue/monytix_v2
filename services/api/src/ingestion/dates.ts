const months: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export type DateOptions = {
  /**
   * Whether `03/15/2026` means March 15. Derived from the owner's locale by the
   * caller. Only consulted when day-first is impossible.
   */
  monthFirst?: boolean;
};

export function normalizeDate(raw: string, options: DateOptions = {}): { value: string; resolved: boolean } {
  const text = raw.trim();
  if (!text) {
    return { value: "", resolved: false };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return validIso(text) ? { value: text, resolved: true } : { value: text, resolved: false };
  }
  const numeric = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (numeric) {
    return resolveNumeric(numeric[1]!, numeric[2]!, numeric[3]!, text, options.monthFirst === true);
  }
  const shortYear = text.match(/^(\d{2})[/-](\d{2})[/-](\d{2})$/);
  if (shortYear) {
    const year = Number(shortYear[3]);
    const fullYear = year >= 70 ? `19${shortYear[3]}` : `20${shortYear[3]}`;
    return resolveNumeric(shortYear[1]!, shortYear[2]!, fullYear, text, options.monthFirst === true);
  }
  const named = text.match(/^(\d{2})[/-]([A-Za-z]{3})[/-](\d{4})$/);
  if (named) {
    const month = months[named[2].toLowerCase()];
    if (!month) {
      return { value: text, resolved: false };
    }
    const iso = `${named[3]}-${String(month).padStart(2, "0")}-${named[1]}`;
    return validIso(iso) ? { value: iso, resolved: true } : { value: text, resolved: false };
  }
  return { value: text, resolved: false };
}

/**
 * Resolve a `a/b/yyyy` date.
 *
 * Day-first is the default because that is what every seeded statement has
 * always been. Two things can override it, in this order:
 *
 *  1. The numbers themselves. `15/03/2026` cannot be month-first, and
 *     `03/15/2026` cannot be day-first, so an unambiguous pair settles it.
 *  2. The owner's locale. `en-US` writes month-first, and there is no other
 *     evidence in a two-digit pair like `03/04/2026`.
 */
function resolveNumeric(
  first: string,
  second: string,
  year: string,
  raw: string,
  monthFirst: boolean,
): { value: string; resolved: boolean } {
  const a = Number(first);
  const b = Number(second);
  let day = a;
  let month = b;
  if (a > 12 && b <= 12) {
    day = a;
    month = b;
  } else if (b > 12 && a <= 12) {
    day = b;
    month = a;
  } else if (monthFirst) {
    day = b;
    month = a;
  }
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validIso(iso) ? { value: iso, resolved: true } : { value: raw, resolved: false };
}

function validIso(iso: string): boolean {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseMoney(raw: string): { amount: string; negative: boolean } | null {
  let text = raw.trim();
  if (!text || text === "-" || text === "—") {
    return null;
  }
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/[₹$,\s]/g, "").replace(/^(?:INR|Rs\.?)/i, "");
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return null;
  }
  return { amount: text.replace(/^0+(?=\d)/, ""), negative };
}

export function mapDirection(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (value === "DEBIT" || value === "DR" || value === "D") {
    return "OUT";
  }
  if (value === "CREDIT" || value === "CR" || value === "C") {
    return "IN";
  }
  if (value === "OUT" || value === "IN" || value === "REV") {
    return value;
  }
  return "";
}
