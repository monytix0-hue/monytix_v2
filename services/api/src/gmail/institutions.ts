/**
 * Statement-sender -> institution resolution.
 *
 * `ref.institution` is the authoritative table; this module mirrors the part of
 * it the parser needs (matching tokens, ISO country, narration overlay), because
 * alert polling is unit-tested against injected ports and must not open a
 * connection per message.
 *
 * Keep the two in step with `database/migrations/0059_global_taxonomy.sql`.
 *
 * Two things come out of a match:
 *   - `countryCode` feeds the `$` resolution order in `money/detect.ts`, so a
 *     Chase alert reads as USD and a Barclays alert reads as GBP.
 *   - `statementBank` names the narration overlay that has patterns for this
 *     bank. Only HDFC, ICICI, SBI and AXIS do; every other institution gets
 *     `null`, which means "no overlay" rather than "unknown bank".
 */

/** Banks with a hand-written narration overlay in `spendsense.overlay_bank_narration`. */
export type StatementBank = "HDFC" | "ICICI" | "SBI" | "AXIS";

export type Institution = {
  /** `ref.institution.institution_code`. */
  code: string;
  displayName: string;
  /** ISO 3166-1 alpha-2, matching `ref.institution.country_code`. */
  countryCode: string;
  /** Lower-cased domain labels that identify the sender, e.g. `chase.com`. */
  domains: string[];
  /** Lower-cased filename/address tokens, e.g. `hdfc`, `hdfcbank`. */
  tokens: string[];
  statementBank: StatementBank | null;
};

/**
 * Every institution the parser recognises, Indian banks first so the existing
 * mailbox keeps its current answer.
 */
