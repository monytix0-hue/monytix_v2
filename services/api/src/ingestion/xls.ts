import { ExtractionFailure } from "./failure.js";
import { rowsFromTable, type StatementRow, type TableRecord } from "./table.js";

const ENDOFCHAIN = 0xfffffffe;
const FREE = 0xffffffff;

type BiffRecord = { type: number; data: Buffer };

export function readXls(body: Buffer, maxRows: number): StatementRow[] {
  const workbook = compoundStream(body, ["Workbook", "Book"]);
  if (!workbook) {
    throw new ExtractionFailure("INVALID_STRUCTURE");
  }
  const records = biffRecords(workbook);
  const sheets = sheetTables(records);
  if (sheets.length === 0) {
    throw new ExtractionFailure("INVALID_STRUCTURE");
  }
  const rows: StatementRow[] = [];
  for (const sheet of sheets) {
    rows.push(...rowsFromTable(sheet.records, (record) => ({ sheet_name: sheet.name, row_index: record.index }), maxRows));
  }
  if (rows.length === 0) {
    throw new ExtractionFailure("INVALID_STRUCTURE");
  }
  return rows;
}

function sheetTables(records: BiffRecord[]): { name: string; records: TableRecord[] }[] {
  const names: { name: string; offset: number }[] = [];
  const strings = sharedStrings(records);
  const tables = new Map<number, Map<number, Map<number, string>>>();
  let sheetIndex = -1;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.type === 0x0085 && record.data.length >= 8) {
      names.push({ offset: record.data.readUInt32LE(0), name: sheetName(record.data) });
    }
    if (record.type === 0x0809 && record.data.length >= 4 && record.data.readUInt16LE(2) === 0x0010) {
      sheetIndex += 1;
      tables.set(sheetIndex, new Map());
    }
    const grid = tables.get(sheetIndex);
    if (!grid || record.data.length < 6) {
      continue;
    }
    if (record.type === 0x0204) {
      const text = unicodeString(record.data.subarray(6), 0)?.text ?? "";
      writeCell(grid, record.data.readUInt16LE(0), record.data.readUInt16LE(2), text);
    } else if (record.type === 0x00fd && record.data.length >= 10) {
      writeCell(grid, record.data.readUInt16LE(0), record.data.readUInt16LE(2), strings[record.data.readUInt32LE(6)] ?? "");
    } else if (record.type === 0x0203 && record.data.length >= 14) {
      writeCell(grid, record.data.readUInt16LE(0), record.data.readUInt16LE(2), formatNumber(record.data.readDoubleLE(6)));
    } else if (record.type === 0x027e && record.data.length >= 10) {
      writeCell(grid, record.data.readUInt16LE(0), record.data.readUInt16LE(2), formatNumber(decodeRk(record.data.readUInt32LE(6))));
    } else if (record.type === 0x0006 && record.data.length >= 14) {
      const cached = cachedFormula(record.data);
      if (cached !== null) {
        writeCell(grid, record.data.readUInt16LE(0), record.data.readUInt16LE(2), cached);
      }
    }
  }
  if (names.length === 0) {
    return [];
  }
  return names.map((sheet, index) => ({
    name: sheet.name,
    records: gridRecords(tables.get(index) ?? new Map()),
  }));
}

function writeCell(grid: Map<number, Map<number, string>>, row: number, col: number, value: string): void {
  const line = grid.get(row) ?? new Map<number, string>();
  line.set(col, value);
  grid.set(row, line);
}

function gridRecords(grid: Map<number, Map<number, string>>): TableRecord[] {
  return [...grid.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([row, columns]) => {
      const width = Math.max(...columns.keys()) + 1;
      return {
        index: row + 1,
        cells: Array.from({ length: width }, (_, column) => columns.get(column) ?? ""),
      };
    });
}

function cachedFormula(data: Buffer): string | null {
  if (data[12] === 0xff) {
    return null;
  }
  return formatNumber(data.readDoubleLE(6));
}

