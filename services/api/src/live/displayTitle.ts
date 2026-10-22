import { isBoilerplateCounterparty, readableText } from "../gmail/alertParser.js";

const channelPrefix = /^(?:UPI(?:_[A-Z0-9]+)?|IMPS|NEFT|RTGS|ATM|CARD(?:_POS|_ECOMMERCE)?|ACH(?:_NACH)?|FT|OTHER)\s*\/\s*/i;
const alertPrefix = /^(?:us|info|alert|dr|cr):\s*/i;
const vpaPattern = /^([A-Za-z0-9][A-Za-z0-9._-]{0,40})@([A-Za-z0-9][A-Za-z0-9.-]{1,40})$/;
const disclaimerNoise = /\b(?:unauthori[sz]ed\b.*\bfraudulent|\bfraudulent\b.*\bunauthori[sz]ed|never\s+share\b.*\botp\b|statutory\s+warning)\b/i;

/** Turn stored raw_description into a Live-feed display title. */
export function displayTransactionTitle(raw: string | null | undefined): string {
  if (!raw) {
    return "Transaction";
  }
  let title = readableText(raw);
  if (disclaimerNoise.test(title) || isBoilerplateCounterparty(title)) {
    return "Transaction";
  }
  title = title.replace(channelPrefix, "").replace(alertPrefix, "").trim();
  title = title.replace(/\bBanking Corp\.?\b/gi, "").replace(/\b(?:Pvt\.?|Ltd\.?|Inc\.?)\b/gi, "").replace(/\s+/g, " ").trim();

  if (disclaimerNoise.test(title) || isBoilerplateCounterparty(title)) {
    return "Transaction";
  }

  const vpa = title.match(vpaPattern);
  if (vpa) {
    const local = vpa[1] ?? "";
    const handle = vpa[2] ?? "";
    if (isTerminalVpaLocal(local)) {
      return handle ? `UPI payment (@${handle.toLowerCase()})` : "UPI payment";
    }
    return local.replace(/[._-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()) || "UPI payment";
  }

  if (/^upi merchant\b/i.test(title)) {
    return title.replace(/^upi merchant/i, "UPI payment");
  }
  if (!title || /^unknown$/i.test(title) || /^(?:bank transfer|general spend)$/i.test(title)) {
    return "Transaction";
  }
  return title.slice(0, 160);
}

export function formatDisplayAmount(amount: string | number | null | undefined): string {
  const value = typeof amount === "number" ? amount : Number(String(amount ?? "").replace(/,/g, ""));
  if (!Number.isFinite(value)) {
    return String(amount ?? "");
  }
  return value.toFixed(2);
}

function isTerminalVpaLocal(local: string): boolean {
  const token = local.trim();
  if (!token || token.length <= 4) {
    return true;
  }
  return /^[0-9a-fA-F]+$/.test(token) || /^\d+$/.test(token);
}
