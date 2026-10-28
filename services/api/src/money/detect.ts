import {
  countryCurrency,
  dollarCountries,
  dollarPrefixes,
  knownCurrencyCodes,
  minorUnitsFor,
  rupeeFamily,
  senderTldCountries,
  unambiguousSymbols,
} from "./symbols.js";
import { findAmounts, hasSymbol, hasWordUnit, isMonetaryHit, normalizeDigits, prefixCode, suffixCode, type AmountHit } from "./parse.js";

/**
 * Why we believe a currency. Stored on the spot so the review row can explain
 * itself and so the promote step never has to re-derive the decision.
 */
export type CurrencyBasis =
  | "EXPLICIT_ISO"
  | "UNAMBIGUOUS_SYMBOL"
  | "PREFIXED_DOLLAR"
  | "TLD_OR_COUNTRY"
  | "OWNER_DEFAULT"
  | "ACCOUNT_DEFAULT";

export type CurrencyDetection = {
  code: string;
  confidence: number;
  basis: CurrencyBasis;
  /** The literal fragment that decided it, for the review row. */
  evidence: string | null;
};

export type DetectContext = {
  /** Free text: the whole alert body, or the window around one amount. */
  text: string;
  /** Sender mailbox, e.g. `alerts@hdfcbank.co.in`. */
  senderAddress?: string | null;
  /** `ref.institution.country_code` for the sender, when already resolved. */
  institutionCountry?: string | null;
  /** `core.owner.metadata->>'country_code'`. */
  ownerCountry?: string | null;
  /** `core.owner.default_currency_code`. Every branch terminates here. */
  ownerDefaultCurrency?: string | null;
  /** `core.financial_account.base_currency_code`, when the account is known. */
  accountCurrency?: string | null;
};

/**
 * A currency with strong evidence is safe to post. Below `reviewThreshold` the
 * spot still saves, but the ledger shows a "Currency uncertain — review" row
 * instead of silently booking to the owner default.
 */
export const reviewThreshold = 0.6;

const basisRank: Record<CurrencyBasis, number> = {
  EXPLICIT_ISO: 5,
  UNAMBIGUOUS_SYMBOL: 4,
  PREFIXED_DOLLAR: 3,
  ACCOUNT_DEFAULT: 2,
  TLD_OR_COUNTRY: 1,
  OWNER_DEFAULT: 0,
};

/** Pick the stronger of two detections. Ties keep the first. */
export function stronger(
  left: CurrencyDetection | null,
  right: CurrencyDetection | null,
): CurrencyDetection | null {
  if (!left) return right;
  if (!right) return left;
  if (basisRank[right.basis] > basisRank[left.basis]) return right;
  if (basisRank[right.basis] < basisRank[left.basis]) return left;
  return right.confidence > left.confidence ? right : left;
}

/** Country from a sender domain. `alerts@hdfcbank.co.in` -> `IN`. */
export function countryFromSender(senderAddress: string | null | undefined): string | null {
  const address = (senderAddress ?? "").trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const domain = address.slice(at + 1).replace(/[>,;\s].*$/, "");
  if (!domain.includes(".")) return null;

  const labels = domain.split(".").filter(Boolean);
  // Try the two-label suffix first so `.co.in` beats a bare `in`.
  if (labels.length >= 2) {
    const two = labels.slice(-2).join(".");
    const country = senderTldCountries[two];
    if (country) return country;
  }
  const one = labels[labels.length - 1] ?? "";
  return senderTldCountries[one] ?? null;
}

/** The best country signal we have, in the plan's resolution order. */
function countrySignal(ctx: DetectContext): { country: string; source: string } | null {
  const institution = (ctx.institutionCountry ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(institution)) {
    return { country: institution, source: `institution:${institution}` };
  }
  const fromSender = countryFromSender(ctx.senderAddress);
  if (fromSender) {
    return { country: fromSender, source: `sender-tld:${fromSender}` };
  }
  const owner = (ctx.ownerCountry ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(owner)) {
    return { country: owner, source: `owner-country:${owner}` };
  }
  return null;
}

function defaultDetection(ctx: DetectContext): CurrencyDetection {
  const ownerDefault = (ctx.ownerDefaultCurrency ?? "").trim().toUpperCase();
  if (knownCurrencyCodes.has(ownerDefault)) {
    return {
      code: ownerDefault,
      confidence: 0.3,
      basis: "OWNER_DEFAULT",
      evidence: `owner default ${ownerDefault}`,
    };
  }
  const account = (ctx.accountCurrency ?? "").trim().toUpperCase();
  if (knownCurrencyCodes.has(account)) {
    return {
      code: account,
      confidence: 0.5,
      basis: "ACCOUNT_DEFAULT",
      evidence: `account currency ${account}`,
    };
  }
  return { code: "INR", confidence: 0.1, basis: "OWNER_DEFAULT", evidence: "fallback" };
}

const isoTokenPattern = new RegExp(String.raw`(?<![A-Za-z0-9])([A-Z]{3})(?![A-Za-z0-9])`, "g");

