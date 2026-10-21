import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { readStatementCsv } from "../src/ingestion/csv.js";
import { detectFileType } from "../src/ingestion/detect.js";
import { ExtractionFailure } from "../src/ingestion/failure.js";
import { gmailMailboxParsing } from "../src/ingestion/gmail.js";
import { extractPdf, rowsFromTextItems } from "../src/ingestion/pdf.js";
import { readExcel } from "../src/ingestion/excel.js";
import { combineParsedRow, extractStatementRows } from "../src/ingestion/statement.js";

const encryptedPdf = Buffer.from(
  "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDBkYjYxOTk5NDA+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAzMDAgMjAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8MGU1MjI5MjVhM2U0ZTg3NGMzY2ZhY2JlZjUxMWE3M2FjNGVjMmJkODY1ZGNkM2Q0NjI3NjE0OTE3YWJmZDdlND4KL1UgPDg3Yjg4ODIxYmFiNzk4NGM2MjY2ZmZkMzgwNzliMDIxMjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAwMDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDMzMzYzMDY0MzAzNzM0NjUzMjM3MzYzMDMzMzEzMTM2MzA2MzYzMzU2MTYxMzAzNzY0NjUzNzM0Mzc2MjYzNjU+IDwzMzM2MzA2NDMwMzczNDY1MzIzNzM2MzAzMzMxMzEzNjMwNjM2MzM1NjE2MTMwMzc2NDY1MzczNDM3NjI2MzY1PiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK",
  "base64",
);

test("magic bytes identify a sealed statement and reject a mismatch", async () => {
  const pdf = textPdf("01/01/2026 UPI RENT 100.00");
  assert.equal(detectFileType(pdf), "PDF");
  assert.equal(detectFileType(Buffer.from("txn_date,description\n2026-01-02,UPI\n")), "CSV");
  assert.equal(detectFileType(sampleXlsx()), "XLSX");
  assert.equal(detectFileType(sampleXls()), "XLS");
  await assert.rejects(() => extractStatementRows("CSV", pdf), (error: unknown) => error instanceof ExtractionFailure && error.code === "FILE_TYPE_MISMATCH");
});

test("CSV keeps the description layout and accepts debit, credit, dates, preamble, and a totals footer", () => {
  const current = readStatementCsv("txn_date,amount,direction,description\n2026-01-02,10.00,OUT,UPI-1\n");
  assert.equal(current.length, 1);
  assert.equal(current[0]?.description, "UPI-1");
  assert.equal(current[0]?.txn_date, "2026-01-02");
  assert.equal(current[0]?.direction, "OUT");
  assert.equal(current[0]?.dateResolved, true);
  assert.throws(() => readStatementCsv("amount\n10\n"));

  const richer = readStatementCsv([
    "HDFC Bank",
    "Account statement",
    "Date,Narration,Debit,Credit",
    "01/01/2026,UPI RENT,\"1,000.00\",",
    "02-Jan-2026,SALARY,,2500.50",
    "yesterday,ATM,10.00,",
    "Total,,1000.00,2500.50",
  ].join("\n"));
  assert.equal(richer.length, 3);
  assert.equal(richer[0]?.txn_date, "2026-01-01");
  assert.equal(richer[0]?.amount, "1000.00");
  assert.equal(richer[0]?.direction, "OUT");
  assert.equal(richer[1]?.txn_date, "2026-01-02");
  assert.equal(richer[1]?.amount, "2500.50");
  assert.equal(richer[1]?.direction, "IN");
  assert.equal(richer[2]?.dateResolved, false);
  assert.equal(richer[2]?.txn_date, "");
  assert.equal(richer[2]?.evidence.raw_date, "yesterday");

  const signed = readStatementCsv("txn_date,amount,description\n2026-01-02,-10.00,UPI-1\n");
  assert.equal(signed[0]?.amount, "10.00");
  assert.equal(signed[0]?.direction, "OUT");
});

