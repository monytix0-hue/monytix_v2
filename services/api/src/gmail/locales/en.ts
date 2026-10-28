/**
 * A locale pack is the vocabulary an alert uses, not a translation layer.
 *
 * Every pattern here is a *shape* that appears in real bank mail for a market.
 * Adding a market means adding a pack, never widening a global regex, because a
 * loosened verb pattern starts matching marketing copy in another language and
 * the failure is silent: a newsletter becomes a debit.
 *
 * The Indian rails (UPI, IMPS, NEFT, RTGS, VPA) live in `en-IN`, so a mailbox that
 * worked before this change keeps resolving to the same pack.
 */

export type LocalePack = {
  /** Stable identifier, e.g. `en-IN`. Stored on evidence rows so a reparse is reproducible. */
  code: string;
  /** ISO 639-1 language, used to pick a pack when only the language is known. */
  language: string;
  /** Market this pack was written for. `null` means "language-general". */
  country: string | null;

  months: Record<string, string>;

  debitVerbs: RegExp;
  creditVerbs: RegExp;
  /** A real account movement, not a newsletter using the word "credited". */
  accountMovement: RegExp;
  balanceCue: RegExp;
  disclaimerNoise: RegExp;
  nonTransactionSubject: RegExp[];
  nonTransactionBody: RegExp[];

  /** Phrases that must never become a merchant title. */
  boilerplate: RegExp[];
  counterpartyStop: RegExp;
  /** These carry the `g` flag, so every pack must mint its own instances. */
  debitCounterpartyMark: RegExp;
  creditCounterpartyMark: RegExp;
  weakMerchant: RegExp;
  ownAccountPhrase: RegExp;

  /** `x@handle` shapes. Only markets that write them into alerts set this. */
  vpaPattern: RegExp | null;

  /**
   * The market's own IANA zone. Alert bodies print wall-clock time with no
   * offset, so this is the fallback when the owner has no timezone of their own.
   */
  defaultTimezone: string;

  /** Gmail search verbs for this locale. Kept short: Gmail rejects long queries. */
  searchTerms: string[];
};

/** Month abbreviations shared by the Latin-script packs. */
export const latinMonths: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Counterparty marks and other global-flag regexes must be per-pack instances. */
const marks = (): { debit: RegExp; credit: RegExp } => ({
  // Prefer "towards" / "paid to" before bare "to". Do not use "to merchant".
  debit: /\b(?:towards|paid\s+to|sent\s+to|to|at|with)\s+/gi,
  credit: /\b(?:transferred\s+from|received\s+from|credited\s+by|from)\s+/gi,
});

