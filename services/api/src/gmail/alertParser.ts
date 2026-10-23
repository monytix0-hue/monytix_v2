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

const debitVerb = /\b(debited|spent|paid|sent to|withdrawn|purchase of|txn of)\b/i;
const creditVerb = /\b(credited(?:\s+by|\s+to)?|received(?:\s+from)?|deposited|refund(?:\s+of)?|inward\s+(?:neft|imps|rtgs))\b/i;
const amountPattern = /(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*)/gi;
const balanceCue = /\b(?:avail(?:able)?|avl)\s*bal|\bbalance\b|\bbal\b/i;
const vpaPattern = /\b([A-Za-z0-9][A-Za-z0-9._-]{0,40}@[A-Za-z0-9][A-Za-z0-9.-]{1,40})\b/;
/** A newsletter can say "credited" next to a rupee figure. A spot needs an account movement. */
const accountMovement =
  /\b(?:is|was|been)\s+(?:debited|credited)\b|\b(?:debited|credited)\s+(?:from|to)\s+your\b|\b(?:debited|credited)\s+from\s+(?:your\s+)?(?:a\/c|acct|account|card)\b|\btowards\s+VPA\b|\b(?:a\/c|acct|account|card)\s+ending\b/i;
// "Never share your OTP" stays a merchant-title blacklist entry below. It must not
// reject the whole message: real debit alerts carry that sentence in the footer.
const disclaimerNoise = /\b(?:unauthori[sz]ed\b.*\bfraudulent|\bfraudulent\b.*\bunauthori[sz]ed|statutory\s+warning)\b/i;
/** Subject lines that are bank CRM, not a debit or credit. */
const nonTransactionSubject = [
  /\b(?:otp|one[- ]time password|verification code|secret code)\b/i,
  /\b(?:logged in|login alert|password reset|m-?pin|access alert)\b/i,
  /\b(?:e-statement|account statement|monthly statement)\b/i,
  /\b(?:re-?kyc|kyc|cibil|mandate created|standing instruction registered)\b/i,
  /\b(?:card dispatched|cheque book)\b/i,
  /\b(?:special offer|pre-approved|loan offer)\b/i,
];
/** Body phrases that are the point of the mail, not a footer on a real debit. */
const nonTransactionBody = [
  /is your (?:one[- ]time password|otp|secret code)/i,
  /use code \d{4,8} to/i,
  /successfully logged in/i,
  /your cibil score is/i,
];
const alertPrefix = /^(?:us|info|alert|dr|cr)\s*:\s*/i;
/** Marketing / bank-footer phrases that must never become a merchant title. */
const boilerplatePatterns: RegExp[] = [
  /support you in every\s*ste/i,
  /\baccount\s+ending\s+in\s+\d+/i,
  /unauthori[sz]ed\s+and\s+fraudule/i,
  /never\s+share\s+(?:your\s+)?otp/i,
  /thank you for banking/i,
  /warm regards/i,
  /customer care/i,
  /terms and conditions/i,
  /all rights reserved/i,
  /we are here to help/i,
  /netbanking\s*>?\s*insta\s*alerts/i,
  /visit your br/i,
  /know your available\s*bala/i,
  /please visit mycards/i,
  /be secure or error-free/i,
  /outstanding amount and transactions/i,
  /the number listed/i,
  /unsubscribe/i,
  /\be-?mandates?\b/i,
  /^know your\b/i,
  /^your system\b/i,
  /^the date of this notice\b/i,
  /^inform you that\b/i,
  /^complete your online purchase\b/i,
  /^make the payment\b/i,
  /\bwe(?:'re| are) writing\b/i,
  /\bwe have received payment\b/i,
  /^hdfc bank\b/i,
  /^icici bank\b/i,
  /anytime anywhere by using/i,
  /\bimobile\b/i,
  /aforementioned current\/savings/i,
  /^be paid\b/i,
  /^your bank account\b/i,
  /every corner of your home/i,
  /recovery of the overdue/i,
  /^set-?off\b/i,
];
const weakMerchant = /^(?:time|times|all|home|us|it|this|that|the|here|there|now|today|tomorrow)$/i;
const ownAccountPhrase = /^(?:your\s+)?(?:[\w&.\s-]+?\s+)?(?:bank\s+)?(?:a\/c|acct|account|card)(?:\s+ending(?:\s+in)?\s+\d{4})?$/i;
// Prefer "towards" / "paid to" before bare "to". Do not use "to merchant" — it eats names like "Merchant Cafe".
const debitCounterpartyMark =
  /\b(?:towards|paid\s+to|sent\s+to|to|at)\s+/gi;
const creditCounterpartyMark =
  /\b(?:transferred\s+from|received\s+from|credited\s+by|from)\s+/gi;
const counterpartyStop = /\b(?:on|via|ref|utr|rrn|avail|for|a\/c|to|at|from|towards|total|ending|with|umrn)\b|[.]/i;
const vpaParenMerchant =
  /\b(?:towards|to)\s+VPA\s+\S+@\S+\s*\(([^)]+)\)|\bVPA\s+\S+@\S+\s*\(([^)]+)\)|\bVPA\s*\(([^)]+)\)|\bVPA\s+([A-Za-z][A-Za-z0-9._-]{1,40})\b/i;