/**
 * The first whole-token ISO code in `text` that is actually a currency.
 *
 * Membership in the curated set does the filtering, so `THE`, `VPA`, `ATM` and
 * the real-but-wordlike `ALL`/`TOP`/`PEN` never match. Codes immediately followed
 * by another uppercase word (`USD CARD`) are still accepted, since `CARD` is not
 * a currency and the pair is a normal convention.
 */
function findIsoCode(text: string): { code: string; index: number } | null {
  const upper = normalizeDigits(text).toUpperCase();
  for (const match of upper.matchAll(isoTokenPattern)) {
    const code = match[1] ?? "";
    if (!knownCurrencyCodes.has(code)) continue;
    // `ALL` after "FOR" is a word. Require either a numeric neighbour or a
    // conventional adjacency (a symbol, or another currency-ish token).
    if (code === "ALL" || code === "TOP" || code === "PEN" || code === "MAD" || code === "TRY") {
      const around = upper.slice(Math.max(0, (match.index ?? 0) - 8), (match.index ?? 0) + 12);
      if (!/\d/.test(around)) continue;
    }
    return { code, index: match.index ?? 0 };
  }
  return null;
}

/** A glyph that maps to exactly one currency, with rupee treated as a family. */
function findSymbol(text: string): { code: string; symbol: string; index: number } | null {
  let best: { code: string; symbol: string; index: number } | null = null;
  for (const [symbol, code] of Object.entries(unambiguousSymbols)) {
    const index = text.indexOf(symbol);
    if (index < 0) continue;
    if (!best || index < best.index) {
      best = { code, symbol, index };
    }
  }
  return best;
}

/** `US$`, `A$`, `R$` and friends. Longest token wins at the same position. */
function findDollarPrefix(text: string): { code: string; token: string; index: number } | null {
  const upper = text.toUpperCase();
  let best: { code: string; token: string; index: number } | null = null;
  for (const { token, code } of dollarPrefixes) {
    const index = upper.indexOf(token);
    if (index < 0) continue;
    if (!best || index < best.index || (index === best.index && token.length > best.token.length)) {
      best = { code, token, index };
    }
  }
  return best;
}

/** Resolve the ambiguous `$` from country evidence, never from a hardcoded USD. */
function resolveDollar(ctx: DetectContext): CurrencyDetection | null {
  const signal = countrySignal(ctx);
  if (!signal) return null;

  if (Object.prototype.hasOwnProperty.call(dollarCountries, signal.country)) {
    return {
      code: dollarCountries[signal.country]!,
      confidence: 0.7,
      basis: "TLD_OR_COUNTRY",
      evidence: `$${signal.source}`,
    };
  }

  const local = countryCurrency[signal.country];
  if (!local) return null;

  // A "$" inside a non-dollar market is ambiguous: it is usually a foreign
  // amount shown next to a local one. Take the local currency as the best guess
  // but stay below the review threshold so the ledger asks instead of asserting.
  return {
    code: local,
    confidence: 0.45,
    basis: "TLD_OR_COUNTRY",
    evidence: `$ in ${signal.source}`,
  };
}

/**
 * Detect the currency of the alert.
 *
 * Order, per the plan: explicit ISO -> unambiguous symbol -> prefixed dollar ->
 * country signal -> owner default. Every path returns a code; low confidence is
 * how the caller learns to route to review.
 */
export function detectCurrency(ctx: DetectContext): CurrencyDetection {
  const text = ctx.text ?? "";

  const iso = findIsoCode(text);
  if (iso) {
    return {
      code: iso.code,
      confidence: 0.95,
      basis: "EXPLICIT_ISO",
      evidence: iso.code,
    };
  }

  const prefix = findDollarPrefix(text);
  if (prefix) {
    return {
      code: prefix.code,
      confidence: 0.85,
      basis: "PREFIXED_DOLLAR",
      evidence: prefix.token,
    };
  }

  const symbol = findSymbol(text);
  if (symbol) {
    if (rupeeFamily.has(symbol.code)) {
      // ₹ is India, Pakistan, Sri Lanka, Nepal and Mauritius. The glyph alone
      // cannot separate them; the country signal can.
      const signal = countrySignal(ctx);
      const resolved = signal ? countryCurrency[signal.country] : null;
      if (resolved && rupeeFamily.has(resolved)) {
        return {
          code: resolved,
          confidence: 0.8,
          basis: "UNAMBIGUOUS_SYMBOL",
          evidence: `${symbol.symbol} on ${signal?.source ?? "country"}`,
        };
      }
      return {
        code: symbol.code,
        confidence: 0.7,
        basis: "UNAMBIGUOUS_SYMBOL",
        evidence: symbol.symbol,
      };
    }
    return {
      code: symbol.code,
      confidence: 0.9,
      basis: "UNAMBIGUOUS_SYMBOL",
      evidence: symbol.symbol,
    };
  }

  if (/\$/.test(text)) {
    const resolved = resolveDollar(ctx);
    if (resolved) return resolved;
  }

  const signal = countrySignal(ctx);
  if (signal) {
    const code = countryCurrency[signal.country];
    if (code) {
      return {
        code,
        confidence: 0.55,
        basis: "TLD_OR_COUNTRY",
        evidence: signal.source,
      };
    }
  }

  return defaultDetection(ctx);
}

