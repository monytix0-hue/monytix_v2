import net from "node:net";
import pg from "pg";
import type { ObjectStorage } from "./storage.js";

export async function scanBuffer(host: string, port: number, body: Buffer): Promise<"CLEAN" | "INFECTED"> {
  const response = await new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, host);
    socket.setTimeout(5000, () => {
      socket.destroy(new Error("clamav timed out"));
    });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("error", reject);
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.write("zINSTREAM\0");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    socket.write(length);
    socket.write(body);
    socket.write(Buffer.alloc(4));
    socket.end();
  });
  if (response.includes("FOUND")) {
    return "INFECTED";
  }
  if (response.includes("OK")) {
    return "CLEAN";
  }
  throw new Error("clamav returned an unrecognized result");
}

export async function runScanOnce(databaseUrl: string, storage: ObjectStorage, host: string, port: number): Promise<boolean> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const claim = await client.query<{ result: { outcome: string; outbox_event_id?: string; payload?: { source_document_id: string; object_key: string } } }>(
      "SELECT ops.claim_import_scan() AS result",
    );
    const job = claim.rows[0]?.result;
    if (!job || job.outcome !== "claimed" || !job.outbox_event_id || !job.payload) {
      return false;
    }
    try {
      const object = await storage.readObject(job.payload.object_key);
      if (!object) {
        throw new Error("sealed object missing");
      }
      const verdict = await scanBuffer(host, port, object.body);
      await client.query("SELECT ops.record_statement_scan($1::uuid, $2)", [job.payload.source_document_id, verdict]);
      if (verdict === "INFECTED") {
        await storage.deleteObject(job.payload.object_key);
        await client.query("SELECT ops.mark_statement_object_deleted($1::uuid)", [job.payload.source_document_id]);
      }
      if (verdict === "CLEAN") {
        await client.query("SELECT ops.enqueue_statement_extraction($1::uuid)", [job.payload.source_document_id]);
      }
      await client.query("SELECT ops.finish_import_scan($1::uuid, true, NULL)", [job.outbox_event_id]);
    } catch (error) {
      await client.query("SELECT ops.record_statement_scan($1::uuid, 'ERROR')", [job.payload.source_document_id]);
      await client.query("SELECT ops.finish_import_scan($1::uuid, false, $2)", [
        job.outbox_event_id,
        error instanceof Error ? error.message : "scan failed",
      ]);
    }
    return true;
  } finally {
    await client.end();
  }
}

export async function sweepRetention(databaseUrl: string, storage: ObjectStorage, abandonedHours: number, retentionDays: number): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const expired = await client.query<{ source_document_id: string; object_key: string }>(
      "SELECT * FROM ops.expire_abandoned_uploads($1::int)",
      [abandonedHours],
    );
    for (const row of expired.rows) {
      if (row.object_key) {
        await storage.deleteObject(row.object_key);
      }
    }
    const due = await client.query<{ source_document_id: string; object_key: string }>(
      "SELECT * FROM ops.retention_due_statements($1::int)",
      [retentionDays],
    );
    for (const row of due.rows) {
      if (!row.object_key) {
        continue;
      }
      await storage.deleteObject(row.object_key);
      await client.query("SELECT ops.mark_statement_object_deleted($1::uuid)", [row.source_document_id]);
    }
  } finally {
    await client.end();
  }
}
