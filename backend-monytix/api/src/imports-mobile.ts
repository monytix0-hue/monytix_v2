import { randomUUID } from "node:crypto";

export type ImportSessionState =
  | "CREATED"
  | "WAITING_PASSWORD"
  | "QUEUED"
  | "ROUTED"
  | "FAILED";

export type ImportSession = {
  import_id: string;
  owner_id: string;
  object_key: string;
  filename: string;
  file_type: string;
  mime: string;
  sha256: string | null;
  byte_size: number | null;
  stage: string;
  state: ImportSessionState;
  parser_eligible: boolean;
  extraction_failure: string | null;
  mongo_id: string | null;
  imported_transaction_count: number | null;
};

export type ImportSessionStore = {
  create(input: Omit<ImportSession, "stage" | "state" | "parser_eligible" | "extraction_failure" | "mongo_id" | "imported_transaction_count">): ImportSession;
  get(importId: string): ImportSession | null;
  update(importId: string, patch: Partial<ImportSession>): ImportSession | null;
  listPendingUnlock(ownerId: string): { import_id: string; filename: string }[];
};

export class MemoryImportSessions implements ImportSessionStore {
  private rows = new Map<string, ImportSession>();

  create(input: Omit<ImportSession, "stage" | "state" | "parser_eligible" | "extraction_failure" | "mongo_id" | "imported_transaction_count">): ImportSession {
    const row: ImportSession = {
      ...input,
      stage: "Awaiting upload",
      state: "CREATED",
      parser_eligible: false,
      extraction_failure: null,
      mongo_id: null,
      imported_transaction_count: null,
    };
    this.rows.set(row.import_id, row);
    return { ...row };
  }

  get(importId: string): ImportSession | null {
    const row = this.rows.get(importId);
    return row ? { ...row } : null;
  }

  update(importId: string, patch: Partial<ImportSession>): ImportSession | null {
    const row = this.rows.get(importId);
    if (!row) return null;
    Object.assign(row, patch);
    return { ...row };
  }

  listPendingUnlock(ownerId: string): { import_id: string; filename: string }[] {
    return [...this.rows.values()]
      .filter((row) => row.owner_id === ownerId && row.state === "WAITING_PASSWORD")
      .map((row) => ({ import_id: row.import_id, filename: row.filename }));
  }
}

export function mimeForFileType(fileType: string): string {
  switch (fileType.toUpperCase()) {
    case "PDF":
      return "application/pdf";
    case "XLSX":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "XLS":
      return "application/vnd.ms-excel";
    case "CSV":
      return "text/csv";
    default:
      return "application/octet-stream";
  }
}

export function statusEnvelope(session: ImportSession) {
  return {
    data: {
      import_id: session.import_id,
      stage: session.stage,
      parser_eligible: session.parser_eligible,
      extraction_failure: session.extraction_failure,
      extraction_status: session.state === "FAILED" ? "FAILED" : session.state === "QUEUED" || session.state === "ROUTED" ? "OK" : null,
      imported_transaction_count: session.imported_transaction_count,
      reconciliation: {
        extraction_failure: session.extraction_failure,
        mapped_count: session.imported_transaction_count,
      },
    },
  };
}

export function newImportId(): string {
  return randomUUID();
}
