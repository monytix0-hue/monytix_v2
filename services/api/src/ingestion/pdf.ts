import { getDocument, PasswordException, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { normalizeDate, parseMoney } from "./dates.js";
import { ExtractionFailure } from "./failure.js";
import type { StatementRow } from "./table.js";

type TextItem = { str: string; x: number; y: number };
type PageText = { page: number; lines: string[] };

export async function extractPdf(body: Buffer, statementPassword?: string): Promise<StatementRow[]> {
  const pages = await readPages(body, statementPassword);
  const hasText = pages.some((page) => page.lines.some((line) => line.trim().length > 0));
  if (!hasText) {
    throw new ExtractionFailure("SCANNED_DOCUMENT_OCR_NOT_PERMITTED");
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
      pages.push({ page: pageNumber, lines: linesFromItems(items) });
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

function transactionFromLine(line: string, page: number, readingOrder: number): StatementRow | null {
  const lead = line.match(/^(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4}|\d{2}[/-][A-Za-z]{3}[/-]\d{4})\s+([\s\S]+)$/);
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
