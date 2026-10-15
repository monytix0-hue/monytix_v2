import { mapDirection, normalizeDate, parseMoney } from "./dates.js";
import { ExtractionFailure } from "./failure.js";

export const EXCEL_ROW_LIMIT = 10_000;

export type StatementRow = {
  txn_date: string;
  amount: string;
  direction: string;
  description: string;
  evidence: Record<string, unknown>;
  dateResolved: boolean;
};

export type TableRecord = {
  index: number;
  cells: string[];
};

const dateHeaders = ["txn date", "date", "value date", "transaction date", "posted date", "tran date"];
const descriptionHeaders = ["description", "narration", "particulars", "details", "transaction details", "remarks"];
const debitHeaders = ["debit", "withdrawal", "dr", "debit amount", "withdrawal amount"];
const creditHeaders = ["credit", "deposit", "cr", "credit amount", "deposit amount"];
const amountHeaders = ["amount", "transaction amount"];
const directionHeaders = ["direction"];
const balanceHeaders = ["balance", "closing balance", "running balance"];
const footer = /^(total|totals|grand total|closing balance|opening balance|balance c\/f|balance b\/f|carried forward)$/i;

export function rowsFromTable(
  records: TableRecord[],
  provenance: (record: TableRecord) => Record<string, unknown>,
  maxRows?: number,
): StatementRow[] {
  const headerAt = records.findIndex((record) => columnsOf(record.cells) !== null);
  if (headerAt < 0) {
    throw new ExtractionFailure("INVALID_STRUCTURE");
  }
  const columns = columnsOf(records[headerAt].cells);
  if (!columns) {
    throw new ExtractionFailure("INVALID_STRUCTURE");
  }
  const rows: StatementRow[] = [];
  for (const record of records.slice(headerAt + 1)) {
    const description = cell(record.cells, columns.description);
    if (!description || footer.test(description.trim())) {
      continue;
    }
    if (rows.length === maxRows) {
      throw new ExtractionFailure("SHEET_ROW_LIMIT_EXCEEDED");
    }
    const rawDate = cell(record.cells, columns.date);
    const date = normalizeDate(rawDate);
    const debit = parseMoney(cell(record.cells, columns.debit));
    const credit = parseMoney(cell(record.cells, columns.credit));
    const amount = parseMoney(cell(record.cells, columns.amount));
    const directed = mapDirection(cell(record.cells, columns.direction));
    const balance = cell(record.cells, columns.balance);
    let signedAmount = "";
    let direction = directed;
    const debitPresent = debit !== null && Number(debit.amount) !== 0;
    const creditPresent = credit !== null && Number(credit.amount) !== 0;
    if (debitPresent && creditPresent) {
      signedAmount = "";
      direction = "";
    } else if (debitPresent && debit) {
      signedAmount = debit.amount;
      direction = direction || "OUT";
    } else if (creditPresent && credit) {
      signedAmount = credit.amount;
      direction = direction || "IN";
    } else if (amount) {
      signedAmount = amount.amount;
      if (!direction) {
        direction = amount.negative ? "OUT" : "";
        if (!amount.negative && cell(record.cells, columns.amount).trim().startsWith("+")) {
          direction = "IN";
        } else if (amount.negative) {
          direction = "OUT";
        }
      }
    }
    const resolvedDate = date.resolved ? date.value : "";
    rows.push({
      txn_date: resolvedDate,
      amount: signedAmount,
      direction,
      description,
      dateResolved: date.resolved,
      evidence: {
        ...provenance(record),
        raw_date: rawDate,
        debit: debit?.amount ?? "",
        credit: credit?.amount ?? "",
        balance,
        narration: description,
      },
    });
  }
  return rows;
}

function columnsOf(headers: string[]): { date: number; description: number; debit: number; credit: number; amount: number; direction: number; balance: number } | null {
  const normalized = headers.map(normHeader);
  const description = find(normalized, descriptionHeaders);
  if (description < 0) {
    return null;
  }
  return {
    date: find(normalized, dateHeaders),
    description,
    debit: find(normalized, debitHeaders),
    credit: find(normalized, creditHeaders),
    amount: find(normalized, amountHeaders),
    direction: find(normalized, directionHeaders),
    balance: find(normalized, balanceHeaders),
  };
}

function find(headers: string[], names: string[]): number {
  return headers.findIndex((header) => names.includes(header));
}

function normHeader(value: string): string {
  return value.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
}

function cell(cells: string[], index: number): string {
  return index >= 0 ? cells[index]?.trim() ?? "" : "";
}