export const institutions: readonly Institution[] = [
  {
    code: "HDFC",
    displayName: "HDFC Bank",
    countryCode: "IN",
    domains: ["hdfcbank.com", "hdfcbank.net", "hdfc.com"],
    tokens: ["hdfc", "hdfcbank", "hdfcbanknet"],
    statementBank: "HDFC",
  },
  {
    code: "ICICI",
    displayName: "ICICI Bank",
    countryCode: "IN",
    domains: ["icicibank.com", "icicibank.co.in"],
    tokens: ["icici", "icicibank"],
    statementBank: "ICICI",
  },
  {
    code: "SBI",
    displayName: "State Bank of India",
    countryCode: "IN",
    domains: ["sbi.co.in", "onlinesbi.com", "sbi.com"],
    tokens: ["sbi", "sbin", "onlinesbi", "statebankofindia"],
    statementBank: "SBI",
  },
  {
    code: "AXIS",
    displayName: "Axis Bank",
    countryCode: "IN",
    domains: ["axisbank.com", "axisbank.co.in"],
    tokens: ["axis", "axisbank", "utib"],
    statementBank: "AXIS",
  },
  {
    code: "KOTAK",
    displayName: "Kotak Mahindra Bank",
    countryCode: "IN",
    domains: ["kotak.com"],
    tokens: ["kotak", "kotakbank"],
    statementBank: null,
  },
  {
    code: "FEDERAL",
    displayName: "Federal Bank",
    countryCode: "IN",
    domains: ["federalbank.co.in"],
    tokens: ["federal", "federalbank"],
    statementBank: null,
  },
  {
    code: "CANARA",
    displayName: "Canara Bank",
    countryCode: "IN",
    domains: ["canarabank.com"],
    tokens: ["canara", "canarabank"],
    statementBank: null,
  },
  {
    code: "CHASE",
    displayName: "JPMorgan Chase",
    countryCode: "US",
    domains: ["chase.com", "email.chase.com", "alertsp.chase.com", "jpmorgan.com"],
    tokens: ["chase", "jpmorgan", "jpmorganchase"],
    statementBank: null,
  },
  {
    code: "BANK_OF_AMERICA",
    displayName: "Bank of America",
    countryCode: "US",
    domains: ["bankofamerica.com", "ealerts.bankofamerica.com"],
    tokens: ["bankofamerica", "bofa"],
    statementBank: null,
  },
  {
    code: "WELLS_FARGO",
    displayName: "Wells Fargo",
    countryCode: "US",
    domains: ["wellsfargo.com", "alerts.wellsfargo.com"],
    tokens: ["wellsfargo"],
    statementBank: null,
  },
  {
    code: "CITI",
    displayName: "Citibank",
    countryCode: "US",
    domains: ["citibank.com", "citi.com"],
    tokens: ["citi", "citibank"],
    statementBank: null,
  },
  {
    code: "CAPITAL_ONE",
    displayName: "Capital One",
    countryCode: "US",
    domains: ["capitalone.com", "notification.capitalone.com"],
    tokens: ["capitalone"],
    statementBank: null,
  },
  {
    code: "BARCLAYS",
    displayName: "Barclays",
    countryCode: "GB",
    domains: ["barclays.co.uk", "barclays.com"],
    tokens: ["barclays"],
    statementBank: null,
  },
  {
    code: "HSBC",
    displayName: "HSBC",
    countryCode: "GB",
    domains: ["hsbc.co.uk", "hsbc.com", "mail.hsbc.co.uk"],
    tokens: ["hsbc"],
    statementBank: null,
  },
  {
    code: "LLOYDS",
    displayName: "Lloyds Bank",
    countryCode: "GB",
    domains: ["lloydsbank.com", "lloydsbank.co.uk"],
    tokens: ["lloyds", "lloydsbank"],
    statementBank: null,
  },
  {
    code: "NATWEST",
    displayName: "NatWest",
    countryCode: "GB",
    domains: ["natwest.com", "natwest.co.uk"],
    tokens: ["natwest"],
    statementBank: null,
  },
  {
    code: "MONZO",
    displayName: "Monzo",
    countryCode: "GB",
    domains: ["monzo.com", "monzomail.com"],
    tokens: ["monzo"],
    statementBank: null,
  },
  {
    code: "REVOLUT",
    displayName: "Revolut",
    countryCode: "GB",
    domains: ["revolut.com", "revolutmail.com"],
    tokens: ["revolut"],
    statementBank: null,
  },
  {
    code: "STARLING",
    displayName: "Starling Bank",
    countryCode: "GB",
    domains: ["starlingbank.com"],
    tokens: ["starling", "starlingbank"],
    statementBank: null,
  },
  {
    code: "DEUTSCHE_BANK",
    displayName: "Deutsche Bank",
    countryCode: "DE",
    domains: ["deutsche-bank.de", "db.com"],
    tokens: ["deutschebank", "deutsche"],
    statementBank: null,
  },
  {
    code: "COMMERZBANK",
    displayName: "Commerzbank",
    countryCode: "DE",
    domains: ["commerzbank.de"],
    tokens: ["commerzbank"],
    statementBank: null,
  },
  {
    code: "N26",
    displayName: "N26",
    countryCode: "DE",
    domains: ["n26.com"],
    tokens: ["n26"],
    statementBank: null,
  },
  {
    code: "BNP_PARIBAS",
    displayName: "BNP Paribas",
    countryCode: "FR",
    domains: ["bnpparibas.fr", "bnpparibas.com"],
    tokens: ["bnpparibas", "bnp"],
    statementBank: null,
  },
  {
    code: "SOCIETE_GENERALE",
    displayName: "Société Générale",
    countryCode: "FR",
    domains: ["societegenerale.fr"],
    tokens: ["societegenerale", "socgen"],
    statementBank: null,
  },
  {
    code: "SANTANDER",
    displayName: "Santander",
    countryCode: "ES",
    domains: ["santander.es", "santander.com"],
    tokens: ["santander"],
    statementBank: null,
  },
  {
    code: "BBVA",
    displayName: "BBVA",
    countryCode: "ES",
    domains: ["bbva.es", "bbva.com"],
    tokens: ["bbva"],
    statementBank: null,
  },
  {
    code: "ITAU",
    displayName: "Itaú Unibanco",
    countryCode: "BR",
    domains: ["itau.com.br"],
    tokens: ["itau"],
    statementBank: null,
  },
  {
    code: "NUBANK",
    displayName: "Nubank",
    countryCode: "BR",
    domains: ["nubank.com.br"],
    tokens: ["nubank"],
    statementBank: null,
  },
  {
    code: "EMIRATES_NBD",
    displayName: "Emirates NBD",
    countryCode: "AE",
    domains: ["emiratesnbd.com"],
    tokens: ["emiratesnbd"],
    statementBank: null,
  },
  {
    code: "DBS",
    displayName: "DBS Bank",
    countryCode: "SG",
    domains: ["dbs.com.sg", "dbs.com"],
    tokens: ["dbs"],
    statementBank: null,
  },
  {
    code: "CBA",
    displayName: "Commonwealth Bank of Australia",
    countryCode: "AU",
    domains: ["commbank.com.au"],
    tokens: ["commbank", "commonwealthbank"],
    statementBank: null,
  },
  {
    code: "RBC",
    displayName: "Royal Bank of Canada",
    countryCode: "CA",
    domains: ["rbc.com", "rbcroyalbank.com"],
    tokens: ["rbc", "rbcroyalbank"],
    statementBank: null,
  },
] as const;

