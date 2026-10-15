export type SealedType = "PDF" | "XLSX" | "XLS" | "CSV";

export function detectFileType(body: Buffer): SealedType | null {
  if (body.length >= 5 && body.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "PDF";
  }
  if (
    body.length >= 8
    && body[0] === 0xd0 && body[1] === 0xcf && body[2] === 0x11 && body[3] === 0xe0
    && body[4] === 0xa1 && body[5] === 0xb1 && body[6] === 0x1a && body[7] === 0xe1
  ) {
    return "XLS";
  }
  if (body.length >= 4 && body[0] === 0x50 && body[1] === 0x4b && body[2] === 0x03 && body[3] === 0x04) {
    return "XLSX";
  }
  if (body.includes(0)) {
    return null;
  }
  const text = body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf ? body.subarray(3) : body;
  if (text.length === 0) {
    return null;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(text);
    return "CSV";
  } catch {
    return null;
  }
}
