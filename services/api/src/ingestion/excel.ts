import { EXCEL_ROW_LIMIT, type StatementRow } from "./table.js";
import { readXls } from "./xls.js";
import { readXlsx } from "./xlsx.js";

export function readExcel(body: Buffer, fileType: "XLS" | "XLSX", maxRows = EXCEL_ROW_LIMIT): StatementRow[] {
  return fileType === "XLSX" ? readXlsx(body, maxRows) : readXls(body, maxRows);
}
