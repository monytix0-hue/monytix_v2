import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { detectPipelineTarget } from "../src/gmail/pipeline.js";
import { pollConnection, workerError, workerFailure, type PollFetch, type PollPorts } from "../src/gmail/poll.js";
import { readDueDate } from "../src/gmail/reminders.js";
import { sealCredential, unsealCredential } from "../src/gmail/secret.js";

test("a worker failure keeps a short code and drops anything else", () => {
  assert.deepEqual(workerFailure(workerError("gmail token refresh failed", "invalid_grant")), {
    name: "Error",
    code: "invalid_grant",
  });
  assert.deepEqual(workerFailure(new Error("1//mailbox-credential")), { name: "Error", code: "unknown" });
});

test("a sealed grant unseals to the same refresh token", () => {
  const token = "1//mailbox-credential";
  const sealed = sealCredential(token, "test-key");
  assert.equal(unsealCredential(sealed, "test-key"), token);
  assert.equal(sealed.includes(token), false);
});

test("pipeline labels use whole tokens and leave bank files on the ledger path", () => {
  assert.equal(detectPipelineTarget("cams-statement.pdf", ""), "MUTUAL_FUNDS");
  assert.equal(detectPipelineTarget("statement.pdf", "kfintech@camsonline.com"), "MUTUAL_FUNDS");
  assert.equal(detectPipelineTarget("lic-premium.pdf", ""), "INSURANCE");
  assert.equal(detectPipelineTarget("zerodha-holdings.xlsx", ""), "PORTFOLIO_CAS");
  assert.equal(detectPipelineTarget("hdfc-statement.pdf", "alerts@hdfcbank.com"), "BANKING");
  assert.equal(detectPipelineTarget("statement-premiums.pdf", ""), "BANKING");
});

test("a due date is recorded only when the mail has both a date and an amount", () => {
  assert.equal(readDueDate("Your bill is ready"), null);
  assert.equal(readDueDate("Amount due Rs 100"), null);
  const due = readDueDate("Subject: HDFC credit card\nAmount due Rs 1,250.50\nDue date: 15/10/2026");
  assert.equal(due?.amount, "1250.50");
  assert.equal(due?.dueDate, "2026-10-15");
  assert.equal(due?.currency, "INR");
  assert.equal(due?.category, "CREDIT_CARD");
  assert.equal(readFileSync(new URL("../src/gmail/reminders.ts", import.meta.url), "utf8").includes("logical_transaction"), false);
});

test("history expiry falls back to search, an empty page does not, and reminders are not uploaded", async () => {
  const uploaded: string[] = [];
  const checkpoints: string[] = [];
  const dueDates: string[] = [];
  let historyStatus = 404;
  const fetchImpl: PollFetch = async (url) => {
    if (url.includes("oauth.example")) {
      return { status: 200, json: async () => ({ access_token: "access-token" }) };
    }
    if (url.includes("/history")) {
      if (historyStatus === 404) {
        return { status: 404, json: async () => ({}) };
      }
      return { status: 200, json: async () => ({ history: [] }) };
    }
    if (url.includes("/messages/") && url.includes("format=raw")) {
      const id = decodeURIComponent(url.split("/messages/")[1]?.split("?")[0] ?? "");
      return { status: 200, json: async () => ({ raw: Buffer.from(rawMessage(id), "latin1").toString("base64url") }) };
    }
    if (url.includes("/messages?")) {
      const query = new URL(url).searchParams.get("q") ?? "";
      const id = query.includes("filename:") ? "file-1" : "due-1";
      return { status: 200, json: async () => ({ messages: [{ id }] }) };
    }
    if (url.endsWith("/profile")) {
      return { status: 200, json: async () => ({ historyId: "88" }) };
    }
    return { status: 500, json: async () => ({}) };
  };
  await pollConnection(connection(null), ports(fetchImpl, uploaded, checkpoints, dueDates));
  assert.deepEqual(uploaded, ["cams-statement.pdf"]);
  assert.deepEqual(checkpoints, ["88"]);
  assert.equal(dueDates.length, 2);

  uploaded.length = 0;
  checkpoints.length = 0;
  historyStatus = 200;
  await pollConnection(connection("10"), ports(fetchImpl, uploaded, checkpoints, dueDates));
  assert.deepEqual(uploaded, []);
  assert.deepEqual(checkpoints, []);
});

test("a pending authorize result finishes the upload", async () => {
  const completed: string[] = [];
  const checkpoints: string[] = [];
  await pollConnection(connection(null), searchPorts({
    authorize: async () => ({ outcome: "pending", importId: "imp_existing_999" }),
    complete: async (input) => {
      completed.push(input.importId);
    },
    setCheckpoint: async (checkpoint) => {
      checkpoints.push(checkpoint);
    },
  }));
  assert.deepEqual(completed, ["imp_existing_999"]);
  assert.deepEqual(checkpoints, ["88"]);
});

