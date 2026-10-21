import type { KeyMaterialClient } from "./app.js";
import { ExtractError, type PdfExtractor } from "./extract.js";
import type { QueueClient } from "./queue.js";
import type { InboundRecord, Normalized } from "./types.js";
import type { IntelligenceClient } from "./worker.js";

export { ExtractError, type PdfExtractor };

export function httpIntelligence(baseUrl: string, token: string): IntelligenceClient & KeyMaterialClient & QueueClient & PdfExtractor {
  return {
    async normalize(record: InboundRecord): Promise<Normalized> {
      const response = await fetch(`${baseUrl}/internal/normalize`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(record),
      });
      if (!response.ok) throw new Error("normalize_failed");
      return await response.json() as Normalized;
    },
    async issue() {
      const response = await fetch(`${baseUrl}/internal/aa/key-material`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("key_material_failed");
      return await response.json() as { our_nonce: string; key_material: unknown };
    },
    async enqueue(input) {
      const response = await fetch(`${baseUrl}/internal/enqueue`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("enqueue_failed");
    },
    async extractPdf(bytes: Buffer, password?: string | null) {
      const response = await fetch(`${baseUrl}/internal/extract-pdf`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ pdf_base64: bytes.toString("base64"), password: password ?? null }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { detail?: { error?: string } };
        throw new ExtractError(failure.detail?.error ?? "extract_failed");
      }
      const payload = await response.json() as { raw_text?: string };
      if (!payload.raw_text) throw new ExtractError("SCANNED_DOCUMENT_OCR_NOT_PERMITTED");
      return payload.raw_text;
    },
  };
}
