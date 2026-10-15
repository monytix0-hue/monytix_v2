import { unzipSync } from "fflate";
import { ExtractionFailure } from "./failure.js";
import { rowsFromTable, type StatementRow, type TableRecord } from "./table.js";

export function readXlsx(body: Buffer, maxRows: number): StatementRow[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(body));
  } catch {
    throw new ExtractionFailure("INVALID_STRUCTURE");
  }
  const workbook = textEntry(entries, "xl/workbook.xml");
  const rels = textEntry(entries, "xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) {
    throw new ExtractionFailure("INVALID_STRUCTURE");
  }
  const shared = sharedStrings(textEntry(entries, "xl/sharedstrings.xml") ?? "");
  const targets = new Map<string, string>();
  for (const tag of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
    const attributes = attrs(tag);
    const id = attributes.Id ?? attributes["r:id"];
    const target = attributes.Target;
    if (id && target) {
      targets.set(id, target.replace(/\\/g, "/"));
    }
  }
  const rows: StatementRow[] = [];
  const sheets = workbook.match(/<sheet\b[^>]*>/g) ?? [];
  if (sheets.length === 0) {
    throw new ExtractionFailure("INVALID_STRUCTURE");
  }
  for (const tag of sheets) {
    const attributes = attrs(tag);
    const name = decodeXml(attributes.name ?? "");
    const id = attributes["r:id"] ?? attributes.id ?? "";
    const target = targets.get(id);
    if (!name || !target) {
      throw new ExtractionFailure("INVALID_STRUCTURE");
    }
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const sheet = textEntry(entries, path.toLowerCase());
    if (!sheet) {
      throw new ExtractionFailure("INVALID_STRUCTURE");
    }
    const records = sheetRecords(sheet, shared);
    const extracted = rowsFromTable(records, (record) => ({ sheet_name: name, row_index: record.index }), maxRows);
    rows.push(...extracted);
  }
  if (rows.length === 0) {
    throw new ExtractionFailure("INVALID_STRUCTURE");
  }
  return rows;
}

function textEntry(entries: Record<string, Uint8Array>, suffix: string): string | null {
  const wanted = suffix.toLowerCase();
  const key = Object.keys(entries).find((name) => name.replace(/\\/g, "/").toLowerCase() === wanted);
  return key ? new TextDecoder("utf-8").decode(entries[key]) : null;
}

function sharedStrings(xml: string): string[] {
  if (!xml) {
    return [];
  }
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    const texts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => decodeXml(text[1]));
    return texts.join("");
  });
}

function sheetRecords(xml: string, shared: string[]): TableRecord[] {
  const byRow = new Map<number, Map<number, string>>();
  for (const match of xml.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attributes = attrs(match[1]);
    const ref = cellRef(attributes.r ?? "");
    if (!ref) {
      continue;
    }
    const inner = match[2] ?? "";
    const formula = inner.includes("<f");
    const valueMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
    if (formula && !valueMatch) {
      continue;
    }
    let value = "";
    if (attributes.t === "inlineStr") {
      value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => decodeXml(text[1])).join("");
    } else if (valueMatch) {
      const raw = decodeXml(valueMatch[1].trim());
      value = attributes.t === "s" ? shared[Number(raw)] ?? "" : raw;
    }
    const row = byRow.get(ref.row) ?? new Map<number, string>();
    row.set(ref.col, value);
    byRow.set(ref.row, row);
  }
  return [...byRow.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([index, columns]) => {
      const width = Math.max(...columns.keys()) + 1;
      const cells = Array.from({ length: width }, (_, column) => columns.get(column) ?? "");
      return { index, cells };
    });
}

function cellRef(ref: string): { row: number; col: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) {
    return null;
  }
  let col = 0;
  for (const char of match[1]) {
    col = col * 26 + char.charCodeAt(0) - 64;
  }
  return { row: Number(match[2]), col: col - 1 };
}

function attrs(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:]+)="([^"]*)"/g)) {
    result[match[1]] = match[2];
  }
  return result;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
