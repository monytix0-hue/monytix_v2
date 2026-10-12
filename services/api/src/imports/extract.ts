import pg from "pg";
import { sha256Hex, type ObjectStorage } from "./storage.js";

type StatementRow = {
  txn_date: string;
  amount: string;
  direction: string;
  description: string;
};

type Claim = {
  outcome: string;
  outbox_event_id?: string;
  payload?: {
    source_document_id: string;
    object_key: string;
    sha256: string;
    file_type: string;
  };
};

export function readStatementCsv(text: string): StatementRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("invalid statement structure");
  }
  const headers = lines[0].split(",").map((header) => header.trim().toLowerCase());
  const descriptionIndex = headers.indexOf("description");
  if (descriptionIndex < 0) {
    throw new Error("invalid statement structure");
  }
  const dateIndex = headers.indexOf("txn_date");
  const amountIndex = headers.indexOf("amount");
  const directionIndex = headers.indexOf("direction");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return {
      txn_date: dateIndex >= 0 ? cells[dateIndex]?.trim() ?? "" : "",
      amount: amountIndex >= 0 ? cells[amountIndex]?.trim() ?? "" : "",
      direction: directionIndex >= 0 ? cells[directionIndex]?.trim() ?? "" : "",
      description: cells[descriptionIndex]?.trim() ?? "",
    };
  });
}

export async function runExtractOnce(databaseUrl: string, storage: ObjectStorage): Promise<boolean> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const claim = await client.query<{ result: Claim }>("SELECT ops.claim_statement_extraction() AS result");
    const job = claim.rows[0]?.result;
    if (!job || job.outcome !== "claimed" || !job.outbox_event_id || !job.payload) {
      return false;
    }
    try {
      const object = await storage.readObject(job.payload.object_key);
      if (!object) {
        await client.query("SELECT ops.finish_statement_extraction($1::uuid, false, $2)", [job.outbox_event_id, "object missing"]);
        return true;
      }
      const actualHash = sha256Hex(object.body);
      if (actualHash !== job.payload.sha256) {
        await client.query("SELECT ops.save_statement_extraction($1::uuid, $2, '[]'::jsonb, 'OBJECT_TAMPERED', NULL)", [
          job.payload.source_document_id,
          actualHash,
        ]);
        await client.query("SELECT ops.finish_statement_extraction($1::uuid, true, NULL)", [job.outbox_event_id]);
        return true;
      }
      if (job.payload.file_type !== "CSV") {
        await client.query("SELECT ops.save_statement_extraction($1::uuid, $2, '[]'::jsonb, 'UNSUPPORTED_FILE_LAYOUT', NULL)", [
          job.payload.source_document_id,
          actualHash,
        ]);
        await client.query("SELECT ops.finish_statement_extraction($1::uuid, true, NULL)", [job.outbox_event_id]);
        return true;
      }
      let rows: StatementRow[];
      try {
        rows = readStatementCsv(object.body.toString("utf8"));
      } catch {
        await client.query("SELECT ops.save_statement_extraction($1::uuid, $2, '[]'::jsonb, 'INVALID_STRUCTURE', NULL)", [
          job.payload.source_document_id,
          actualHash,
        ]);
        await client.query("SELECT ops.finish_statement_extraction($1::uuid, true, NULL)", [job.outbox_event_id]);
        return true;
      }
      const parsed = [];
      for (const row of rows) {
        const result = await client.query<{ parsed: Record<string, unknown> }>(
          "SELECT spendsense.parse_narration_v4($1, $2) AS parsed",
          [row.description, row.direction],
        );
        const parsedRow = result.rows[0].parsed;
        parsed.push({
          ...parsedRow,
          description: row.description,
          txn_date: row.txn_date,
          amount: row.amount,
        });
      }
      const saved = await client.query<{ result: { outcome: string; extraction_run_id?: string; status?: string } }>(
        "SELECT ops.save_statement_extraction($1::uuid, $2, $3::jsonb, NULL, NULL) AS result",
        [job.payload.source_document_id, actualHash, JSON.stringify(parsed)],
      );
      const extraction = saved.rows[0]?.result;
      if (extraction?.outcome === "created" && extraction.status !== "FAILED" && extraction.extraction_run_id) {
        await client.query("SELECT ops.map_statement_extraction($1::uuid)", [extraction.extraction_run_id]);
        await client.query("SELECT ops.publish_structure_extraction_run($1::uuid)", [extraction.extraction_run_id]);
        await client.query("SELECT ops.interpret_extraction_run($1::uuid)", [extraction.extraction_run_id]);
        await client.query("SELECT ops.resolve_extraction_run($1::uuid)", [extraction.extraction_run_id]);
        await client.query("SELECT ops.resolve_party_extraction_run($1::uuid)", [extraction.extraction_run_id]);
      } else if (extraction?.outcome === "replay" && extraction.extraction_run_id) {
        await client.query("SELECT ops.publish_structure_extraction_run($1::uuid)", [extraction.extraction_run_id]);
        await client.query("SELECT ops.interpret_extraction_run($1::uuid)", [extraction.extraction_run_id]);
        await client.query("SELECT ops.resolve_extraction_run($1::uuid)", [extraction.extraction_run_id]);
        await client.query("SELECT ops.resolve_party_extraction_run($1::uuid)", [extraction.extraction_run_id]);
      }
      await client.query("SELECT ops.finish_statement_extraction($1::uuid, true, NULL)", [job.outbox_event_id]);
      return true;
    } catch (error) {
      await client.query("SELECT ops.finish_statement_extraction($1::uuid, false, $2)", [
        job.outbox_event_id,
        error instanceof Error ? error.message : "extraction failed",
      ]);
      return true;
    }
  } finally {
    await client.end();
  }
}