test("an oversized attachment is skipped and the checkpoint is still saved", async () => {
  let authorized = 0;
  const checkpoints: string[] = [];
  const pdf = Buffer.alloc(11 * 1024 * 1024, 1);
  await pollConnection(connection(null), searchPorts({
    rawFor: (id) => id === "file-1" ? attachmentMessage(pdf, "large.pdf") : undefined,
    authorize: async () => {
      authorized += 1;
      return { outcome: "created", importId: "import-1" };
    },
    setCheckpoint: async (checkpoint) => {
      checkpoints.push(checkpoint);
    },
  }));
  assert.equal(authorized, 0);
  assert.deepEqual(checkpoints, ["88"]);
});

test("a forbidden authorize result does not save the checkpoint", async () => {
  const checkpoints: string[] = [];
  await assert.rejects(
    () => pollConnection(connection(null), searchPorts({
      authorize: async () => ({ outcome: "forbidden", importId: null }),
      setCheckpoint: async (checkpoint) => {
        checkpoints.push(checkpoint);
      },
    })),
    (error: unknown) => {
      assert.equal(workerFailure(error).code, "forbidden");
      return true;
    },
  );
  assert.deepEqual(checkpoints, []);
});

function connection(historyCheckpoint: string | null) {
  return {
    gmailConnectionId: "connection-1",
    ownerId: "owner-1",
    actorId: "actor-1",
    refreshToken: "refresh-token",
    historyCheckpoint,
  };
}

function ports(
  fetchImpl: PollFetch,
  uploaded: string[],
  checkpoints: string[],
  dueDates: string[],
): PollPorts {
  return {
    fetchImpl,
    clientId: "client",
    clientSecret: "secret",
    tokenUri: "https://oauth.example/token",
    alreadyImported: async () => false,
    saveCandidate: async () => undefined,
    saveHandoff: async () => undefined,
    saveDueDate: async (due) => {
      dueDates.push(due.dueDate);
    },
    authorize: async (input) => {
      uploaded.push(input.filename);
      assert.equal(input.sourceMetadata.pipeline_target, "MUTUAL_FUNDS");
      assert.equal(input.sourceMetadata.channel, "gmail");
      return { outcome: "created", importId: "import-1" };
    },
    storage: {
      async putObject() {
        return "etag";
      },
      async copyObject() {
        return "etag";
      },
      async deleteObject() {
        return undefined;
      },
      async presignUpload() {
        return { url: "", headers: {} };
      },
      async readObject() {
        return null;
      },
      async probe() {
        return undefined;
      },
      async close() {
        return undefined;
      },
    },
    complete: async () => undefined,
    setCheckpoint: async (checkpoint) => {
      checkpoints.push(checkpoint);
    },
  };
}

function searchPorts(input: {
  authorize: PollPorts["authorize"];
  complete?: PollPorts["complete"];
  setCheckpoint: PollPorts["setCheckpoint"];
  rawFor?: (id: string) => string | undefined;
}): PollPorts {
  const fetchImpl: PollFetch = async (url) => {
    if (url.includes("oauth.example")) {
      return { status: 200, json: async () => ({ access_token: "access-token" }) };
    }
    if (url.includes("/messages/") && url.includes("format=raw")) {
      const id = decodeURIComponent(url.split("/messages/")[1]?.split("?")[0] ?? "");
      const raw = input.rawFor?.(id) ?? rawMessage(id);
      return { status: 200, json: async () => ({ raw: Buffer.from(raw, "latin1").toString("base64url") }) };
    }
    if (url.includes("/messages?")) {
      const query = new URL(url).searchParams.get("q") ?? "";
      const id = query.includes("filename:") ? "file-1" : "due-1";
      return { status: 200, json: async () => ({ messages: [{ id }] }) };
    }
    if (url.endsWith("/profile")) {
      return { status: 200, json: async () => ({ historyId: "88" }) };
    }
    return { status: 500, json: async () => ({}) };
  };
  return {
    ...ports(fetchImpl, [], [], []),
    fetchImpl,
    authorize: input.authorize,
    complete: input.complete ?? (async () => undefined),
    setCheckpoint: input.setCheckpoint,
  };
}

function attachmentMessage(pdf: Buffer, filename: string): string {
  return [
    "From: statements@example.com",
    "Content-Type: multipart/mixed; boundary=bound",
    "",
    "--bound",
    "Content-Type: application/pdf",
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    pdf.toString("base64"),
    "--bound--",
    "",
  ].join("\r\n");
}

function rawMessage(id: string): string {
  if (id === "due-1") {
    return [
      "From: reminders@example.com",
      "Subject: amount due",
      "Content-Type: text/plain",
      "",
      "Amount due Rs 99. Due date: 02/11/2026",
    ].join("\r\n");
  }
  const pdf = Buffer.from("%PDF-1.4");
  return [
    "From: statements@camsonline.com",
    "Content-Type: multipart/mixed; boundary=bound",
    "",
    "--bound",
    "Content-Type: text/plain",
    "",
    "Amount due Rs 10. Due date: 01/11/2026",
    "--bound",
    "Content-Type: application/pdf",
    "Content-Disposition: attachment; filename=\"cams-statement.pdf\"",
    "Content-Transfer-Encoding: base64",
    "",
    pdf.toString("base64"),
    "--bound--",
    "",
  ].join("\r\n");
}