/** A hit that carries its own currency marker, e.g. `USD 14.00` or `₹1,180.00`. */
function currencyAdjacentTo(hit: AmountHit): string | null {
  const before = prefixCode(hit);
  if (before && knownCurrencyCodes.has(before)) return before;
  const after = suffixCode(hit);
  if (after && knownCurrencyCodes.has(after)) return after;
  return null;
}

/**
 * Read the money in an alert as a booked/stated pair.
 *
 * A card alert commonly states a foreign amount and a domestic posted amount in
 * one body. The booked side is the one that matches the account; the other is
 * the stated side. When both amounts carry the same currency, only one is kept
 * and no stated pair is returned — a NULL stated pair means "same as booked".
 */
export type AmountReading = {
  booked: { amount: string; currency: CurrencyDetection };
  stated: { amount: string; currency: CurrencyDetection } | null;
  /** Every monetary token we read, in order, for evidence. */
  hits: number;
};

export function readMoney(
  text: string,
  ctx: DetectContext,
  options: { excludeIndices?: Array<[number, number]>; anchorIndex?: number } = {},
): AmountReading | null {
  const hits = findAmounts(text, options.excludeIndices ?? []);
  if (hits.length === 0) return null;

  const dominant = detectCurrency({ ...ctx, text });
  const anchor = options.anchorIndex ?? 0;

  type Candidate = { hit: AmountHit; currency: CurrencyDetection };
  const candidates: Candidate[] = [];

  for (const hit of hits) {
    const adjacent = currencyAdjacentTo(hit);
    if (adjacent) {
      candidates.push({
        hit,
        currency: { code: adjacent, confidence: 0.95, basis: "EXPLICIT_ISO", evidence: adjacent },
      });
      continue;
    }
    if (hasSymbol(hit)) {
      const glyph = hit.prefix.trim().slice(-1);
      const code = unambiguousSymbols[glyph] ?? dominant.code;
      candidates.push({
        hit,
        currency: { code, confidence: 0.9, basis: "UNAMBIGUOUS_SYMBOL", evidence: glyph },
      });
      continue;
    }
    if (hasWordUnit(hit)) {
      candidates.push({ hit, currency: dominant });
      continue;
    }
    // Bare numbers are only money if the amount has grouping or a decimal, or is
    // introduced by a currency code or symbol.
    if (!isMonetaryHit(hit)) continue;
    candidates.push({ hit, currency: dominant });
  }

  if (candidates.length === 0) return null;

  const preferred = (ctx.accountCurrency ?? "").trim().toUpperCase();
  const byCurrency = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const list = byCurrency.get(candidate.currency.code) ?? [];
    list.push(candidate);
    byCurrency.set(candidate.currency.code, list);
  }

  /**
   * Within one currency the alert usually writes several numbers: the transaction,
   * the available balance, the account suffix. The one nearest the moving verb is
   * the transaction.
   */
  const nearest = (list: Candidate[]): Candidate => {
    let best = list[0]!;
    for (const candidate of list) {
      if (Math.abs(candidate.hit.index - anchor) < Math.abs(best.hit.index - anchor)) {
        best = candidate;
      }
    }
    return best;
  };

  let bookedCurrency = [...byCurrency.keys()][0]!;
  if (preferred && byCurrency.has(preferred) && byCurrency.size > 1) {
    // The account's own currency is the booked side of a multi-currency alert.
    bookedCurrency = preferred;
  } else if (byCurrency.size > 1) {
    // Otherwise the strongest evidence wins, and the last written amount breaks a tie
    // (card alerts post the domestic amount after the foreign one).
    let bestBasis = -1;
    for (const [code, list] of byCurrency) {
      const basis = basisRank[nearest(list).currency.basis];
      if (basis > bestBasis || (basis === bestBasis && code > bookedCurrency)) {
        bestBasis = basis;
        bookedCurrency = code;
      }
    }
  }

  const booked = nearest(byCurrency.get(bookedCurrency)!);

  let stated: Candidate | null = null;
  for (const [code, list] of byCurrency) {
    if (code === bookedCurrency) continue;
    const candidate = nearest(list);
    if (!stated || basisRank[candidate.currency.basis] > basisRank[stated.currency.basis]) {
      stated = candidate;
    }
  }

  return {
    booked: { amount: booked.hit.amount, currency: booked.currency },
    stated: stated ? { amount: stated.hit.amount, currency: stated.currency } : null,
    hits: hits.length,
  };
}

/** A currency the caller must double-check before trusting, for the review row. */
export function needsReview(detection: CurrencyDetection): boolean {
  return detection.confidence < reviewThreshold;
}

/** Decimal places for a code, for formatting evidence strings server-side. */
export function decimalsFor(code: string): number {
  return minorUnitsFor(code);
}
