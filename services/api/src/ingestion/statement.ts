import { readStatementCsv } from "./csv.js";
import { detectFileType } from "./detect.js";
import { readExcel } from "./excel.js";
import { ExtractionFailure } from "./failure.js";
import { extractPdf } from "./pdf.js";
import type { StatementRow } from "./table.js";

export async function extractStatementRows(fileType: string, body: Buffer, statementPassword?: string): Promise<StatementRow[]> {
  if (detectFileType(body) !== fileType) {
    throw new ExtractionFailure("FILE_TYPE_MISMATCH");
  }
  if (fileType === "CSV") {
    return readStatementCsv(body.toString("utf8"));
  }
  if (fileType === "PDF") {
    return extractPdf(body, statementPassword);
  }
  if (fileType === "XLSX" || fileType === "XLS") {
    return readExcel(body, fileType);
  }
  throw new ExtractionFailure("UNSUPPORTED_FILE_LAYOUT");
}

export function combineParsedRow(parsed: Record<string, unknown>, row: StatementRow): Record<string, unknown> {
  const combined: Record<string, unknown> = { ...parsed, description: row.description, evidence: row.evidence };
  if (row.dateResolved && row.txn_date) {
    combined.txn_date = row.txn_date;
  } else {
    delete combined.txn_date;
  }
  if (row.amount) {
    combined.amount = row.amount;
  } else {
    delete combined.amount;
  }
  if (row.direction) {
    combined.direction = row.direction;
  } else {
    delete combined.direction;
  }
  const complete = row.dateResolved && row.amount.length > 0 && row.direction.length > 0;
  if (!complete && combined.parse_status === "PARSED") {
    combined.parse_status = "PARTIAL";
  }
  return combined;
}