function decodeRk(value: number): number {
  const divided = (value & 1) === 1;
  const integer = (value & 2) === 2;
  let number: number;
  if (integer) {
    number = value >> 2;
  } else {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32LE(value & 0xfffffffc, 4);
    number = buffer.readDoubleLE(0);
  }
  return divided ? number / 100 : number;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function sheetName(data: Buffer): string {
  const count = data.readUInt8(6);
  const flags = data.readUInt8(7);
  const wide = (flags & 1) === 1;
  const bytes = data.subarray(8, 8 + count * (wide ? 2 : 1));
  return wide ? bytes.toString("utf16le") : bytes.toString("latin1");
}

function sharedStrings(records: BiffRecord[]): string[] {
  const start = records.findIndex((record) => record.type === 0x00fc);
  if (start < 0 || records[start].data.length < 8) {
    return [];
  }
  const block = [records[start].data];
  for (let index = start + 1; index < records.length && records[index].type === 0x003c; index += 1) {
    block.push(records[index].data);
  }
  const unique = records[start].data.readUInt32LE(4);
  const strings: string[] = [];
  let recordIndex = 0;
  let position = 8;
  const remaining = () => block[recordIndex].length - position;
  const nextRecord = () => {
    recordIndex += 1;
    position = 0;
  };
  for (let index = 0; index < unique; index += 1) {
    if (remaining() < 3) {
      nextRecord();
    }
    const count = block[recordIndex].readUInt16LE(position);
    position += 2;
    let flags = block[recordIndex].readUInt8(position);
    position += 1;
    let runs = 0;
    let phonetic = 0;
    if ((flags & 0x8) === 0x8) {
      runs = block[recordIndex].readUInt16LE(position);
      position += 2;
    }
    if ((flags & 0x4) === 0x4) {
      phonetic = block[recordIndex].readUInt32LE(position);
      position += 4;
    }
    let text = "";
    let left = count;
    let wide = (flags & 0x1) === 0x1;
    while (left > 0) {
      const width = wide ? 2 : 1;
      if (remaining() < width) {
        nextRecord();
        flags = block[recordIndex].readUInt8(position);
        position += 1;
        wide = (flags & 0x1) === 0x1;
        continue;
      }
      const take = Math.min(left, Math.floor(remaining() / width));
      const slice = block[recordIndex].subarray(position, position + take * width);
      text += wide ? slice.toString("utf16le") : slice.toString("latin1");
      position += take * width;
      left -= take;
    }
    const skip = runs * 4 + phonetic;
    let skipping = skip;
    while (skipping > 0) {
      if (remaining() === 0) {
        nextRecord();
      }
      const take = Math.min(skipping, remaining());
      position += take;
      skipping -= take;
    }
    strings.push(text);
  }
  return strings;
}

function unicodeString(data: Buffer, offset: number): { text: string } | null {
  if (data.length < offset + 3) {
    return null;
  }
  const count = data.readUInt16LE(offset);
  const flags = data.readUInt8(offset + 2);
  const wide = (flags & 1) === 1;
  const bytes = data.subarray(offset + 3, offset + 3 + count * (wide ? 2 : 1));
  return { text: wide ? bytes.toString("utf16le") : bytes.toString("latin1") };
}

function biffRecords(body: Buffer): BiffRecord[] {
  const records: BiffRecord[] = [];
  let offset = 0;
  while (offset + 4 <= body.length) {
    const type = body.readUInt16LE(offset);
    const length = body.readUInt16LE(offset + 2);
    if (offset + 4 + length > body.length) {
      break;
    }
    records.push({ type, data: body.subarray(offset + 4, offset + 4 + length) });
    offset += 4 + length;
    if (type === 0x000a && records.filter((record) => record.type === 0x0809).length > 1 && offset > 0) {
      const sheets = records.filter((record) => record.type === 0x0085).length;
      const eofs = records.filter((record) => record.type === 0x000a).length;
      if (sheets > 0 && eofs > sheets) {
        break;
      }
    }
  }
  return records;
}

function compoundStream(body: Buffer, names: string[]): Buffer | null {
  if (body.length < 512 || body.readUInt32LE(0) !== 0xe011cfd0) {
    return null;
  }
  const sectorShift = body.readUInt16LE(0x1e);
  const miniShift = body.readUInt16LE(0x20);
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const fatCount = body.readUInt32LE(0x2c);
  const directoryStart = body.readUInt32LE(0x30);
  const miniCutoff = body.readUInt32LE(0x38);
  const miniFatStart = body.readUInt32LE(0x3c);
  const fatSectors: number[] = [];
  for (let index = 0; index < Math.min(fatCount, 109); index += 1) {
    fatSectors.push(body.readUInt32LE(0x4c + index * 4));
  }
  const fat: number[] = [];
  for (const sector of fatSectors) {
    const offset = (sector + 1) * sectorSize;
    for (let cursor = 0; cursor < sectorSize; cursor += 4) {
      fat.push(body.readUInt32LE(offset + cursor));
    }
  }
  const directory = readChain(body, directoryStart, fat, sectorSize);
  const rootStart = directory.readUInt32LE(0x74);
  const rootSize = directory.readUInt32LE(0x78);
  const miniStream = rootStart === ENDOFCHAIN || rootStart === FREE ? Buffer.alloc(0) : readChain(body, rootStart, fat, sectorSize).subarray(0, rootSize);
  const miniFat = miniFatStart === ENDOFCHAIN || miniFatStart === FREE ? [] : [...readChain(body, miniFatStart, fat, sectorSize)].reduce<number[]>((values, _byte, index, bytes) => {
    if (index % 4 === 0) {
      values.push(Buffer.from(bytes.slice(index, index + 4)).readUInt32LE(0));
    }
    return values;
  }, []);
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const entry = directory.subarray(offset, offset + 128);
    const kind = entry.readUInt8(0x42);
    if (kind !== 2) {
      continue;
    }
    const name = entryName(entry);
    if (!names.includes(name)) {
      continue;
    }
    const start = entry.readUInt32LE(0x74);
    const size = entry.readUInt32LE(0x78);
    if (size < miniCutoff) {
      return readMiniChain(miniStream, miniFat, start, size, miniSize);
    }
    return readChain(body, start, fat, sectorSize).subarray(0, size);
  }
  return null;
}

