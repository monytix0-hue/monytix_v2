import { detectCurrency } from "../money/detect.js";
import { findAmounts, isMonetaryHit } from "../money/parse.js";
import { resolveLocalePack, type LocalePack } from "./locales/index.js";

export type DueDateDraft = {
  biller: string;
  amount: string;
  currency: string;
  currencyBasis: string;
  currencyConfidence: number;
  dueDate: string;
  category: "CREDIT_CARD" | "UTILITY" | "INSURANCE_PREMIUM";
};

export type ReadDueDateContext = {
  locale?: LocalePack;
  defaultCurrency?: string | null;
  country?: string | null;
  sender?: string | null;
  /** Resolved `ref.institution.country_code` for the sender, when known. */
  institutionCountry?: string | null;
  /**
   * Owner's locale tag, e.g. `en-US`. Decides month-first vs day-first when both
   * readings are valid; `Intl` already knows the answer for every tag.
   */
  localeTag?: string | null;
};

/**
 * Whether a locale writes `03/15/2026`. Derived from `Intl` rather than a table
 * we would have to keep current: ask for a known date and read the field order.
 */
export function localeIsMonthFirst(localeTag: string | null | undefined): boolean {
  const tag = (localeTag ?? "").trim();
  if (!tag) return false;
  try {
    const parts = new Intl.DateTimeFormat(tag, { year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(Date.UTC(2026, 2, 15)));
    const order = parts.map((part) => part.type).filter((type) => type === "month" || type === "day");
    return order[0] === "month";
  } catch {
    return false;
  }
}

/**
 * Markets write dates with `/`, `-` or `.` as the separator. `12.03.2026` is
 * ordinary German and must not be read as two amounts.
 */
const duePhrase = /\b(?:due\s+date|due\s+on|due\s+by|payment\s+due|amount\s+due|fällig\s+am|échéance|vencimiento|vencimento)\b[:\s-]*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}\s+[A-Za-zÀ-ÿ]{3,9}\s+\d{4})/i;

export function readDueDate(text: string, context: ReadDueDateContext = {}): DueDateDraft | null {
  const locale = context.locale ?? resolveLocalePack({});
  const due = text.match(duePhrase);
  if (!due?.[1]) {
    return null;
  }

  // The amount is read with the same locale-aware reader as alerts, so a
  // "1.234,56 EUR" bill is not silently read as 1.23456. The due date itself is
  // excluded: "15.04.2026" is not a grouped number.
  const dueIndex = due.index ?? 0;
  const dueSpan: [number, number] = [dueIndex, dueIndex + due[0].length];
  const amounts = findAmounts(text, [dueSpan]).filter((hit) => isMonetaryHit(hit));
  if (amounts.length === 0) {
    return null;
  }
  amounts.sort((left, right) => Math.abs(left.index - dueIndex) - Math.abs(right.index - dueIndex));
  const amount = amounts[0]!;

  const detection = detectCurrency({
    text,
    senderAddress: context.sender ?? null,
    institutionCountry: context.institutionCountry ?? null,
    ownerCountry: context.country ?? null,
    ownerDefaultCurrency: context.defaultCurrency ?? null,
  });
  const adjacent = /(?:[A-Z]{3})\s*$/.test(amount.prefix)
    ? amount.prefix.trim().slice(-3)
    : (amount.suffix.match(/^\s*([A-Z]{3})\b/)?.[1] ?? null);
  const currency = adjacent ?? detection.code;

  const dueDate = normalizeDueDate(due[1], localeIsMonthFirst(context.localeTag));
  if (!dueDate) {
    return null;
  }

  return {
    biller: billerOf(text),
    amount: amount.amount,
    currency,
    currencyBasis: adjacent ? "EXPLICIT_ISO" : detection.basis,
    currencyConfidence: adjacent ? 0.95 : detection.confidence,
    dueDate,
    category: categoryOf(text),
  };
}

function normalizeDueDate(value: string, monthFirst: boolean): string | null {
  const named = value.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,9})\s+(\d{4})$/);
  if (named) {
    const month = months[named[2]!.slice(0, 3).toLowerCase()];
    if (!month) {
      return null;
    }
    return `${named[3]}-${month}-${named[1]!.padStart(2, "0")}`;
  }
  const numeric = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!numeric) {
    return null;
  }
  // Locale decides day-first vs month-first. A day above 12 settles it outright;
  // otherwise the caller's locale is the only signal we have.
  const first = Number(numeric[1]);
  const second = Number(numeric[2]);
  let day = first;
  let month = second;
  if (first > 12 && second <= 12) {
    day = first;
    month = second;
  } else if (second > 12 && first <= 12) {
    day = second;
    month = first;
  } else if (monthFirst) {
    day = second;
    month = first;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const year = numeric[3]!.length === 2
    ? (Number(numeric[3]) >= 70 ? `19${numeric[3]}` : `20${numeric[3]}`)
    : numeric[3]!;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const months: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function billerOf(text: string): string {
  const subject = text.match(/^subject:\s*(.+)$/im)?.[1]?.trim();
  const line = subject || text.split(/\r?\n/).map((row) => row.trim()).find((row) => row.length > 0) || "Biller";
  const cleaned = line.replace(/\s+/g, " ").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "Biller";
}

function categoryOf(text: string): DueDateDraft["category"] {
  if (/\b(credit card|visa|mastercard|rupay|kreditkarte|carte de crédit|tarjeta de crédito|cartão de crédito)\b/i.test(text)) {
    return "CREDIT_CARD";
  }
  if (/\b(premium|policy|insurance|versicherung|assurance|seguro)\b/i.test(text)) {
    return "INSURANCE_PREMIUM";
  }
  return "UTILITY";
}
