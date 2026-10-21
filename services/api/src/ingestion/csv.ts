import { rowsFromTable, type StatementRow, type TableRecord } from "./table.js";

export function readStatementCsv(text: string): StatementRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("invalid statement structure");
  }
  const records: TableRecord[] = lines.map((line, index) => ({ index: index + 1, cells: splitCsvLine(line) }));
  try {
    return rowsFromTable(records, (record) => ({ source: "csv", row_index: record.index }));
  } catch {
    throw new Error("invalid statement structure");
  }
}

export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted && char === "\"" && line[index + 1] === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}
