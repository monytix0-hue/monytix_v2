import pg from "pg";
import { readStatementCsv } from "../ingestion/csv.js";
import { ExtractionFailure } from "../ingestion/failure.js";
import { combineParsedRow, extractStatementRows } from "../ingestion/statement.js";
import type { StatementRow } from "../ingestion/table.js";
import { sha256Hex, type ObjectStorage } from "./storage.js";

export { readStatementCsv };

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

export async function runExtractOnce(
  databaseUrl: string,
  storage: ObjectStorage,
  statementPassword?: string,
): Promise<boolean> {
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
      let rows: StatementRow[];
      try {
        rows = await extractStatementRows(job.payload.file_type, object.body, statementPassword);
      } catch (error) {
        const code = error instanceof ExtractionFailure
          ? error.code
          : error instanceof Error && error.message === "invalid statement structure"
            ? "INVALID_STRUCTURE"
            : null;
        if (!code) {
          throw error;
        }
        await client.query("SELECT ops.save_statement_extraction($1::uuid, $2, '[]'::jsonb, $3, NULL)", [
          job.payload.source_document_id,
          actualHash,
          code,
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
        parsed.push(combineParsedRow(result.rows[0].parsed, row));
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
      const message = error instanceof Error ? error.message : "extraction failed";
      await client.query("SELECT ops.finish_statement_extraction($1::uuid, false, $2)", [
        job.outbox_event_id,
        statementPassword && message.includes(statementPassword) ? "extraction failed" : message,
      ]);
      return true;
    }
  } finally {
    await client.end();
  }
}
