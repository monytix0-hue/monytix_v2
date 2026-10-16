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

export type StatementBank = "HDFC" | "ICICI" | "SBI" | "AXIS";

export function identifyBank(filename: string, fromAddress: string): StatementBank | null {
  const tokens = wholeTokens(`${filename} ${fromAddress}`);
  const found = new Set<StatementBank>();
  if (tokens.has("hdfc") || tokens.has("hdfcbank")) {
    found.add("HDFC");
  }
  if (tokens.has("icici") || tokens.has("icicibank")) {
    found.add("ICICI");
  }
  if (tokens.has("sbi") || tokens.has("sbin")) {
    found.add("SBI");
  }
  if (tokens.has("axis") || tokens.has("axisbank") || tokens.has("utib")) {
    found.add("AXIS");
  }
  return found.size === 1 ? [...found][0] : null;
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
