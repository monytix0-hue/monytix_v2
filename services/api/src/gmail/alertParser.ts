import { createHash } from "node:crypto";

export type SpotChannel = "UPI" | "IMPS" | "NEFT" | "RTGS" | "ATM" | "CARD" | "OTHER";

export type SpotAlert = {
  flow: "DEBIT" | "CREDIT";
  amount: string;
  currency: "INR";
  accountLast4?: string;
  paymentRef?: string;
  channel: SpotChannel;
  counterparty: string;
  postedAt?: string;
  rawExcerpt: string;
};

const months: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

const debitVerb = /\b(debited|spent|paid|sent to|withdrawn)\b/i;
const creditVerb = /\b(credited|received|deposited|refund)\b/i;
const amountPattern = /(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*)/gi;
const balanceCue = /\b(?:avail(?:able)?|avl)\s*bal|\bbalance\b|\bbal\b/i;

export function parseTransactionFromEmail(text: string, hint?: { postedAt?: string }): SpotAlert | null {
  const clean = readableText(text);
  if (!clean) {
    return null;
  }
  const direction = directionOf(clean);
  if (!direction) {
    return null;
  }
  const amount = amountNear(clean, direction.index);
  if (!amount) {
    return null;
  }
  const accountLast4 = clean.match(/(?:a\/c|acct|account|card)\s*(?:ending\s*)?(?:no\.?)?\s*[*xX]*(\d{4})\b/i)?.[1];
  const paymentRef = clean.match(/\b(?:ref(?:erno)?|rrn|utr|txn\s*id)[:\s]*([0-9]{10,12}|[A-Za-z0-9]{12,16})\b/i)?.[1];
  const postedAt = postedAtFromText(clean) ?? hint?.postedAt;
  return {
    flow: direction.flow,
    amount,
    currency: "INR",
    accountLast4,
    paymentRef,
    channel: channelOf(clean),
    counterparty: counterpartyOf(clean),
    postedAt,
    rawExcerpt: clean.slice(0, 500),
  };
}

export function spotIdempotencyKey(ownerId: string, alert: Pick<SpotAlert, "paymentRef" | "amount" | "postedAt" | "counterparty">): string {
  if (alert.paymentRef && /^[A-Za-z0-9]{10,16}$/.test(alert.paymentRef)) {
    return `ref:${alert.paymentRef}`;
  }
  const hash = createHash("sha256")
    .update(`${ownerId}|${alert.amount}|${alert.postedAt ?? ""}|${alert.counterparty}`)
    .digest("hex");
  return `hash:${hash}`;
}

function readableText(text: string): string {
  return text
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8377;/g, "₹")
    .replace(/\s+/g, " ")
    .trim();
}

function directionOf(clean: string): { flow: SpotAlert["flow"]; index: number } | null {
  const debit = debitVerb.exec(clean);
  const credit = creditVerb.exec(clean);
  if (!debit && !credit) {
    return null;
  }
  if (debit && (!credit || debit.index <= credit.index)) {
    return { flow: "DEBIT", index: debit.index };
  }
  return { flow: "CREDIT", index: credit!.index };
}

function amountNear(clean: string, verbIndex: number): string | null {
  const hits: { index: number; amount: string }[] = [];
  for (const match of clean.matchAll(amountPattern)) {
    const start = match.index ?? 0;
    const window = clean.slice(Math.max(0, start - 40), start);
    if (balanceCue.test(window)) {
      continue;
    }
    const numeric = match[1]?.replace(/,/g, "") ?? "";
    if (!/^\d+(?:\.\d+)?$/.test(numeric)) {
      continue;
    }
    const value = Number(numeric);
    if (!(value > 0)) {
      continue;
    }
    hits.push({ index: start, amount: value.toFixed(2) });
  }
  if (hits.length === 0) {
    return null;
  }
  hits.sort((left, right) => Math.abs(left.index - verbIndex) - Math.abs(right.index - verbIndex));
  return hits[0]?.amount ?? null;
}

function channelOf(clean: string): SpotChannel {
  if (/\bUPI\b/i.test(clean)) return "UPI";
  if (/\bIMPS\b/i.test(clean)) return "IMPS";
  if (/\bNEFT\b/i.test(clean)) return "NEFT";
  if (/\bRTGS\b/i.test(clean)) return "RTGS";
  if (/\bATM\b/i.test(clean)) return "ATM";
  if (/\bcard\b/i.test(clean)) return "CARD";
  return "OTHER";
}

function counterpartyOf(clean: string): string {
  const vpa = clean.match(/\b([A-Za-z0-9][A-Za-z0-9._-]{0,40}@[A-Za-z0-9][A-Za-z0-9.-]{1,40})\b/);
  if (vpa?.[1]) {
    return vpa[1].slice(0, 120);
  }
  const marks = [...clean.matchAll(/\b(?:to|at|from)\s+/gi)];
  const last = marks.at(-1);
  if (!last || last.index === undefined) {
    return "Unknown";
  }
  const rest = clean.slice(last.index + last[0].length);
  const trimmed = rest.split(/\b(?:on|via|ref|utr|rrn|avail|for|a\/c|to|at|from)\b|[.]/i)[0]?.trim() ?? "";
  if (trimmed.length < 2 || /^your(?:\s+account)?$/i.test(trimmed)) {
    return "Unknown";
  }
  return trimmed.slice(0, 120);
}

function postedAtFromText(clean: string): string | undefined {
  const match = clean.match(/\b(\d{1,2})[/-]([A-Za-z]{3}|\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) {
    return undefined;
  }
  const month = monthOf(match[2] ?? "");
  const day = Number(match[1]);
  const year = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");
  if (!month || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }
  const stamp = `${year}-${month}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}+05:30`;
  return Number.isNaN(new Date(stamp).getTime()) ? undefined : stamp;
}

function monthOf(token: string): string | null {
  if (/^\d{1,2}$/.test(token)) {
    const month = Number(token);
    return month >= 1 && month <= 12 ? String(month).padStart(2, "0") : null;
  }
  return months[token.slice(0, 3).toLowerCase()] ?? null;
}