function entryName(entry: Buffer): string {
  const length = entry.readUInt16LE(0x40);
  if (length < 2) {
    return "";
  }
  return entry.subarray(0, length - 2).toString("utf16le");
}

function readChain(body: Buffer, start: number, fat: number[], sectorSize: number): Buffer {
  const chunks: Buffer[] = [];
  let sector = start;
  const seen = new Set<number>();
  while (sector !== ENDOFCHAIN && sector !== FREE && sector < 0xfffffff0) {
    if (seen.has(sector)) {
      break;
    }
    seen.add(sector);
    const offset = (sector + 1) * sectorSize;
    chunks.push(body.subarray(offset, offset + sectorSize));
    sector = fat[sector] ?? ENDOFCHAIN;
  }
  return Buffer.concat(chunks);
}

function readMiniChain(miniStream: Buffer, miniFat: number[], start: number, size: number, miniSize: number): Buffer {
  const chunks: Buffer[] = [];
  let sector = start;
  const seen = new Set<number>();
  while (sector !== ENDOFCHAIN && sector !== FREE && sector < 0xfffffff0) {
    if (seen.has(sector)) {
      break;
    }
    seen.add(sector);
    const offset = sector * miniSize;
    chunks.push(miniStream.subarray(offset, offset + miniSize));
    sector = miniFat[sector] ?? ENDOFCHAIN;
  }
  return Buffer.concat(chunks).subarray(0, size);
}
