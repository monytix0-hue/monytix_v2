import { createHash } from "node:crypto";
import {
  detectCurrency,
  needsReview,
  readMoney,
  type CurrencyBasis,
} from "../money/detect.js";
import { resolveLocalePack, type LocalePack } from "./locales/index.js";

export type SpotChannel = "UPI" | "IMPS" | "NEFT" | "RTGS" | "ATM" | "CARD" | "OTHER";

export type SpotAlert = {
  flow: "DEBIT" | "CREDIT";
  /** The booked amount: what left or entered the account. */
  amount: string;
  /** The booked currency. Not a literal type any more. */
  currency: string;
  currencyBasis: CurrencyBasis;
  currencyConfidence: number;
  /** Present only when the alert states a different amount than it books. */
  statedAmount?: string;
  statedCurrency?: string;
  accountLast4?: string;
  paymentRef?: string;
  channel: SpotChannel;
  counterparty: string;
  postedAt?: string;
  rawExcerpt: string;
};

export type ParseContext = {
  postedAt?: string;
  subject?: string;
  /** Which vocabulary pack to read with. Defaults to `en-IN`, the historical behaviour. */
  locale?: LocalePack;
  /** Owner timezone, IANA. Alert bodies print wall-clock time without an offset. */
  timezone?: string;
  /** `core.owner.default_currency_code`. The detector terminates here. */
  defaultCurrency?: string;
  /** `core.owner.metadata->>'country_code'`. */
  country?: string | null;
  /** Sender mailbox, for the TLD signal. */
  sender?: string | null;
  /** Resolved `ref.institution.country_code` for the sender, when known. */
  institutionCountry?: string | null;
  /** `base_currency_code` of the account this alert matches, when known. */
  accountCurrency?: string | null;
};

const alertPrefix = /^(?:us|info|alert|dr|cr)\s*:\s*/i;

const vpaParenMerchant =
  /\b(?:towards|to)\s+VPA\s+\S+@\S+\s*\(([^)]+)\)|\bVPA\s+\S+@\S+\s*\(([^)]+)\)|\bVPA\s*\(([^)]+)\)|\bVPA\s+([A-Za-z][A-Za-z0-9._-]{1,40})\b/i;
const cardAtMerchant = /\bat\s+([A-Z][A-Z0-9]{2,}(?:\s+[A-Z][A-Z0-9]+)*)\b/;

function defaultPack(): LocalePack {
  return resolveLocalePack({});
}

/** Due notes, loan reminders, and marketing are not recorded activity. */
export function isNoticeEmail(subject: string, body: string): boolean {
  const text = `${subject}\n${body}`;
  if (/\bstanding instruction\b/i.test(text) && /\bis due\b/i.test(text)) {
    return true;
  }
  if (/\bemi\b/i.test(text) && /\bis due\b/i.test(text)) {
    return true;
  }
  if (/please note that all important communications/i.test(text) || /\ba platform\b/i.test(text)) {
    return true;
  }
  const posted = /\btowards\s+VPA\b/i.test(body) || /\b(?:has been|was)\s+debited\s+from\b/i.test(body);
  if (!posted && /\byour\s+\S+\s+loan\b/i.test(text)) {
    return true;
  }
  return false;
}

export function isNonTransactionalEmail(subject: string, body: string, locale: LocalePack = defaultPack()): boolean {
  const header = subject.trim();
  if (header && locale.nonTransactionSubject.some((pattern) => pattern.test(header))) {
    return true;
  }
  return Boolean(body) && locale.nonTransactionBody.some((pattern) => pattern.test(body));
}

