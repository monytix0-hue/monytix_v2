export type DueDateDraft = {
  biller: string;
  amount: string;
  currency: "INR";
  dueDate: string;
  category: "CREDIT_CARD" | "UTILITY" | "INSURANCE_PREMIUM";
};

const duePhrase = /\b(?:due\s+date|due\s+on|due\s+by|payment\s+due|amount\s+due)\b[:\s-]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i;
const amountPhrase = /(?:₹|rs\.?|inr)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i;
const months: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function readDueDate(text: string): DueDateDraft | null {
  const due = text.match(duePhrase);
  const amount = text.match(amountPhrase);
  if (!due?.[1] || !amount?.[1]) {
    return null;
  }
  const dueDate = normalizeDueDate(due[1]);
  if (!dueDate) {
    return null;
  }
  const numeric = amount[1].replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(numeric)) {
    return null;
  }
  return {
    biller: billerOf(text),
    amount: Number(numeric).toFixed(2),
    currency: "INR",
    dueDate,
    category: categoryOf(text),
  };
}

function normalizeDueDate(value: string): string | null {
  const named = value.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (named) {
    const month = months[named[2].slice(0, 3).toLowerCase()];
    if (!month) {
      return null;
    }
    return `${named[3]}-${month}-${named[1].padStart(2, "0")}`;
  }
  const numeric = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!numeric) {
    return null;
  }
  const year = numeric[3].length === 2 ? (Number(numeric[3]) >= 70 ? `19${numeric[3]}` : `20${numeric[3]}`) : numeric[3];
  return `${year}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
}

function billerOf(text: string): string {
  const subject = text.match(/^subject:\s*(.+)$/im)?.[1]?.trim();
  const line = subject || text.split(/\r?\n/).map((row) => row.trim()).find((row) => row.length > 0) || "Biller";
  const cleaned = line.replace(/\s+/g, " ").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "Biller";
}

function categoryOf(text: string): DueDateDraft["category"] {
  if (/\b(credit card|visa|mastercard|rupay)\b/i.test(text)) {
    return "CREDIT_CARD";
  }
  if (/\b(premium|policy|insurance)\b/i.test(text)) {
    return "INSURANCE_PREMIUM";
  }
  return "UTILITY";
}
