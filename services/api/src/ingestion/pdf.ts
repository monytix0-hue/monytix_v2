import { getDocument, PasswordException, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { normalizeDate, parseMoney } from "./dates.js";
import { ExtractionFailure } from "./failure.js";
import { rowsFromTable, type StatementRow, type TableRecord } from "./table.js";

type TextItem = { str: string; x: number; y: number };
type PageText = { page: number; lines: string[]; items: TextItem[] };
type AmountAnchor = { key: "date" | "narration" | "value" | "withdrawal" | "deposit" | "balance"; x: number };

export async function extractPdf(body: Buffer, statementPassword?: string): Promise<StatementRow[]> {
  const pages = await readPages(body, statementPassword);
  const hasText = pages.some((page) => page.lines.some((line) => line.trim().length > 0));
  if (!hasText) {
    throw new ExtractionFailure("SCANNED_DOCUMENT_OCR_NOT_PERMITTED");
  }
  const positioned = rowsFromPositionedPages(pages);
  if (positioned) {
    return positioned;
  }
  const rows: StatementRow[] = [];
  let readingOrder = 0;
  for (const page of pages) {
    for (const line of page.lines) {
      const row = transactionFromLine(line, page.page, readingOrder + 1);
      if (!row) {
        continue;
      }
      readingOrder += 1;
      row.evidence.reading_order = readingOrder;
      rows.push(row);
    }
  }
  return rows;
}

export function rowsFromTextItems(items: TextItem[], page = 1): StatementRow[] {
  return rowsFromPositionedPages([{ page, lines: [], items }]) ?? [];
}

async function readPages(body: Buffer, statementPassword?: string): Promise<PageText[]> {
  const data = new Uint8Array(body.byteLength);
  data.set(body);
  const task = getDocument({
    data,
    password: statementPassword,
    verbosity: VerbosityLevel.ERRORS,
    useSystemFonts: false,
    disableFontFace: true,
  });
  try {
    const document = await task.promise;
    const pages: PageText[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str) {
          continue;
        }
        items.push({ str: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 });
      }
      pages.push({ page: pageNumber, lines: linesFromItems(items), items });
    }
    return pages;
  } catch (error) {
    if (error instanceof PasswordException) {
      throw new ExtractionFailure("PASSWORD_REJECTED");
    }
    throw new ExtractionFailure("SCANNED_DOCUMENT_OCR_NOT_PERMITTED");
  } finally {
    await task.destroy();
  }
}

function linesFromItems(items: TextItem[]): string[] {
  const groups = new Map<number, TextItem[]>();
  for (const item of items) {
    const key = Math.round(item.y);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([, group]) => group.sort((left, right) => left.x - right.x).map((item) => item.str).join(" ").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

const statementDate = /^(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{2,4}|\d{2}[/-][A-Za-z]{3}[/-]\d{4})$/;

function rowsFromPositionedPages(pages: PageText[]): StatementRow[] | null {
  const records: TableRecord[] = [];
  const pageNumbers: number[] = [];
  let anchors: AmountAnchor[] | null = null;
  for (const page of pages) {
    for (const group of lineGroups(page.items)) {
      const found = anchorsFromGroup(group);
      if (found) {
        anchors = found;
        if (records.length === 0) {
          records.push({ index: records.length, cells: ["Date", "Narration", "Withdrawal", "Deposit", "Closing Balance"] });
          pageNumbers.push(page.page);
        }
        continue;
      }
      if (!anchors) {
        continue;
      }
      const cells = cellsForGroup(group, anchors);
      if (!statementDate.test(cells[0] ?? "")) {
        continue;
      }
      records.push({ index: records.length, cells });
      pageNumbers.push(page.page);
    }
  }
  if (!anchors || records.length < 2) {
    return null;
  }
  const rows = rowsFromTable(records, (record) => ({
    page_number: pageNumbers[record.index] ?? 1,
    reading_order: record.index,
  })).filter((row) => row.amount.length > 0);
  return rows.map((row, index) => ({
    ...row,
    evidence: { ...row.evidence, reading_order: index + 1 },
  }));
}

function lineGroups(items: TextItem[]): TextItem[][] {
  const groups = new Map<number, TextItem[]>();
  for (const item of items) {
    const key = Math.round(item.y);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()].sort((left, right) => right[0] - left[0]).map(([, group]) => group);
}

function anchorsFromGroup(items: TextItem[]): AmountAnchor[] | null {
  const found = new Map<AmountAnchor["key"], number>();
  for (const item of items) {
    const label = item.str.toLowerCase();
    if (/\bdate\b/.test(label) && !/value/.test(label)) {
      found.set("date", item.x);
    } else if (/value/.test(label) && (/date/.test(label) || /\bdt\b/.test(label))) {
      found.set("value", item.x);
    } else if (/narration|particulars|description/.test(label)) {
      found.set("narration", item.x);
    } else if (/withdrawal|\bdebit\b/.test(label)) {
      found.set("withdrawal", item.x);
    } else if (/deposit|\bcredit\b/.test(label)) {
      found.set("deposit", item.x);
    } else if (/balance/.test(label)) {
      found.set("balance", item.x);
    }
  }
  for (const key of ["date", "narration", "withdrawal", "deposit", "balance"] as const) {
    if (!found.has(key)) {
      return null;
    }
  }
  return [...found.entries()].map(([key, x]) => ({ key, x }));
}

function cellsForGroup(items: TextItem[], anchors: AmountAnchor[]): string[] {
  const anchorX = new Map(anchors.map((anchor) => [anchor.key, anchor.x]));
  const usable = items.filter((item) => item.str.trim().length > 0);
  const dates = usable.filter((item) => statementDate.test(item.str.trim()));
  const txnDate = closestItem(dates, anchorX.get("date"));
  const valueDate = closestItem(dates.filter((item) => item !== txnDate), anchorX.get("value"));
  const monies = usable.filter((item) => moneyItem.test(item.str.replace(/\s/g, "")));
  const narration = usable.filter((item) => item !== txnDate && item !== valueDate && !monies.includes(item) && item.x < (anchorX.get("withdrawal") ?? Number.POSITIVE_INFINITY));
  return [
    txnDate?.str.trim() ?? "",
    narration.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim(),
    monies.filter((item) => inAmountZone(item.x, anchorX.get("withdrawal"), anchorX.get("deposit"))).map((item) => item.str).join(" "),
    monies.filter((item) => inAmountZone(item.x, anchorX.get("deposit"), anchorX.get("balance"))).map((item) => item.str).join(" "),
    monies.filter((item) => inAmountZone(item.x, anchorX.get("balance"), undefined)).map((item) => item.str).join(" "),
  ];
}

const moneyItem = /^-?\(?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})\)?$/;

