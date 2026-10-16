import pg from "pg";
import { identifyBank } from "../gmail/pipeline.js";
import { readStatementCsv } from "../ingestion/csv.js";
import { ExtractionFailure } from "../ingestion/failure.js";
import { overlayParsedNarration } from "../ingestion/bank-narration.js";
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
      const parsed = await parseStatementRows(client, job.payload.source_document_id, rows);
      const saved = await client.query<{ result: { outcome: string; extraction_run_id?: string; status?: string } }>(
        "SELECT ops.save_statement_extraction($1::uuid, $2, $3::jsonb, NULL, NULL) AS result",
        [job.payload.source_document_id, actualHash, JSON.stringify(parsed)],
      );
      const extraction = saved.rows[0]?.result;
      if (extraction?.outcome === "created" && extraction.status !== "FAILED" && extraction.extraction_run_id) {
        await mapBoundExtraction(client, job.payload.source_document_id, extraction.extraction_run_id);
      } else if (extraction?.outcome === "replay" && extraction.extraction_run_id) {
        await mapBoundExtraction(client, job.payload.source_document_id, extraction.extraction_run_id);
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

async function mapBoundExtraction(client: pg.Client, documentId: string, extractionRunId: string): Promise<void> {
  const context = await documentContext(client, documentId);
  if (context.pipeline && context.pipeline !== "BANKING") {
    return;
  }
  await client.query("SELECT ops.bind_statement_for_mapping($1::uuid)", [documentId]);
  await client.query("SELECT ops.map_statement_extraction($1::uuid)", [extractionRunId]);
  await client.query("SELECT ops.publish_structure_extraction_run($1::uuid)", [extractionRunId]);
  await client.query("SELECT ops.interpret_extraction_run($1::uuid)", [extractionRunId]);
  await client.query("SELECT ops.resolve_extraction_run($1::uuid)", [extractionRunId]);
  await client.query("SELECT ops.resolve_party_extraction_run($1::uuid)", [extractionRunId]);
  await client.query("SELECT ops.apply_import_categories($1::uuid)", [extractionRunId]);
}

async function parseStatementRows(client: pg.Client, documentId: string, rows: StatementRow[]): Promise<Record<string, unknown>[]> {
  const context = await documentContext(client, documentId);
  const bank = identifyBank(context.filename, context.sender);
  const parsed = [];
  for (const row of rows) {
    const result = await client.query<{ parsed: Record<string, unknown> }>(
      "SELECT spendsense.parse_narration_v4($1, $2, $3) AS parsed",
      [row.description, row.direction, bank],
    );
    parsed.push(combineParsedRow(overlayParsedNarration(row.description, result.rows[0].parsed ?? {}, bank), row));
  }
  return parsed;
}

async function documentContext(client: pg.Client, documentId: string): Promise<{ filename: string; sender: string; pipeline: string | null }> {
  const result = await client.query<{ filename: string | null; sender: string | null; pipeline: string | null }>(
    `SELECT original_filename AS filename,
            metadata #>> '{source_metadata,sender}' AS sender,
            metadata #>> '{source_metadata,pipeline_target}' AS pipeline
       FROM core.source_document
      WHERE source_document_id = $1`,
    [documentId],
  );
  return {
    filename: result.rows[0]?.filename ?? "",
    sender: result.rows[0]?.sender ?? "",
    pipeline: result.rows[0]?.pipeline ?? null,
  };
}

export type StatementOpenTarget = {
  sourceDocumentId: string;
  objectKey: string;
  sha256: string;
  fileType: string;
};

export async function openStatementWithPassword(
  databaseUrl: string,
  storage: ObjectStorage,
  target: StatementOpenTarget,
  statementPassword: string,
): Promise<"opened" | "replay" | "password_rejected" | "failed"> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("SELECT ops.discard_password_rejected_extraction($1::uuid)", [target.sourceDocumentId]);
    const object = await storage.readObject(target.objectKey);
    if (!object) {
      return "failed";
    }
    const actualHash = sha256Hex(object.body);
    if (actualHash !== target.sha256) {
      await client.query("SELECT ops.save_statement_extraction($1::uuid, $2, '[]'::jsonb, 'OBJECT_TAMPERED', NULL)", [
        target.sourceDocumentId,
        actualHash,
      ]);
      return "failed";
    }
    let rows: StatementRow[];
    try {
      rows = await extractStatementRows(target.fileType, object.body, statementPassword);
    } catch (error) {
      if (error instanceof ExtractionFailure && error.code === "PASSWORD_REJECTED") {
        await client.query("SELECT ops.save_statement_extraction($1::uuid, $2, '[]'::jsonb, 'PASSWORD_REJECTED', NULL)", [
          target.sourceDocumentId,
          actualHash,
        ]);
        return "password_rejected";
      }
      const code = error instanceof ExtractionFailure
        ? error.code
        : error instanceof Error && error.message === "invalid statement structure"
          ? "INVALID_STRUCTURE"
          : null;
      if (!code) {
        throw error;
      }
      await client.query("SELECT ops.save_statement_extraction($1::uuid, $2, '[]'::jsonb, $3, NULL)", [
        target.sourceDocumentId,
        actualHash,
        code,
      ]);
      return "failed";
    }
    const parsed = await parseStatementRows(client, target.sourceDocumentId, rows);
    const saved = await client.query<{ result: { outcome: string; extraction_run_id?: string; status?: string } }>(
      "SELECT ops.save_statement_extraction($1::uuid, $2, $3::jsonb, NULL, NULL) AS result",
      [target.sourceDocumentId, actualHash, JSON.stringify(parsed)],
    );
    const extraction = saved.rows[0]?.result;
    if (extraction?.extraction_run_id && (extraction.outcome === "replay" || (extraction.outcome === "created" && extraction.status !== "FAILED"))) {
      await mapBoundExtraction(client, target.sourceDocumentId, extraction.extraction_run_id);
      if (extraction.outcome === "replay") {
        return "replay";
      }
    }
    return extraction?.status === "FAILED" ? "failed" : "opened";
  } finally {
    await client.end();
  }
}