export function parseTransactionFromEmail(
  text: string,
  hint: ParseContext = {},
): SpotAlert | null {
  const locale = hint.locale ?? defaultPack();
  const clean = readableText(text);
  const subject = readableText(hint.subject ?? "");
  if (isNonTransactionalEmail(subject, clean, locale)) {
    return null;
  }
  if (!clean || locale.disclaimerNoise.test(clean)) {
    return null;
  }
  const direction = directionOf(clean, locale);
  if (!direction) {
    return null;
  }

  // The booked currency decides how the number is read, so detect it before
  // choosing an amount rather than after.
  const detection = detectCurrency({
    text: clean,
    senderAddress: hint.sender ?? null,
    institutionCountry: hint.institutionCountry ?? null,
    ownerCountry: hint.country ?? null,
    ownerDefaultCurrency: hint.defaultCurrency ?? null,
    accountCurrency: hint.accountCurrency ?? null,
  });

  const money = readMoney(
    clean,
    {
      text: clean,
      senderAddress: hint.sender ?? null,
      institutionCountry: hint.institutionCountry ?? null,
      ownerCountry: hint.country ?? null,
      ownerDefaultCurrency: hint.defaultCurrency ?? null,
      accountCurrency: hint.accountCurrency ?? null,
    },
    {
      excludeIndices: [...balanceSpans(clean, locale), ...structuralSpans(clean)],
      // The transaction amount sits near the moving verb. A balance or a
      // reference written later in the body must not win on text order alone.
      anchorIndex: direction.index,
    },
  );

  const amount = money?.booked.amount ?? null;
  if (!amount) {
    return null;
  }
  if (!locale.accountMovement.test(clean) && !(locale.vpaPattern && locale.vpaPattern.test(clean))) {
    return null;
  }
  if (isNoticeEmail(subject, clean)) {
    return null;
  }
  if (/\byou in accordance\b/i.test(clean) && !structuredMerchant(clean, locale)) {
    return null;
  }
  const counterparty = counterpartyOf(clean, direction.flow, locale);
  if (isBoilerplateCounterparty(counterparty, locale)) {
    return null;
  }
  const accountLast4 = clean.match(/(?:a\/c|acct|account|card)\s*(?:ending\s*(?:in\s*)?)?(?:no\.?)?\s*[*xX]*(\d{4})\b/i)?.[1];
  const paymentRef = clean.match(/\b(?:ref(?:erno)?|rrn|utr|txn\s*id)[:\s]*([0-9]{10,12}|[A-Za-z0-9]{12,16})\b/i)?.[1];
  const postedAt = postedAtFromText(clean, hint.timezone, locale) ?? hint.postedAt;

  const bookedCurrency = money?.booked.currency ?? detection;
  const stated = money?.stated ?? null;

  return {
    flow: direction.flow,
    amount,
    currency: bookedCurrency.code,
    currencyBasis: bookedCurrency.basis,
    currencyConfidence: bookedCurrency.confidence,
    ...(stated && stated.amount !== amount
      ? { statedAmount: stated.amount, statedCurrency: stated.currency.code }
      : {}),
    accountLast4,
    paymentRef,
    channel: channelOf(clean),
    counterparty,
    postedAt,
    rawExcerpt: clean.slice(0, 500),
  };
}

/** True when the alert should be surfaced for review rather than trusted silently. */
export function currencyNeedsReview(alert: Pick<SpotAlert, "currency" | "currencyBasis" | "currencyConfidence">): boolean {
  return needsReview({
    code: alert.currency,
    basis: alert.currencyBasis,
    confidence: alert.currencyConfidence,
    evidence: null,
  });
}

/**
 * Spans the text already claims as a balance, so the amount reader does not
 * mistake "Avl Bal INR 52,300.00" for the transaction.
 */
function balanceSpans(clean: string, locale: LocalePack): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const cue = new RegExp(locale.balanceCue.source, "gi");
  for (const match of clean.matchAll(cue)) {
    const start = match.index ?? 0;
    // The cue is followed by the figure it introduces, not by the whole sentence.
    spans.push([start, Math.min(clean.length, start + 40)]);
  }
  return spans;
}

/**
 * Spans that are structurally never a transaction amount: the account suffix in
 * "A/C ending 4321" and the date/time in "on 18-Oct-2026 10:45:12".
 */
