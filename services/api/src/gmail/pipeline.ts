import { identifyBank as identifyInstitutionBank, type StatementBank } from "./institutions.js";

export type { StatementBank } from "./institutions.js";

export type PipelineTarget = "BANKING" | "MUTUAL_FUNDS" | "INSURANCE" | "PORTFOLIO_CAS";

const mutualFunds = new Set(["cams", "kfintech", "camsonline"]);
const insurance = new Set(["lic", "insurance", "policy", "premium"]);
const portfolio = new Set(["zerodha", "groww", "holdings", "portfolio"]);

export function detectPipelineTarget(filename: string, fromAddress: string): PipelineTarget {
  const tokens = wholeTokens(`${filename} ${fromAddress}`);
  if (hasToken(tokens, mutualFunds)) {
    return "MUTUAL_FUNDS";
  }
  if (hasToken(tokens, insurance)) {
    return "INSURANCE";
  }
  if (hasToken(tokens, portfolio)) {
    return "PORTFOLIO_CAS";
  }
  return "BANKING";
}

/**
 * The narration overlay to use for a statement, or null.
 *
 * Delegates to `ref.institution`'s mirror in `institutions.ts`. A non-Indian
 * sender now returns null instead of being unrecognised *and* unrunnable: the
 * document is still ingested, just without a bank-specific regex overlay.
 */
export function identifyBank(filename: string, fromAddress: string): StatementBank | null {
  return identifyInstitutionBank(filename, fromAddress);
}

function wholeTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0));
}

function hasToken(tokens: Set<string>, expected: Set<string>): boolean {
  for (const token of expected) {
    if (tokens.has(token)) {
      return true;
    }
  }
  return false;
}
