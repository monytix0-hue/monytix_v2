import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { redactGmailLog } from "../src/gmail/log.js";
import { extractMimeMessage, importInitiation } from "../src/gmail/mime.js";
import { MemoryGmailStore } from "../src/gmail/store.js";
import { HistoryExpired, HistoryRetry, runHistoryOnce, type GmailHistoryClient, type HistoryPage } from "../src/gmail/worker.js";

test("history worker paginates, retries, and checkpoints only after durable work", async () => {
  const store = preparedStore();
  const connection = store.connectionForTest();
  const pages: HistoryPage[] = [
    { historyId: "15", messageIds: ["m1"], nextPageToken: "page-2" },
    { historyId: "15", messageIds: ["m2"] },
  ];
  let calls = 0;
  const client: GmailHistoryClient = {
    async listHistory() {
      calls += 1;
      if (calls === 2) {
        throw new HistoryRetry();
      }
      return pages[calls === 1 ? 0 : 1];
    },
  };
  const logs: unknown[] = [];
  const first = await runHistoryOnce({
    store,
    client,
    gmailConnectionId: connection.gmailConnectionId,
    ownerId: connection.ownerId,
    now: 1_000,
    log: (event) => logs.push(event),
  });
  assert.equal(first.outcome, "retry");
  assert.equal(first.delayMs, 1000);
  assert.equal(store.connection(connection.gmailConnectionId, connection.ownerId).historyCheckpoint, "10");

  const early = await runHistoryOnce({
    store,
    client,
    gmailConnectionId: connection.gmailConnectionId,
    ownerId: connection.ownerId,
    now: 1_500,
  });
  assert.equal(early.outcome, "idle");

  const second = await runHistoryOnce({
    store,
    client,
    gmailConnectionId: connection.gmailConnectionId,
    ownerId: connection.ownerId,
    now: 2_000,
    log: (event) => logs.push(event),
  });
  assert.equal(second.outcome, "synced");
  assert.equal(store.connection(connection.gmailConnectionId, connection.ownerId).historyCheckpoint, "15");
  assert.equal(JSON.stringify(logs).includes(connection.credentialRef), false);
});

test("an expired history id marks a full resync and does not skip ahead", async () => {
  const store = preparedStore();
  const connection = store.connectionForTest();
  let calls = 0;
  const client: GmailHistoryClient = {
    async listHistory() {
      calls += 1;
      throw new HistoryExpired();
    },
  };
  const expired = await runHistoryOnce({
    store,
    client,
    gmailConnectionId: connection.gmailConnectionId,
    ownerId: connection.ownerId,
    now: 1_000,
  });
  assert.equal(expired.outcome, "resync");
  assert.equal(store.connection(connection.gmailConnectionId, connection.ownerId).historyCheckpoint, "10");
  assert.equal(store.connection(connection.gmailConnectionId, connection.ownerId).syncState, "RESYNC_REQUIRED");
  const again = await runHistoryOnce({
    store,
    client,
    gmailConnectionId: connection.gmailConnectionId,
    ownerId: connection.ownerId,
    now: 2_000,
  });
  assert.equal(again.outcome, "resync");
  assert.equal(calls, 1);
});

test("one connection lock is held at a time", async () => {
  const store = preparedStore();
  const connection = store.connectionForTest();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  const client: GmailHistoryClient = {
    async listHistory() {
      started = true;
      await gate;
      return { historyId: "15", messageIds: ["m1"] };
    },
  };
  const first = runHistoryOnce({
    store,
    client,
    gmailConnectionId: connection.gmailConnectionId,
    ownerId: connection.ownerId,
    now: 1_000,
  });
  await waitFor(() => started);
  const second = await runHistoryOnce({
    store,
    client,
    gmailConnectionId: connection.gmailConnectionId,
    ownerId: connection.ownerId,
    now: 1_000,
  });
  assert.equal(second.outcome, "locked");
  release?.();
  assert.equal((await first).outcome, "synced");
});

test("email text stays a candidate and statement attachments use the import shape", () => {
  const pdf = Buffer.from("%PDF-1.4 text");
  const raw = [
    "Content-Type: multipart/mixed; boundary=bound",
    "",
    "--bound",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "SELF Swiggy rent",
    "--bound",
    "Content-Type: text/html",
    "",
    "<p>SELF category obligation</p>",
    "--bound",
    "Content-Type: application/pdf; name=\"statement.pdf\"",
    "Content-Disposition: attachment; filename=\"statement.pdf\"",
    "Content-Transfer-Encoding: base64",
    "",
    pdf.toString("base64"),
    "--bound--",
    "",
  ].join("\r\n");
  const extracted = extractMimeMessage({
    ownerId: "owner-a",
    gmailConnectionId: "connection-a",
    gmailMessageId: "m1",
    raw,
  });
  assert.equal(extracted.candidates.length, 2);
  assert.deepEqual(extracted.candidates.map((row) => row.mimeType), ["text/plain", "text/html"]);
  const serialized = JSON.stringify(extracted);
  assert.equal(serialized.includes("SELF"), false);
  assert.equal(serialized.includes("Swiggy"), false);
  assert.equal(serialized.includes("obligation"), false);
  assert.equal(serialized.includes("logical_transaction"), false);
  assert.equal(extracted.handoffs.length, 1);
  assert.equal(extracted.handoffs[0]?.fileType, "PDF");
  assert.equal(extracted.handoffs[0]?.sha256, createHash("sha256").update(pdf).digest("hex"));
  assert.equal(extracted.handoffs[0]?.provenance.gmail_message_id, "m1");
  const initiation = importInitiation(extracted.handoffs[0]!);
  assert.equal(initiation.file_type, "PDF");
  assert.equal(initiation.original_filename, "statement.pdf");
  assert.equal("merchant" in initiation, false);
  const redacted = JSON.stringify(redactGmailLog({
    credentialRef: "projects/monytix/secrets/gmail-owner-a",
    messageBody: "SELF Swiggy rent",
    event: "candidate",
  }));
  assert.equal(redacted.includes("projects/monytix/secrets/gmail-owner-a"), false);
  assert.equal(redacted.includes("SELF Swiggy rent"), false);
  const workerSource = readFileSync(new URL("../src/gmail/worker.ts", import.meta.url), "utf8")
    + readFileSync(new URL("../src/gmail/mime.ts", import.meta.url), "utf8");
  assert.equal(workerSource.includes("googleapis"), false);
  assert.equal(workerSource.includes("logical_transaction"), false);
});

function preparedStore(): MemoryGmailStore & { connectionForTest(): ReturnType<MemoryGmailStore["insertConnection"]> } {
  const store = new MemoryGmailStore();
  const connection = store.insertConnection({
    ownerId: "owner-a",
    sourceConnectionId: "00000000-0000-4000-8000-000000000001",
    mailboxAddress: "owner@example.com",
    credentialRef: "projects/monytix/secrets/gmail-owner-a",
  });
  store.recordNotification({
    ownerId: connection.ownerId,
    gmailConnectionId: connection.gmailConnectionId,
    pubsubMessageId: "baseline",
    historyId: "10",
  });
  store.recordNotification({
    ownerId: connection.ownerId,
    gmailConnectionId: connection.gmailConnectionId,
    pubsubMessageId: "next",
    historyId: "15",
  });
  return Object.assign(store, { connectionForTest: () => connection });
}

async function waitFor(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (ready()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out");
}