function closestItem(items: TextItem[], x: number | undefined): TextItem | null {
  if (x === undefined || items.length === 0) {
    return null;
  }
  return items.reduce((best, item) => Math.abs(item.x - x) < Math.abs(best.x - x) ? item : best);
}

function inAmountZone(x: number, start: number | undefined, next: number | undefined): boolean {
  if (start === undefined) {
    return false;
  }
  const from = start - 15;
  const to = next === undefined ? Number.POSITIVE_INFINITY : next - 15;
  return x >= from && x < to;
}

function transactionFromLine(line: string, page: number, readingOrder: number): StatementRow | null {
  const lead = line.match(/^(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4}|\d{2}[/-][A-Za-z]{3}[/-]\d{4}|\d{2}[/-]\d{2}[/-]\d{2})\s+([\s\S]+)$/);
  if (!lead) {
    return null;
  }
  const date = normalizeDate(lead[1]);
  const split = splitNarration(lead[2]);
  if (!split.narration) {
    return null;
  }
  const monies = split.monies.map((value) => parseMoney(value));
  let amount = "";
  let direction = "";
  let debit = "";
  let credit = "";
  let balance = "";
  if (monies.length >= 3) {
    const debitMoney = monies[monies.length - 3];
    const creditMoney = monies[monies.length - 2];
    const balanceMoney = monies[monies.length - 1];
    debit = present(debitMoney) ? debitMoney.amount : "";
    credit = present(creditMoney) ? creditMoney.amount : "";
    balance = balanceMoney?.amount ?? "";
    if (debit && !credit) {
      amount = debit;
      direction = "OUT";
    } else if (credit && !debit) {
      amount = credit;
      direction = "IN";
    }
  } else if (monies.length === 2) {
    const value = monies[0];
    balance = monies[1]?.amount ?? "";
    if (value) {
      amount = value.amount;
      direction = value.negative ? "OUT" : "";
    }
  } else if (monies.length === 1 && monies[0]) {
    amount = monies[0].amount;
    direction = monies[0].negative ? "OUT" : "";
  }
  return {
    txn_date: date.resolved ? date.value : "",
    amount,
    direction,
    description: split.narration,
    dateResolved: date.resolved,
    evidence: {
      page_number: page,
      reading_order: readingOrder,
      raw_date: lead[1],
      debit,
      credit,
      balance,
      narration: split.narration,
    },
  };
}

function present(value: { amount: string; negative: boolean } | null | undefined): value is { amount: string; negative: boolean } {
  return !!value && Number(value.amount) !== 0;
}

function splitNarration(rest: string): { narration: string; monies: string[] } {
  const trimmed = rest.trim();
  const matches = [...trimmed.matchAll(/(?:\(|-)?(?:₹|Rs\.?)?\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})\)?/g)];
  if (matches.length === 0) {
    return { narration: trimmed, monies: [] };
  }
  const last = matches[matches.length - 1];
  const lastEnd = (last.index ?? 0) + last[0].length;
  if (trimmed.slice(lastEnd).trim() !== "") {
    return { narration: trimmed, monies: [] };
  }
  const kept: RegExpMatchArray[] = [];
  let cursor = trimmed.length;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const end = (match.index ?? 0) + match[0].length;
    if (trimmed.slice(end, cursor).trim() !== "") {
      break;
    }
    kept.unshift(match);
    cursor = match.index ?? 0;
  }
  return {
    narration: trimmed.slice(0, kept[0]?.index ?? trimmed.length).trim(),
    monies: kept.map((match) => match[0]),
  };
}
