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

type MimePart = { headers: Map<string, string>; body: string };

export function extractMimeMessage(input: {
  ownerId: string;
  gmailConnectionId: string;
  gmailMessageId: string;
  raw: string;
}): { candidates: MessageCandidate[]; handoffs: ExtractedHandoff[]; texts: ExtractedText[] } {
  const candidates: MessageCandidate[] = [];
  const handoffs: ExtractedHandoff[] = [];
  const texts: ExtractedText[] = [];
  let partIndex = 0;

  const visit = (raw: string, depth = 0): void => {
    // Pathological / self-referential multipart trees used to blow the call stack mid-poll.
    if (depth > 32) {
      return;
    }
    const parts = splitParts(raw);
    for (const part of parts) {
      const mime = mimeType(part.headers);
      if (mime.startsWith("multipart/")) {
        const nested = reconstructPart(part);
        if (nested === raw) {
          continue;
        }
        visit(nested, depth + 1);
        continue;
      }
      const body = decodeBody(part.headers, part.body);
      const index = partIndex;
      partIndex += 1;
      if (mime === "text/plain" || mime === "text/html") {
        candidates.push({
          ownerId: input.ownerId,
          gmailConnectionId: input.gmailConnectionId,
          gmailMessageId: input.gmailMessageId,
          partIndex: index,
          mimeType: mime,
          contentSha256: sha256(body),
          provenance: {
            gmail_message_id: input.gmailMessageId,
            part_index: index,
            mime_type: mime,
          },
        });
        texts.push({ partIndex: index, mimeType: mime, text: body.toString("utf8") });
        continue;
      }
      const named = filenameOf(Object.fromEntries(part.headers));
      const fileType = statementTypes[mime] ?? fileTypeFromName(named ?? "");
      if (!fileType) {
        continue;
      }
      const filename = named || `statement.${fileType.toLowerCase()}`;
      handoffs.push({
        ownerId: input.ownerId,
        gmailConnectionId: input.gmailConnectionId,
        gmailMessageId: input.gmailMessageId,
        partIndex: index,
        fileType,
        byteSize: body.length,
        sha256: sha256(body),
        originalFilename: filename,
        provenance: {
          gmail_message_id: input.gmailMessageId,
          part_index: index,
          mime_type: mime,
          original_filename: filename,
        },
        bytes: body,
      });
    }
  };

  visit(input.raw);
  return { candidates, handoffs, texts };
}

export function messageFrom(raw: string): string {
  const head = raw.split(/\r?\n\r?\n/)[0] ?? "";
  return head.match(/^from:\s*(.+)$/im)?.[1]?.trim() ?? "";
}

/** Unfolded Subject header, with RFC 2047 encoded words decoded. */
export function messageSubject(raw: string): string {
  const head = (raw.split(/\r?\n\r?\n/)[0] ?? "").replace(/\r?\n[ \t]+/g, " ");
  const value = head.match(/^subject:\s*(.*)$/im)?.[1]?.trim() ?? "";
  return decodeMimeWords(value).replace(/\s+/g, " ").trim();
}

function decodeMimeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([\s\S]*?)\?=/g, (_match, _charset: string, encoding: string, text: string) => {
    if (encoding.toLowerCase() === "b") {
      return Buffer.from(text, "base64").toString("utf8");
    }
    return text
      .replace(/_/g, " ")
      .replace(/=([0-9A-Fa-f]{2})/g, (_hexMatch, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  });
}

export function messageDate(raw: string): string | undefined {
  const head = raw.split(/\r?\n\r?\n/)[0] ?? "";
  const value = head.match(/^date:\s*(.+)$/im)?.[1]?.trim();
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
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

function reconstructPart(part: MimePart): string {
  const headerLines = [...part.headers.entries()].map(([key, value]) => `${key}: ${value}`).join("\r\n");
  return `${headerLines}\r\n\r\n${part.body}`;
}

function splitParts(raw: string): MimePart[] {
  const boundary = raw.match(/boundary="?([^";\r\n]+)"?/i)?.[1];
  if (!boundary) {
    const splitAt = raw.search(/\r?\n\r?\n/);
    const headerText = splitAt >= 0 ? raw.slice(0, splitAt) : raw;
    const body = splitAt >= 0 ? raw.slice(splitAt).replace(/^\r?\n\r?\n/, "") : "";
    const headers = parseHeaders(headerText);
    return headers.size > 0 ? [{ headers, body: body.trim() }] : [];
  }
  const chunks = raw.split(new RegExp(`--${escapeRegExp(boundary)}`)).slice(1, -1);
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

export function filenameOf(headers: Record<string, string | undefined>): string | undefined {
  const disposition = headers["content-disposition"] ?? "";
  const contentType = headers["content-type"] ?? "";
  return extractParam(disposition, "filename") ?? extractParam(contentType, "name");
}

function extractParam(header: string, param: "filename" | "name"): string | undefined {
  if (!header) {
    return undefined;
  }
  const quoted = header.match(new RegExp(`${param}\\*?=["']([^"']+)["']`, "i"));
  if (quoted?.[1]) {
    return quoted[1].trim();
  }
  const unquoted = header.match(new RegExp(`${param}\\*?=([^;\\s]+)`, "i"));
  if (unquoted?.[1]) {
    return unquoted[1].trim();
  }
  return undefined;
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