test("a text PDF keeps page order and a textless PDF is not parsed", async () => {
  const rows = await extractPdf(textPdf("01/01/2026 UPI RENT 100.00 500.00"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.description, "UPI RENT");
  assert.equal(rows[0]?.amount, "100.00");
  assert.equal(rows[0]?.evidence.page_number, 1);
  assert.equal(rows[0]?.evidence.reading_order, 1);
  assert.equal(rows[0]?.evidence.balance, "500.00");
  const textless = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
  await assert.rejects(() => extractPdf(textless), (error: unknown) => error instanceof ExtractionFailure && error.code === "SCANNED_DOCUMENT_OCR_NOT_PERMITTED");
});

test("withdrawal and deposit columns keep direction for a two-digit statement date", () => {
  const rows = rowsFromTextItems([
    { str: "Date", x: 40, y: 700 },
    { str: "Narration", x: 144, y: 700 },
    { str: "Value Dt", x: 362, y: 700 },
    { str: "Withdrawal Amt.", x: 405, y: 700 },
    { str: "Deposit Amt.", x: 491, y: 700 },
    { str: "Closing Balance", x: 564, y: 700 },
    { str: "01/04/26", x: 40, y: 680 },
    { str: "UPI RENT", x: 144, y: 680 },
    { str: "02/04/26", x: 362, y: 680 },
    { str: "1,250.00", x: 440, y: 680 },
    { str: "9,000.00", x: 600, y: 680 },
    { str: "02/04/26", x: 40, y: 660 },
    { str: "SALARY", x: 144, y: 660 },
    { str: "2,500.00", x: 520, y: 660 },
    { str: "11,500.00", x: 600, y: 660 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.txn_date, "2026-04-01");
  assert.equal(rows[0]?.direction, "OUT");
  assert.equal(rows[0]?.amount, "1250.00");
  assert.equal(rows[0]?.description, "UPI RENT");
  assert.equal(rows[0]?.evidence.balance, "9,000.00");
  assert.equal(rows[1]?.txn_date, "2026-04-02");
  assert.equal(rows[1]?.direction, "IN");
  assert.equal(rows[1]?.amount, "2500.00");
  assert.equal(rows[1]?.evidence.reading_order, 2);
});

test("an encrypted PDF rejects a missing or wrong password without keeping it", async () => {
  const secret = "secret";
  await assert.rejects(() => extractPdf(encryptedPdf), (error: unknown) => error instanceof ExtractionFailure && error.code === "PASSWORD_REJECTED" && !error.message.includes(secret));
  await assert.rejects(() => extractPdf(encryptedPdf, "wrong-password"), (error: unknown) => error instanceof ExtractionFailure && error.code === "PASSWORD_REJECTED" && !String(error).includes("wrong-password"));
  await assert.rejects(() => extractPdf(encryptedPdf, secret), (error: unknown) => error instanceof ExtractionFailure && error.code === "SCANNED_DOCUMENT_OCR_NOT_PERMITTED" && !error.message.includes(secret));
});

test("Excel reads cached values from every sheet and fails closed when a sheet is too large", () => {
  const rows = readExcel(sampleXlsx(), "XLSX");
  assert.equal(rows.length, 3);
  assert.equal(rows[0]?.evidence.sheet_name, "Savings");
  assert.equal(rows[0]?.amount, "99");
  assert.equal(rows[0]?.direction, "OUT");
  assert.equal(rows[0]?.description, "UPI RENT");
  assert.equal(rows[2]?.evidence.sheet_name, "Current");
  assert.equal(rows[2]?.direction, "IN");
  assert.equal(rows[2]?.evidence.row_index, 2);
  assert.throws(() => readExcel(sampleXlsx(), "XLSX", 1), (error: unknown) => error instanceof ExtractionFailure && error.code === "SHEET_ROW_LIMIT_EXCEEDED");

  const xls = readExcel(sampleXls(), "XLS");
  assert.equal(xls.length, 1);
  assert.equal(xls[0]?.evidence.sheet_name, "Savings");
  assert.equal(xls[0]?.description, "UPI RENT");
  assert.equal(xls[0]?.amount, "100.00");
  assert.equal(xls[0]?.direction, "OUT");
  assert.equal(xls[0]?.evidence.row_index, 2);
});

test("a complete narration row keeps parser fields and an incomplete row is not parsed", () => {
  const complete = combineParsedRow(
    { parse_status: "PARSED", fields: { upi_rrn: "1" } },
    { txn_date: "2026-01-02", amount: "10.00", direction: "OUT", description: "UPI", dateResolved: true, evidence: { source: "csv" } },
  );
  assert.equal(complete.parse_status, "PARSED");
  assert.equal((complete.fields as { upi_rrn: string }).upi_rrn, "1");
  assert.equal((complete.evidence as { source: string }).source, "csv");
  const incomplete = combineParsedRow(
    { parse_status: "PARSED" },
    { txn_date: "", amount: "10.00", direction: "", description: "UPI", dateResolved: false, evidence: { raw_date: "yesterday" } },
  );
  assert.equal(incomplete.parse_status, "PARTIAL");
  assert.equal("txn_date" in incomplete, false);
  assert.equal("direction" in incomplete, false);
});

test("Gmail mailbox parsing stays disconnected", () => {
  assert.deepEqual(gmailMailboxParsing(), { connected: false });
  const source = readFileSync(new URL("../src/ingestion/gmail.ts", import.meta.url), "utf8");
  assert.equal(source.includes("import "), false);
  assert.equal(/google|fetch\(|https?|token|xmlhttprequest/i.test(source), false);
});

function textPdf(line: string): Buffer {
  const stream = `BT /F1 12 Tf 36 100 Td (${line}) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += object;
  }
  const xref = Buffer.byteLength(pdf);
  let trailer = "xref\n0 6\n0000000000 65535 f \n";
  for (let index = 1; index <= 5; index += 1) {
    trailer += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  trailer += `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf + trailer);
}

function sampleXlsx(): Buffer {
  const sheet = (cells: string) => `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${cells}</sheetData></worksheet>`;
  const files = {
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Savings" sheetId="1" r:id="rId1"/><sheet name="Current" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(sheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="inlineStr"><is><t>Narration</t></is></c><c r="C1" t="inlineStr"><is><t>Debit</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>01/02/2026</t></is></c><c r="B2" t="inlineStr"><is><t>UPI RENT</t></is></c><c r="C2"><f>1+1</f><v>99</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>03/02/2026</t></is></c><c r="B3" t="inlineStr"><is><t>ATM</t></is></c><c r="C3"><v>10</v></c></row>`)),
    "xl/worksheets/sheet2.xml": strToU8(sheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="inlineStr"><is><t>Narration</t></is></c><c r="C1" t="inlineStr"><is><t>Credit</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>2026-03-04</t></is></c><c r="B2" t="inlineStr"><is><t>SALARY</t></is></c><c r="C2"><v>250.50</v></c></row>`)),
  };
  return Buffer.from(zipSync(files));
}

function sampleXls(): Buffer {
  const sheet = Buffer.concat([
    biff(0x0809, u16(0x0600, 0x0010, 0, 0, 0, 0, 0, 0)),
    label(0, 0, "Date"),
    label(0, 1, "Narration"),
    label(0, 2, "Debit"),
    label(1, 0, "01/01/2026"),
    label(1, 1, "UPI RENT"),
    label(1, 2, "100.00"),
    biff(0x000a, Buffer.alloc(0)),
  ]);
  const offset = biff(0x0809, u16(0x0600, 0x0005, 0, 0, 0, 0, 0, 0)).length + boundsheet(0, "Savings").length + biff(0x000a, Buffer.alloc(0)).length;
  const workbook = Buffer.concat([
    biff(0x0809, u16(0x0600, 0x0005, 0, 0, 0, 0, 0, 0)),
    boundsheet(offset, "Savings"),
    biff(0x000a, Buffer.alloc(0)),
    sheet,
  ]);
  return compound(workbook);
}

function compound(workbook: Buffer): Buffer {
  const header = Buffer.alloc(512, 0);
  header.writeUInt32LE(0xe011cfd0, 0);
  header.writeUInt32LE(0xe11ab1a1, 4);
  header.writeUInt16LE(0x003e, 0x18);
  header.writeUInt16LE(0x0003, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(1, 0x2c);
  header.writeUInt32LE(1, 0x30);
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(2, 0x3c);
  header.writeUInt32LE(1, 0x40);
  header.writeUInt32LE(0xfffffffe, 0x44);
  header.writeUInt32LE(0, 0x4c);
  for (let index = 1; index < 109; index += 1) {
    header.writeUInt32LE(0xffffffff, 0x4c + index * 4);
  }
  const fat = Buffer.alloc(512, 0xff);
  fat.writeUInt32LE(0xfffffffd, 0);
  fat.writeUInt32LE(0xfffffffe, 4);
  fat.writeUInt32LE(0xfffffffe, 8);
  fat.writeUInt32LE(0xfffffffe, 12);
  const directory = Buffer.alloc(512, 0);
  writeEntry(directory, 0, "Root Entry", 5, 1, 3, 512);
  writeEntry(directory, 1, "Workbook", 2, 0xffffffff, 0, workbook.length);
  const miniFat = Buffer.alloc(512, 0xff);
  const miniSectors = Math.ceil(workbook.length / 64);
  for (let index = 0; index < miniSectors; index += 1) {
    miniFat.writeUInt32LE(index + 1 === miniSectors ? 0xfffffffe : index + 1, index * 4);
  }
  const miniStream = Buffer.alloc(512, 0);
  workbook.copy(miniStream);
  return Buffer.concat([header, fat, directory, miniFat, miniStream]);
}

function writeEntry(directory: Buffer, index: number, name: string, kind: number, child: number, start: number, size: number): void {
  const entry = directory.subarray(index * 128, index * 128 + 128);
  const encoded = Buffer.from(`${name}\u0000`, "utf16le");
  encoded.copy(entry, 0);
  entry.writeUInt16LE(encoded.length, 0x40);
  entry.writeUInt8(kind, 0x42);
  entry.writeUInt8(1, 0x43);
  entry.writeUInt32LE(0xffffffff, 0x44);
  entry.writeUInt32LE(0xffffffff, 0x48);
  entry.writeUInt32LE(child, 0x4c);
  entry.writeUInt32LE(start, 0x74);
  entry.writeUInt32LE(size, 0x78);
}

function boundsheet(offset: number, name: string): Buffer {
  const chars = Buffer.from(name, "latin1");
  const data = Buffer.alloc(8 + chars.length);
  data.writeUInt32LE(offset, 0);
  data.writeUInt8(name.length, 6);
  chars.copy(data, 8);
  return biff(0x0085, data);
}

function label(row: number, col: number, text: string): Buffer {
  const chars = Buffer.from(text, "latin1");
  const data = Buffer.alloc(9 + chars.length);
  data.writeUInt16LE(row, 0);
  data.writeUInt16LE(col, 2);
  data.writeUInt16LE(text.length, 6);
  chars.copy(data, 9);
  return biff(0x0204, data);
}

function biff(type: number, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(type, 0);
  header.writeUInt16LE(data.length, 2);
  return Buffer.concat([header, data]);
}

function u16(...values: number[]): Buffer {
  const data = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => data.writeUInt16LE(value, index * 2));
  return data;
}
