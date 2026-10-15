const months: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function normalizeDate(raw: string): { value: string; resolved: boolean } {
  const text = raw.trim();
  if (!text) {
    return { value: "", resolved: false };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return validIso(text) ? { value: text, resolved: true } : { value: text, resolved: false };
  }
  const numeric = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (numeric) {
    const iso = `${numeric[3]}-${numeric[2]}-${numeric[1]}`;
    return validIso(iso) ? { value: iso, resolved: true } : { value: text, resolved: false };
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