function structuralSpans(clean: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];

  const account = /(?:a\/c|acct|account|card|konto|karte|compte|carte|cuenta|tarjeta|conta|cartão|cartao)\s*(?:ending\s*(?:in\s*)?|no\.?|endet\s+auf|se\s+terminant\s+par|terminad[oa]\s+en|terminado\s+em)?\s*[*xX]*\d{4}\b/gi;
  for (const match of clean.matchAll(account)) {
    spans.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }

  // Dates in the separators each market actually writes: 18-Oct-2026, 18.10.2026,
  // 18/10/2026. The trailing time is included so "10:45:12" is not read as money.
  const date = /\b\d{1,2}[/.-](?:[A-Za-zÀ-ÿ]{3,9}|\d{1,2})[/.-]\d{4}(?:[ ,T]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM|am|pm))?)?\b/g;
  for (const match of clean.matchAll(date)) {
    spans.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }

  return spans;
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

function directionOf(clean: string, locale: LocalePack): { flow: SpotAlert["flow"]; index: number } | null {
  const debit = locale.debitVerbs.exec(clean);
  const credit = locale.creditVerbs.exec(clean);
  if (!debit && !credit) {
    return null;
  }
  if (debit && (!credit || debit.index <= credit.index)) {
    return { flow: "DEBIT", index: debit.index };
  }
  return { flow: "CREDIT", index: credit!.index };
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

function counterpartyOf(clean: string, flow: SpotAlert["flow"], locale: LocalePack): string {
  const structured = structuredMerchant(clean, locale);
  if (structured) {
    return structured;
  }
  const named = namedCounterparty(clean, flow, locale);
  if (named) {
    return named;
  }
  const vpa = locale.vpaPattern ? clean.match(locale.vpaPattern)?.[1] : null;
  if (vpa) {
    return labelForVpa(vpa);
  }
  return flow === "CREDIT" ? "Bank Transfer" : "General Spend";
}

/** True when text is bank marketing / own-account phrasing, not a merchant. */
export function isBoilerplateCounterparty(text: string, locale: LocalePack = defaultPack()): boolean {
  const value = text.trim();
  if (value.length < 2) {
    return true;
  }
  if (locale.ownAccountPhrase.test(value)) {
    return true;
  }
  if (/^vpa\b/i.test(value) && !/\(/.test(value) && value.length < 12) {
    return true;
  }
  if (locale.weakMerchant.test(value) || value.length < 3) {
    return true;
  }
  return locale.boilerplate.some((pattern) => pattern.test(value));
}

/** HDFC-style "towards VPA x@y (Merchant)" / card "at APPLESERVICES". */
function structuredMerchant(clean: string, locale: LocalePack): string | null {
  if (/\bint\.?\s*pd\b/i.test(clean)) {
    return "Interest";
  }
  const imps = clean.match(/\bIMPS:\d+\/([A-Za-z][A-Za-z .']+?)(?=\s+Available|\s+For\b|$)/i);
  if (imps?.[1]) {
    const name = titleCase(imps[1]);
    if (name && !isBoilerplateCounterparty(name, locale)) {
      return name.slice(0, 120);
    }
  }
  const vpa = clean.match(vpaParenMerchant);
  if (vpa) {
    const name = cleanMerchantCandidate(vpa[1] ?? vpa[2] ?? vpa[3] ?? vpa[4] ?? "", locale);
    if (name && !isBoilerplateCounterparty(name, locale)) {
      return name.slice(0, 120);
    }
  }
  const at = clean.match(cardAtMerchant);
  if (at?.[1]) {
    const name = cleanMerchantCandidate(at[1], locale);
    if (name && !isBoilerplateCounterparty(name, locale)) {
      return name.slice(0, 120);
    }
  }
  return null;
}

function namedCounterparty(clean: string, flow: SpotAlert["flow"], locale: LocalePack): string | null {
  // Mint fresh global regexes: `lastIndex` survives between calls otherwise, and a
  // pack is cached for the life of the process.
  const source = flow === "CREDIT" ? locale.creditCounterpartyMark.source : locale.debitCounterpartyMark.source;
  const flags = flow === "CREDIT" ? locale.creditCounterpartyMark.flags : locale.debitCounterpartyMark.flags;
  const marks = [...clean.matchAll(new RegExp(source, flags))];
  // First match wins (near the txn clause). Last-match used to grab footer "to support you…".
  for (const mark of marks) {
    if (mark.index === undefined) {
      continue;
    }
    const rest = clean.slice(mark.index + mark[0].length);
    const trimmed = cleanMerchantCandidate(rest.split(locale.counterpartyStop)[0] ?? "", locale);
    if (!trimmed || isBoilerplateCounterparty(trimmed, locale)) {
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

function titleCase(text: string): string {
  return text.trim().replace(/\s+/g, " ").replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

function cleanMerchantCandidate(text: string, locale: LocalePack): string {
  // Mark regexes already consume "to merchant" / "to vpa" — do not strip a merchant name like "Merchant Cafe".
  let trimmed = text.replace(alertPrefix, "").trim();
  const paren = trimmed.match(/^\s*\(([^)]+)\)\s*$/);
  if (paren?.[1]) {
    trimmed = paren[1].trim();
  }
  trimmed = trimmed.replace(/^vpa\s+/i, "");
  if (locale.vpaPattern) {
    trimmed = trimmed.replace(locale.vpaPattern, "").trim();
  }
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

/**
 * Minutes east of UTC for a timezone, at a given instant. Uses `Intl`, so no
 * offset table is embedded and DST is handled for the date in the alert.
 */
function offsetMinutes(timezone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(at);
  const pick = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    pick("year"),
    pick("month") - 1,
    pick("day"),
    pick("hour") % 24,
    pick("minute"),
    pick("second"),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

function isoOffset(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

/** True when `timezone` is an IANA zone this runtime recognises. */
export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a timestamp out of an alert body.
 *
 * Alert bodies print wall-clock time in the *market's* zone with no offset, so
 * the owner timezone (or the pack's own default) supplies it. The result is
 * always an ISO string with an explicit offset, because the column is
 * `timestamptz`.
 */
export function postedAtFromText(clean: string, timezone?: string, locale: LocalePack = defaultPack()): string | undefined {
  const match = clean.match(/\b(\d{1,2})[/-]([A-Za-zÀ-ÿ]{3,9}|\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) {
    return undefined;
  }
  const month = monthOf(match[2] ?? "", locale);
  const day = Number(match[1]);
  const year = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");
  if (!month || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }

  // Build the naive stamp, then resolve the offset for that moment in the zone.
  // A first pass with UTC gives a close enough instant that the offset is right
  // for every zone except the DST transition hour itself.
  const naive = `${year}-${month}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}Z`;
  const asUtc = new Date(naive);
  if (Number.isNaN(asUtc.getTime())) {
    return undefined;
  }
  const requested = (timezone ?? "").trim() || locale.defaultTimezone;
  const zone = isValidTimeZone(requested) ? requested : "UTC";
  // The alert prints wall-clock time in `zone`, so the instant it denotes is the
  // naive stamp minus that zone's offset. Confirm the offset against the true
  // instant so a DST transition hour does not shift the reading.
  const offset = offsetMinutes(zone, asUtc);
  const instant = new Date(asUtc.getTime() - offset * 60000);
  const confirmed = offsetMinutes(zone, instant);
  // The written clock time is `naive`; only the offset is new information.
  const stamp = `${naive.slice(0, 19)}${isoOffset(confirmed)}`;
  return Number.isNaN(new Date(stamp).getTime()) ? undefined : stamp;
}

function monthOf(token: string, locale: LocalePack): string | null {
  if (/^\d{1,2}$/.test(token)) {
    const month = Number(token);
    return month >= 1 && month <= 12 ? String(month).padStart(2, "0") : null;
  }
  // Match the longest available prefix of the written month so "März" and "mär"
  // both resolve, and "Sept" does not beat "Sep".
  const written = token.slice(0, 4).toLowerCase();
  return locale.months[written] ?? locale.months[written.slice(0, 3)] ?? null;
}