/** Banks whose narration overlay exists, in the order the overlay tries them. */
export const statementBanks: StatementBank[] = ["HDFC", "ICICI", "SBI", "AXIS"];

const byToken = new Map<string, Institution>();
const byDomain = new Map<string, Institution>();
for (const institution of institutions) {
  for (const token of institution.tokens) {
    // First writer wins, so the Indian banks above keep their claims.
    if (!byToken.has(token)) byToken.set(token, institution);
  }
  for (const domain of institution.domains) {
    if (!byDomain.has(domain)) byDomain.set(domain, institution);
  }
}

export type InstitutionMatch = {
  code: string;
  displayName: string;
  countryCode: string;
  /** The narration overlay to use, or null when this bank has none. */
  statementBank: StatementBank | null;
  /** How the match was made, for logging and for the review row. */
  basis: "sender-domain" | "token";
};

function wholeTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0));
}

function domainOf(address: string): string | null {
  const at = address.trim().lastIndexOf("@");
  if (at < 0) return null;
  const domain = address.slice(at + 1).replace(/[>,;\s].*$/, "").toLowerCase();
  return domain.includes(".") ? domain : null;
}

/** The sender domain is the strongest signal: `no-reply@alertsp.chase.com`. */
function matchDomain(fromAddress: string): InstitutionMatch | null {
  const domain = domainOf(fromAddress);
  if (!domain) return null;
  for (const candidate of [domain, domain.split(".").slice(-3).join("."), domain.split(".").slice(-2).join(".")]) {
    const institution = byDomain.get(candidate);
    if (institution) {
      return {
        code: institution.code,
        displayName: institution.displayName,
        countryCode: institution.countryCode,
        statementBank: institution.statementBank,
        basis: "sender-domain",
      };
    }
  }
  return null;
}

/**
 * Resolve the institution that sent a statement or alert.
 *
 * A filename token is a weaker signal than the sender domain, so the domain is
 * tried first. A statement named `eStatement.pdf` from an unrecognised mailbox
 * therefore resolves to nothing rather than to whichever bank happens to own a
 * generic token.
 */
export function identifyInstitution(filename: string, fromAddress: string): InstitutionMatch | null {
  const domain = matchDomain(fromAddress);
  if (domain) return domain;

  const tokens = wholeTokens(`${filename} ${fromAddress}`);
  const found = new Map<string, Institution>();
  for (const token of tokens) {
    const institution = byToken.get(token);
    if (institution) found.set(institution.code, institution);
  }
  // More than one institution means the evidence is not decisive.
  if (found.size !== 1) return null;
  const [institution] = [...found.values()];
  return {
    code: institution.code,
    displayName: institution.displayName,
    countryCode: institution.countryCode,
    statementBank: institution.statementBank,
    basis: "token",
  };
}

/**
 * The narration overlay for a sender, or null.
 *
 * Kept as the narrow `StatementBank` union because the overlay only exists for
 * four Indian banks; a Chase statement gets null and is parsed generically
 * rather than being forced through HDFC's regexes.
 */
export function identifyBank(filename: string, fromAddress: string): StatementBank | null {
  return identifyInstitution(filename, fromAddress)?.statementBank ?? null;
}

/** ISO country for a sender, for the `$` resolution order. */
export function senderCountry(fromAddress: string): string | null {
  return identifyInstitution("", fromAddress)?.countryCode ?? null;
}
