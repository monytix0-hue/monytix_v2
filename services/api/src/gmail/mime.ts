import { createHash } from "node:crypto";
import type { AttachmentHandoff, MessageCandidate } from "./model.js";

const statementTypes: Record<string, AttachmentHandoff["fileType"]> = {
  "application/pdf": "PDF",
  "text/csv": "CSV",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
};

export type ExtractedHandoff = AttachmentHandoff & { bytes: Buffer };

export type ExtractedText = {
  partIndex: number;
  mimeType: "text/plain" | "text/html";
  text: string;
};

export function extractMimeMessage(input: {
  ownerId: string;
  gmailConnectionId: string;
  gmailMessageId: string;
  raw: string;
}): { candidates: MessageCandidate[]; handoffs: ExtractedHandoff[]; texts: ExtractedText[] } {
  const parts = splitParts(input.raw);
  const candidates: MessageCandidate[] = [];
  const handoffs: ExtractedHandoff[] = [];
  const texts: ExtractedText[] = [];
  parts.forEach((part, partIndex) => {
    const mime = mimeType(part.headers);
    const body = decodeBody(part.headers, part.body);
    if (mime === "text/plain" || mime === "text/html") {
      candidates.push({
        ownerId: input.ownerId,
        gmailConnectionId: input.gmailConnectionId,
        gmailMessageId: input.gmailMessageId,
        partIndex,
        mimeType: mime,
        contentSha256: sha256(body),
        provenance: {
          gmail_message_id: input.gmailMessageId,
          part_index: partIndex,
          mime_type: mime,
        },
      });
      texts.push({ partIndex, mimeType: mime, text: body.toString("utf8") });
      return;
    }
    const fileType = statementTypes[mime] ?? fileTypeFromName(filenameOf(part.headers));
    if (!fileType) {
      return;
    }
    const filename = filenameOf(part.headers) || `statement.${fileType.toLowerCase()}`;
    handoffs.push({
      ownerId: input.ownerId,
      gmailConnectionId: input.gmailConnectionId,
      gmailMessageId: input.gmailMessageId,
      partIndex,
      fileType,
      byteSize: body.length,
      sha256: sha256(body),
      originalFilename: filename,
      provenance: {
        gmail_message_id: input.gmailMessageId,
        part_index: partIndex,
        mime_type: mime,
        original_filename: filename,
      },
      bytes: body,
    });
  });
  return { candidates, handoffs, texts };
}

export function messageFrom(raw: string): string {
  const head = raw.split(/\r?\n\r?\n/)[0] ?? "";
  return head.match(/^from:\s*(.+)$/im)?.[1]?.trim() ?? "";
}

export function importInitiation(handoff: AttachmentHandoff): {
  file_type: AttachmentHandoff["fileType"];
  byte_size: number;
  sha256: string;
  original_filename: string;
  source_metadata: Record<string, unknown>;
} {
  return {
    file_type: handoff.fileType,
    byte_size: handoff.byteSize,
    sha256: handoff.sha256,
    original_filename: handoff.originalFilename,
    source_metadata: { channel: "gmail", ...handoff.provenance },
  };
}

function splitParts(raw: string): { headers: Map<string, string>; body: string }[] {
  const boundary = raw.match(/boundary="?([^";\r\n]+)"?/i)?.[1];
  const chunks = boundary ? raw.split(new RegExp(`--${escapeRegExp(boundary)}`)).slice(1, -1) : [raw];
  return chunks.map((chunk) => {
    const trimmed = chunk.replace(/^\r?\n/, "");
    const splitAt = trimmed.search(/\r?\n\r?\n/);
    const headerText = splitAt >= 0 ? trimmed.slice(0, splitAt) : trimmed;
    const body = splitAt >= 0 ? trimmed.slice(splitAt).replace(/^\r?\n\r?\n/, "") : "";
    return { headers: parseHeaders(headerText), body: body.trim() };
  }).filter((part) => part.headers.size > 0);
}

function parseHeaders(text: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index < 0) {
      continue;
    }
    headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
  }
  return headers;
}

function mimeType(headers: Map<string, string>): string {
  return (headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
}

function filenameOf(headers: Map<string, string>): string {
  const source = `${headers.get("content-disposition") ?? ""} ${headers.get("content-type") ?? ""}`;
  return source.match(/filename="?([^";]+)"?/i)?.[1]?.trim() ?? "";
}

function fileTypeFromName(filename: string): AttachmentHandoff["fileType"] | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "PDF";
  if (lower.endsWith(".csv")) return "CSV";
  if (lower.endsWith(".xlsx")) return "XLSX";
  if (lower.endsWith(".xls")) return "XLS";
  return null;
}

function decodeBody(headers: Map<string, string>, body: string): Buffer {
  const encoding = (headers.get("content-transfer-encoding") ?? "").toLowerCase();
  if (encoding === "base64") {
    return Buffer.from(body.replace(/\s/g, ""), "base64");
  }
  return Buffer.from(body, "utf8");
}

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