const cardAtMerchant = /\bat\s+([A-Z][A-Z0-9]{2,}(?:\s+[A-Z][A-Z0-9]+)*)\b/;

export function isNonTransactionalEmail(subject: string, body: string): boolean {
  const header = subject.trim();
  if (header && nonTransactionSubject.some((pattern) => pattern.test(header))) {
    return true;
  }
  return Boolean(body) && nonTransactionBody.some((pattern) => pattern.test(body));
}

export function parseTransactionFromEmail(
  text: string,
  hint?: { postedAt?: string; subject?: string },
): SpotAlert | null {
  const clean = readableText(text);
  const subject = readableText(hint?.subject ?? "");
  if (isNonTransactionalEmail(subject, clean)) {
    return null;
  }
  if (!clean || disclaimerNoise.test(clean)) {
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
  if (!accountMovement.test(clean) && !vpaPattern.test(clean)) {
    return null;
  }
  const accountLast4 = clean.match(/(?:a\/c|acct|account|card)\s*(?:ending\s*(?:in\s*)?)?(?:no\.?)?\s*[*xX]*(\d{4})\b/i)?.[1];
  const paymentRef = clean.match(/\b(?:ref(?:erno)?|rrn|utr|txn\s*id)[:\s]*([0-9]{10,12}|[A-Za-z0-9]{12,16})\b/i)?.[1];
  const postedAt = postedAtFromText(clean) ?? hint?.postedAt;
  return {
    flow: direction.flow,
    amount,
    currency: "INR",
    accountLast4,
    paymentRef,
    channel: channelOf(clean),
    counterparty: counterpartyOf(clean, direction.flow),
    postedAt,
    rawExcerpt: clean.slice(0, 500),
  };
}

export function spotIdempotencyKey(
  ownerId: string,
  alert: Pick<SpotAlert, "paymentRef" | "amount" | "postedAt" | "counterparty">,
  gmailMessageId: string,
): string {
  if (alert.paymentRef && /^[A-Za-z0-9]{10,16}$/.test(alert.paymentRef)) {
    return `ref:${alert.paymentRef}`;
  }
  const hash = createHash("sha256")
    .update(`${ownerId}|${gmailMessageId}|${alert.amount}|${alert.postedAt ?? ""}|${alert.counterparty}`)
    .digest("hex");
  return `hash:${hash}`;
}

/** Shared sanitize for Gmail bodies and Live display cleanup. */
export function readableText(text: string): string {
  let value = text
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?(?:td|th|tr|p|div|br|li|h[1-6])\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  value = decodeQuotedPrintable(value);
  value = unescapeHtmlEntities(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value;
}

function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=\s+/g, "")
    // Soft-break residue when the newline was already lost: "ste=p" / "bala=nce"
    .replace(/=(?=[a-z])/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function unescapeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&#8377;/g, "₹");
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

function counterpartyOf(clean: string, flow: SpotAlert["flow"]): string {
  const structured = structuredMerchant(clean);
  if (structured) {
    return structured;
  }
  const named = namedCounterparty(clean, flow);
  if (named) {
    return named;
  }
  const vpa = clean.match(vpaPattern)?.[1];
  if (vpa) {
    return labelForVpa(vpa);
  }
  return flow === "CREDIT" ? "Bank Transfer" : "General Spend";
}

/** True when text is bank marketing / own-account phrasing, not a merchant. */
export function isBoilerplateCounterparty(text: string): boolean {
  const value = text.trim();
  if (value.length < 2) {
    return true;
  }
  if (ownAccountPhrase.test(value)) {
    return true;
  }
  if (/^vpa\b/i.test(value) && !/\(/.test(value) && value.length < 12) {
    return true;
  }
  if (weakMerchant.test(value) || value.length < 3) {
    return true;
  }
  return boilerplatePatterns.some((pattern) => pattern.test(value));
}

/** HDFC-style "towards VPA x@y (Merchant)" / card "at APPLESERVICES". */
function structuredMerchant(clean: string): string | null {
  const vpa = clean.match(vpaParenMerchant);
  if (vpa) {
    const name = cleanMerchantCandidate(vpa[1] ?? vpa[2] ?? vpa[3] ?? vpa[4] ?? "");
    if (name && !isBoilerplateCounterparty(name)) {
      return name.slice(0, 120);
    }
  }
  const at = clean.match(cardAtMerchant);
  if (at?.[1]) {
    const name = cleanMerchantCandidate(at[1]);
    if (name && !isBoilerplateCounterparty(name)) {
      return name.slice(0, 120);
    }
  }
  return null;
}

function namedCounterparty(clean: string, flow: SpotAlert["flow"]): string | null {
  // First match wins (near the txn clause). Last-match used to grab footer "to support you…".
  const marks = [...clean.matchAll(flow === "CREDIT" ? creditCounterpartyMark : debitCounterpartyMark)];
  for (const mark of marks) {
    if (mark.index === undefined) {
      continue;
    }
    const rest = clean.slice(mark.index + mark[0].length);
    const trimmed = cleanMerchantCandidate(rest.split(counterpartyStop)[0] ?? "");
    if (!trimmed || isBoilerplateCounterparty(trimmed)) {
      continue;
    }
    // Reject only opaque terminal IDs (hex/digits), not short personal names like "Riya".
    if (/^[0-9a-fA-F]{2,8}$/.test(trimmed) || /^\d{2,8}$/.test(trimmed)) {
      continue;
    }
    return trimmed.slice(0, 120);
  }
  return null;
}

function cleanMerchantCandidate(text: string): string {
  // Mark regexes already consume "to merchant" / "to vpa" — do not strip a merchant name like "Merchant Cafe".
  let trimmed = text.replace(alertPrefix, "").trim();
  const paren = trimmed.match(/^\s*\(([^)]+)\)\s*$/);
  if (paren?.[1]) {
    trimmed = paren[1].trim();
  }
  trimmed = trimmed.replace(/^vpa\s+/i, "");
  trimmed = trimmed.replace(vpaPattern, "").trim();
  trimmed = trimmed.replace(/\s+ending\s+in\s+\d{4}\b/gi, "");
  trimmed = trimmed.replace(/\bBanking Corp\.?\b/gi, "").replace(/\b(?:Pvt\.?|Ltd\.?|Inc\.?|Limited)\b/gi, "");
  trimmed = trimmed.replace(/\*+/g, "").replace(/\s+/g, " ").trim();
  if (trimmed.length < 2 || /^your(?:\s+account)?$/i.test(trimmed)) {
    return "";
  }
  if (/^paytm(?:qr)?[-_]?\w*$/i.test(trimmed)) {
    return "Paytm";
  }
  return trimmed;
}

function labelForVpa(vpa: string): string {
  const [local = "", handle = ""] = vpa.split("@");
  const lowerHandle = handle.toLowerCase();
  if (/^paytm/i.test(local)) {
    return "Paytm";
  }
  if (isTerminalVpaLocal(local)) {
    return handle ? `UPI merchant (@${lowerHandle})` : "UPI merchant";
  }
  return local.replace(/[._-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()).slice(0, 120) || vpa.slice(0, 120);
}

function isTerminalVpaLocal(local: string): boolean {
  const token = local.trim();
  if (!token || token.length <= 4) {
    return true;
  }
  if (/^paytm(?:qr)?[-_]?\w*/i.test(token)) {
    return true;
  }
  return /^[0-9a-fA-F]+$/.test(token) || /^\d+$/.test(token) || /^q\d+$/i.test(token);
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
