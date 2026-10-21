import type { FinanceWriter } from "./finance.js";

export type HomeSnapshot = {
  transactions: unknown[];
  due_alerts: unknown[];
  mutual_funds: unknown[];
  investments: unknown[];
  assets: unknown[];
  debts: unknown[];
  insurance: unknown[];
  fx: { rate_date: string; display_currency: string } | null;
};

export async function buildHome(finance: FinanceWriter, ownerId: string, displayCurrency = "USD"): Promise<HomeSnapshot> {
  const [transactions, dueAlerts, mutualFunds, investments, assets, debts, insurance, fx] = await Promise.all([
    finance.read(ownerId, "transactions"),
    finance.read(ownerId, "due-alerts"),
    finance.read(ownerId, "mutual-funds"),
    finance.read(ownerId, "investments"),
    finance.read(ownerId, "assets"),
    finance.read(ownerId, "debts"),
    finance.read(ownerId, "insurance"),
    finance.latestFx(),
  ]);
  const quotes = new Map((fx?.rates ?? []).map((rate) => [rate.quote_code, Number(rate.rate)]));
  return {
    transactions: transactions.map((row) => displayMoney(row, quotes, displayCurrency)),
    due_alerts: dueAlerts.map((row) => displayMoney(row, quotes, displayCurrency)),
    mutual_funds: mutualFunds,
    investments: investments,
    assets: assets,
    debts: debts,
    insurance: insurance,
    fx: fx ? { rate_date: fx.rate_date, display_currency: displayCurrency } : null,
  };
}

function displayMoney(row: unknown, quotes: Map<string, number>, displayCurrency: string): unknown {
  if (!row || typeof row !== "object") return row;
  const record = row as { amount?: string; amount_due?: string; currency_code?: string };
  const raw = record.amount ?? record.amount_due;
  const currency = record.currency_code ?? "";
  const display = convert(raw, currency, displayCurrency, quotes);
  return { ...record, display_currency: displayCurrency, display_amount: display };
}

export function convert(amount: string | undefined, currency: string, displayCurrency: string, quotes: Map<string, number>): string | null {
  if (!amount) return null;
  if (currency === displayCurrency) return amount;
  const from = currency === "EUR" ? 1 : quotes.get(currency);
  const to = displayCurrency === "EUR" ? 1 : quotes.get(displayCurrency);
  if (!from || !to) return null;
  const value = (Number(amount) / from) * to;
  return value.toFixed(2);
}