/** Alert vocabulary common to English-language markets. */
export function createEnglishPack(): LocalePack {
  const { debit, credit } = marks();
  return {
    code: "en",
    language: "en",
    country: null,
    months: latinMonths,

    debitVerbs: /\b(debited|spent|paid|sent to|withdrawn|purchase of|txn of|charged|payment of)\b/i,
    creditVerbs: /\b(credited(?:\s+by|\s+to)?|received(?:\s+from)?|deposited|refund(?:ed)?(?:\s+of)?|inward\s+(?:transfer|payment))\b/i,
    accountMovement:
      /\b(?:is|was|been|has been)\s+(?:debited|credited|charged)\b|\b(?:debited|credited|charged)\s+(?:from|to)\s+your\b|\b(?:debited|credited|charged)\s+from\s+(?:your\s+)?(?:a\/c|acct|account|card)\b|\b(?:a\/c|acct|account|card)\s+ending\b|\b(?:transaction|payment|purchase)\s+(?:at|to|from)\b/i,
    balanceCue: /\b(?:avail(?:able)?|avl)\s*bal|\bbalance\b|\bbal\b/i,
    disclaimerNoise: /\b(?:unauthori[sz]ed\b.*\bfraudulent|\bfraudulent\b.*\bunauthori[sz]ed|statutory\s+warning)\b/i,
    nonTransactionSubject: [
      /\b(?:otp|one[- ]time password|verification code|secret code)\b/i,
      /\b(?:logged in|login alert|password reset|m-?pin|access alert)\b/i,
      /\b(?:e-statement|account statement|monthly statement)\b/i,
      /\b(?:re-?kyc|kyc|mandate created|standing instruction registered)\b/i,
      /\b(?:card dispatched|cheque book)\b/i,
      /\b(?:special offer|pre-approved|loan offer)\b/i,
    ],
    nonTransactionBody: [
      /is your (?:one[- ]time password|otp|secret code)/i,
      /use code \d{4,8} to/i,
      /successfully logged in/i,
      /\bcredit score is\b/i,
    ],
    boilerplate: [
      /\baccount\s+ending\s+in\s+\d+/i,
      /unauthori[sz]ed\s+and\s+fraudule/i,
      /never\s+share\s+(?:your\s+)?(?:otp|pin)/i,
      /thank you for banking/i,
      /warm regards/i,
      /customer care/i,
      /terms and conditions/i,
      /all rights reserved/i,
      /we are here to help/i,
      /unsubscribe/i,
      /^this is an automated/i,
      /^please do not reply/i,
    ],
    counterpartyStop: /\b(?:on|via|ref|utr|rrn|avail|for|a\/c|to|at|from|towards|total|ending|with|umrn)\b|[.]/i,
    debitCounterpartyMark: debit,
    creditCounterpartyMark: credit,
    weakMerchant: /^(?:time|times|all|home|us|it|this|that|the|here|there|now|today|tomorrow)$/i,
    ownAccountPhrase: /^(?:your\s+)?(?:[\w&.\s-]+?\s+)?(?:bank\s+)?(?:a\/c|acct|account|card)(?:\s+ending(?:\s+in)?\s+\d{4})?$/i,
    vpaPattern: null,
    defaultTimezone: "UTC",
    searchTerms: ["debited", "credited", "spent", "paid", "payment", "transaction alert", "purchase"],
  };
}

/**
 * Indian market vocabulary. This is the pack that must not regress: the rail
 * grammar, the VPA shape and the bank-footer blacklist are carried over verbatim
 * from the pre-currency `alertParser`.
 */
export function createEnglishIndiaPack(): LocalePack {
  const base = createEnglishPack();
  return {
    ...base,
    code: "en-IN",
    country: "IN",

    nonTransactionBody: [
      /is your (?:one[- ]time password|otp|secret code)/i,
      /use code \d{4,8} to/i,
      /successfully logged in/i,
      /your cibil score is/i,
    ],

    // The Indian rail nouns are credits on their own: "Inward NEFT from X" is a
    // credit even though the verb "credited" never appears.
    creditVerbs:
      /\b(?:credited(?:\s+by|\s+to)?|received(?:\s+from)?|deposited|refund(?:ed)?(?:\s+of)?|inward\s+(?:neft|imps|rtgs|remittance|transfer)|credit\s+received)\b/i,

    accountMovement:
      /\b(?:is|was|been)\s+(?:debited|credited)\b|\b(?:debited|credited)\s+(?:from|to)\s+your\b|\b(?:debited|credited)\s+from\s+(?:your\s+)?(?:a\/c|acct|account|card)\b|\btowards\s+VPA\b|\b(?:a\/c|acct|account|card)\s+ending\b/i,

    boilerplate: [
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
      /\byou in accordance\b/i,
      /\(\s*toll free\s*\)/i,
      /\byour account\s+\S+\s+is credited\b/i,
    ],

    vpaPattern: /\b([A-Za-z0-9][A-Za-z0-9._-]{0,40}@[A-Za-z0-9][A-Za-z0-9.-]{1,40})\b/,

    // Indian bank mail has always been read as IST. Keeping that here means an
    // owner who has not set a timezone parses exactly as before.
    defaultTimezone: "Asia/Kolkata",

    searchTerms: [
      "debited", "credited", "spent", "sent", "received", "paid", "transaction alert",
      "UPI", "IMPS", "NEFT",
    ],
  };
}
