import type { StatementBank } from "../gmail/pipeline.js";

const bankOrder: StatementBank[] = ["HDFC", "ICICI", "SBI", "AXIS"];
const legalWords = new Set(["PVT", "LTD", "LIMITED", "LLP", "INC"]);
const gatewayWords = new Set(["PAYU", "RAZORPAY", "BILLDESK", "CCAVENUE", "CASHFREE"]);
const cityWords = new Set([
  "MUMBAI", "BANGALORE", "BENGALURU", "DELHI", "CHENNAI", "HYDERABAD", "PUNE",
  "KOLKATA", "BLR", "GURGAON", "NOIDA", "AHMEDABAD", "JAIPUR", "KOCHI", "INDORE",
]);

export type NarrationHit = {
  channel_type: string;
  sub_type: string | null;
  reference: string | null;
  counterparty: string | null;
  cleaned_counterparty: string | null;
  category_code: string | null;
};

type Pattern = {
  bank: StatementBank;
  channel: string;
  subtype?: string | null;
  expression: RegExp;
  reference?: number;
  counterparty?: number;
  dropTrailingCity?: boolean;
};

const patterns: Pattern[] = [
  { bank: "HDFC", channel: "UPI", expression: /^UPI-([A-Z0-9 .&]+)-([A-Z0-9.]+@[A-Z0-9.]+)-[A-Z0-9]+-(\d{12})-/, reference: 3, counterparty: 1 },
  { bank: "HDFC", channel: "UPI", expression: /^UPI-(\d{12})-(.+?)-HDFCBANK-/, reference: 1, counterparty: 2 },
  { bank: "HDFC", channel: "IMPS", expression: /^IMPS-P2A-(\d+)-(.+?)-HDFC$/, reference: 1, counterparty: 2 },
  { bank: "HDFC", channel: "NEFT", expression: /^NEFT CR-[A-Z0-9]+-(.+)-([A-Z0-9]+)$/, reference: 2, counterparty: 1 },
  { bank: "HDFC", channel: "POS", subtype: "POS", expression: /^POS\s+\d+X+\d+\s+(.+)$/, counterparty: 1, dropTrailingCity: true },
  { bank: "HDFC", channel: "POS", subtype: "CARD_ECOMMERCE", expression: /ECOM.*\d+X+\d+|\d+X+\d+.*ECOM/ },
  { bank: "HDFC", channel: "ATM", expression: /^NWD-(ATM\d+)-/, reference: 1 },
  { bank: "HDFC", channel: "ACH", expression: /^ACH D-\s*[A-Z0-9]+-\s*(.+)$/, counterparty: 1 },
  { bank: "ICICI", channel: "UPI", expression: /^\/UPI\/(\d+)\/([^/]+)\//, reference: 1, counterparty: 2 },
  { bank: "ICICI", channel: "IMPS", expression: /MMID\/IMPS\/(\d+)\/([^/]+)/, reference: 1, counterparty: 2 },
  { bank: "ICICI", channel: "NEFT", expression: /INF\/NEFT\/([^/]+)\/([^/]+)\//, reference: 1, counterparty: 2 },
  { bank: "ICICI", channel: "RTGS", expression: /INF\/RTGS\/([^/]+)\/([^/]+)\//, reference: 1, counterparty: 2 },
  { bank: "ICICI", channel: "POS", subtype: "POS", expression: /^VPS\/([^/]+)\//, counterparty: 1 },
  { bank: "ICICI", channel: "ATM", expression: /^NFS\/CASH WDL\/([^/]+)\//, reference: 1 },
  { bank: "ICICI", channel: "NACH", expression: /CMS\/NACH\/([^/]*)/, counterparty: 1 },
  { bank: "SBI", channel: "UPI", expression: /TRANSFER-UPI\/DR\/(\d+)\/[^/]+\/([^/]+)/, reference: 1, counterparty: 2 },
  { bank: "SBI", channel: "IMPS", expression: /TRANSFER-INB IMPS(\d+)\/([^/]+)\//, reference: 1, counterparty: 2 },
  { bank: "SBI", channel: "ATM", expression: /ATM WDL ATM ([A-Z0-9]+)/, reference: 1 },
  { bank: "SBI", channel: "POS", subtype: "POS", expression: /POS DEBIT-?(.*)$/, counterparty: 1 },
  { bank: "SBI", channel: "NEFT", expression: /NEFT\/([A-Z0-9]{16})(?:\/([^/]+))?/, reference: 1, counterparty: 2 },
  { bank: "AXIS", channel: "UPI", expression: /^UPI\/(\d+)\/([^/]+)\//, reference: 1, counterparty: 2 },
  { bank: "AXIS", channel: "IMPS", expression: /^IMPS\/P2A\/(\d+)\/([^/]+)\//, reference: 1, counterparty: 2 },
  { bank: "AXIS", channel: "POS", subtype: "CARD_ECOMMERCE", expression: /^ECOM PUR\/([^/]+)\//, counterparty: 1 },
  { bank: "AXIS", channel: "POS", subtype: "POS", expression: /^(?:POS PUR|EDC)\/([^/]*)/, counterparty: 1 },
  { bank: "AXIS", channel: "NEFT", expression: /NEFT[-\s]?(?:AX)?([A-Z0-9]{16})[-\s/]+(.+)$/, reference: 1, counterparty: 2 },
];

export function readNarration(description: string, bank?: StatementBank | null): NarrationHit | null {
  const source = description.replace(/\s+/g, " ").trim();
  const banks = bank ? [bank] : bankOrder;
  for (const pattern of patterns) {
    if (!banks.includes(pattern.bank)) {
      continue;
    }
    const match = source.match(new RegExp(pattern.expression.source, "i"));
    if (!match) {
      continue;
    }
    return finish(pattern.channel, pattern.subtype ?? null, group(match, pattern.reference), party(match, pattern));
  }
  return genericRail(source.toUpperCase());
}

export function cleanCounterparty(value: string): string {
  const local = value.includes("@") ? value.slice(0, value.indexOf("@")) : value;
  return local
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length > 0 && !legalWords.has(token) && !gatewayWords.has(token) && !cityWords.has(token))
    .join(" ");
}

export function categoryForMerchant(cleaned: string): string | null {
  const tokens = new Set(cleaned.split(" ").filter((token) => token.length > 0));
  const has = (...words: string[]) => words.some((word) => tokens.has(word) || [...tokens].some((token) => token.startsWith(word)));
  if (has("SWIGGY", "BUNDL", "INSTAMART", "ZOMATO", "BLINKIT", "STARBUCKS", "MCDONALD")) {
    return "FOOD_DINING";
  }
  if (has("UBER", "OLA", "FUEL", "PETROL", "HPCL", "BPCL", "IOCL")) {
    return "MOBILITY_TRANSPORT";
  }
  if (has("IRCTC")) {
    return "TRAVEL";
  }
  if (has("JIO", "AIRTEL")) {
    return "UTILITIES_COMMUNICATION";
  }
  if (has("AMAZON")) {
    return "SHOPPING_RETAIL";
  }
  if (has("NETFLIX")) {
    return "ENTERTAINMENT_MEDIA";
  }
  if (has("HOSPITAL", "PHARMACY", "APOLLO", "NETMEDS", "PHARMEASY")) {
    return "HEALTH_MEDICAL";
  }
  return null;
}

export function overlayParsedNarration(
  description: string,
  parsed: Record<string, unknown>,
  bank?: StatementBank | null,
): Record<string, unknown> {
  const hit = readNarration(description, bank);
  if (!hit) {
    return parsed;
  }
  const fields = fieldsOf(parsed);
  if (hit.counterparty) {
    fields.counterparty_name = hit.counterparty;
  }
  if (hit.cleaned_counterparty) {
    fields.cleaned_counterparty = hit.cleaned_counterparty;
  }
  if (hit.reference && hit.channel_type === "UPI") {
    fields.upi_rrn = hit.reference;
  }
  if (hit.reference) {
    fields.payment_reference = hit.reference;
  }
  if (hit.category_code) {
    fields.category_code = hit.category_code;
  }
  return {
    ...parsed,
    channel_type: hit.channel_type,
    sub_type: hit.sub_type ?? parsed.sub_type ?? null,
    fields,
  };
}

function finish(channel: string, subtype: string | null, reference: string | null, counterparty: string | null): NarrationHit {
  const partyName = blank(counterparty);
  const cleaned = partyName ? cleanCounterparty(partyName) : null;
  return {
    channel_type: channel,
    sub_type: subtype,
    reference: blank(reference),
    counterparty: partyName,
    cleaned_counterparty: cleaned && cleaned.length > 0 ? cleaned : null,
    category_code: cleaned ? categoryForMerchant(cleaned) : null,
  };
}

function genericRail(normal: string): NarrationHit | null {
  if (normal.startsWith("RTGS")) {
    return finish("RTGS", null, null, null);
  }
  if (/\bECOM\b/.test(normal) || normal.includes("WWW.")) {
    return finish("POS", "CARD_ECOMMERCE", null, null);
  }
  if (normal.startsWith("NFS") || normal.includes("ATM-WDL")) {
    return finish("ATM", null, null, null);
  }
  if (normal.includes("ECS/")) {
    return finish("ACH", null, null, null);
  }
  if (!normal.includes("INET-IMPS") && /\bNET[-\s]?BANKING\b|\bNETBANKING\b/.test(normal)) {
    return finish("NET_BANKING", null, null, null);
  }
  return null;
}

function group(match: RegExpMatchArray, index: number | undefined): string | null {
  if (!index) {
    return null;
  }
  return match[index] ?? null;
}

function party(match: RegExpMatchArray, pattern: Pattern): string | null {
  const value = group(match, pattern.counterparty);
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (pattern.dropTrailingCity) {
    const tokens = trimmed.split(/\s+/);
    if (tokens.length > 1 && cityWords.has((tokens[tokens.length - 1] ?? "").toUpperCase())) {
      tokens.pop();
    }
    return tokens.join(" ");
  }
  return trimmed;
}

function blank(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || /\dX{2,}\d/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function fieldsOf(parsed: Record<string, unknown>): Record<string, unknown> {
  const fields = parsed.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return {};
  }
  return { ...fields };
}
