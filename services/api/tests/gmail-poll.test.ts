import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { detectPipelineTarget } from "../src/gmail/pipeline.js";
import { pollConnection, spotTxnQuery, workerError, workerFailure, type PollFetch, type PollPorts, type SpotSave } from "../src/gmail/poll.js";
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

test("the alert search covers 365 days and leaves statement files out", () => {
  assert.match(spotTxnQuery, /newer_than:365d/);
  assert.match(spotTxnQuery, /-filename:pdf/);
  assert.match(spotTxnQuery, /debited/);
  assert.equal(spotTxnQuery.includes("filename:(pdf"), false);
});

test("history expiry falls back to search, an empty page does not, and a debit alert is staged", async () => {
  const staged: SpotSave[] = [];
  const checkpoints: string[] = [];
  const dueDates: string[] = [];
  const queries: string[] = [];
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
      queries.push(query);
      const id = query.includes("debited") ? "alert-1" : "due-1";
      return { status: 200, json: async () => ({ messages: [{ id }] }) };
    }
    if (url.endsWith("/profile")) {
      return { status: 200, json: async () => ({ historyId: "88" }) };
    }
    return { status: 500, json: async () => ({}) };
  };
  const searched = await pollConnection(connection(null), ports(fetchImpl, staged, checkpoints, dueDates));
  assert.deepEqual(searched, { stored: 1, skipped: 0 });
  assert.equal(staged[0]?.flow, "DEBIT");
  assert.equal(staged[0]?.amount, "350.00");
  assert.equal(staged[0]?.channel, "UPI");
  assert.equal(staged[0]?.idempotencyKey, "ref:429182736451");
  assert.deepEqual(checkpoints, ["88"]);
  assert.deepEqual(dueDates, ["2026-11-02"]);
  assert.equal(queries.some((query) => query === spotTxnQuery), true);

  staged.length = 0;
  checkpoints.length = 0;
  historyStatus = 200;
  await pollConnection(connection("10"), ports(fetchImpl, staged, checkpoints, dueDates));
  assert.deepEqual(staged, []);
  assert.deepEqual(checkpoints, []);
});

test("a drained mailbox parses a new alert and ignores a pdf-only message", async () => {
  const staged: SpotSave[] = [];
  const checkpoints: string[] = [];
  const fetchImpl: PollFetch = async (url) => {
    if (url.includes("oauth.example")) {
      return { status: 200, json: async () => ({ access_token: "access-token" }) };
    }
    if (url.includes("/history")) {
      return {
        status: 200,
        json: async () => ({
          history: [{
            id: "15",
            messagesAdded: [{ message: { id: "alert-1" } }, { message: { id: "file-1" } }],
          }],
        }),
      };
    }
    if (url.includes("/messages/") && url.includes("format=raw")) {
      const id = decodeURIComponent(url.split("/messages/")[1]?.split("?")[0] ?? "");
      return { status: 200, json: async () => ({ raw: Buffer.from(rawMessage(id), "latin1").toString("base64url") }) };
    }
    return { status: 500, json: async () => ({}) };
  };
  const synced = await pollConnection(connection("10"), ports(fetchImpl, staged, checkpoints, []));
  assert.deepEqual(synced, { stored: 1, skipped: 1 });
  assert.deepEqual(staged.map((row) => row.messageId), ["alert-1"]);
  assert.deepEqual(checkpoints, ["15"]);
});

test("history list exhausts nextPageToken before staging alerts", async () => {
  const staged: SpotSave[] = [];
  const checkpoints: string[] = [];
  const historyUrls: string[] = [];
  const fetchImpl: PollFetch = async (url) => {
    if (url.includes("oauth.example")) {
      return { status: 200, json: async () => ({ access_token: "access-token" }) };
    }
    if (url.includes("/history")) {
      historyUrls.push(url);
      if (!url.includes("pageToken=")) {
        return {
          status: 200,
          json: async () => ({
            history: [{ id: "11", messagesAdded: [{ message: { id: "alert-1" } }] }],
            nextPageToken: "page-2",
          }),
        };
      }
      return {
        status: 200,
        json: async () => ({
          history: [{ id: "12", messagesAdded: [{ message: { id: "alert-2" } }] }],
        }),
      };
    }
    if (url.includes("/messages/") && url.includes("format=raw")) {
      const id = decodeURIComponent(url.split("/messages/")[1]?.split("?")[0] ?? "");
      return { status: 200, json: async () => ({ raw: Buffer.from(rawMessage(id === "alert-2" ? "alert-1" : id), "latin1").toString("base64url") }) };
    }
    return { status: 500, json: async () => ({}) };
  };
  const synced = await pollConnection(connection("10"), ports(fetchImpl, staged, checkpoints, []));
  assert.equal(historyUrls.length, 2);
  assert.equal(historyUrls[1]?.includes("pageToken=page-2"), true);
  assert.deepEqual(synced, { stored: 2, skipped: 0 });
  assert.deepEqual(staged.map((row) => row.messageId), ["alert-1", "alert-2"]);
  assert.deepEqual(checkpoints, ["11", "12"]);
});

test("a deleted gmail message is skipped and the checkpoint still advances", async () => {
  const staged: SpotSave[] = [];
  const checkpoints: string[] = [];
  const fetchImpl: PollFetch = async (url) => {
    if (url.includes("oauth.example")) {
      return { status: 200, json: async () => ({ access_token: "access-token" }) };
    }
    if (url.includes("/history")) {
      return {
        status: 200,
        json: async () => ({
          history: [{
            id: "15",
            messagesAdded: [{ message: { id: "gone-1" } }, { message: { id: "alert-1" } }],
          }],
        }),
      };
    }
    if (url.includes("/messages/") && url.includes("format=raw")) {
      const id = decodeURIComponent(url.split("/messages/")[1]?.split("?")[0] ?? "");
      if (id === "gone-1") {
        return { status: 404, json: async () => ({ error: { code: 404 } }) };
      }
      return { status: 200, json: async () => ({ raw: Buffer.from(rawMessage(id), "latin1").toString("base64url") }) };
    }
    return { status: 500, json: async () => ({}) };
  };
  const synced = await pollConnection(connection("10"), ports(fetchImpl, staged, checkpoints, []));
  assert.deepEqual(synced, { stored: 1, skipped: 0 });
  assert.deepEqual(staged.map((row) => row.messageId), ["alert-1"]);
  assert.deepEqual(checkpoints, ["15"]);
});

test("a dry run logs the alert and does not stage it", async () => {
  const staged: SpotSave[] = [];
  const checkpoints: string[] = [];
  const logs: Record<string, unknown>[] = [];
  const fetchImpl: PollFetch = async (url) => {
    if (url.includes("oauth.example")) {
      return { status: 200, json: async () => ({ access_token: "access-token" }) };
    }
    if (url.includes("/messages/") && url.includes("format=raw")) {
      return { status: 200, json: async () => ({ raw: Buffer.from(rawMessage("alert-1"), "latin1").toString("base64url") }) };
    }
    if (url.includes("/messages?")) {
      const query = new URL(url).searchParams.get("q") ?? "";
      return { status: 200, json: async () => ({ messages: query.includes("debited") ? [{ id: "alert-1" }] : [] }) };
    }
    if (url.endsWith("/profile")) {
      return { status: 200, json: async () => ({ historyId: "88" }) };
    }
    return { status: 500, json: async () => ({}) };
  };
  const result = await pollConnection(connection(null), {
    ...ports(fetchImpl, staged, checkpoints, []),
    dryRun: true,
    debug: (event) => {
      logs.push(event);
    },
  });
  assert.deepEqual(result, { stored: 0, skipped: 0 });
  assert.deepEqual(staged, []);
  assert.deepEqual(checkpoints, []);
  assert.equal(logs[0]?.amount, "350.00");
  assert.equal(logs[0]?.flow, "DEBIT");
  assert.equal(logs[0]?.channel, "UPI");
  assert.equal(JSON.stringify(logs).includes("Avail Bal"), false);
});

function connection(historyCheckpoint: string | null) {
  return {
    gmailConnectionId: "connection-1",
    ownerId: "owner-1",
    actorId: "actor-1",
    refreshToken: "refresh-token",
    historyCheckpoint,
    initialWindowDrained: historyCheckpoint !== null,
  };
}

function ports(
  fetchImpl: PollFetch,
  staged: SpotSave[],
  checkpoints: string[],
  dueDates: string[],
): PollPorts {
  return {
    fetchImpl,
    clientId: "client",
    clientSecret: "secret",
    tokenUri: "https://oauth.example/token",
    saveCandidate: async () => undefined,
    saveDueDate: async (due) => {
      dueDates.push(due.dueDate);
    },
    saveSpotTransaction: async (input) => {
      staged.push(input);
      return "created";
    },
    setCheckpoint: async (checkpoint) => {
      checkpoints.push(checkpoint);
    },
    markWindowDrained: async () => undefined,
  };
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
  if (id === "file-1") {
    const pdf = Buffer.from("%PDF-1.4");
    return [
      "From: statements@example.com",
      "Content-Type: multipart/mixed; boundary=bound",
      "",
      "--bound",
      "Content-Type: text/plain",
      "",
      "Your statement is attached.",
      "--bound",
      "Content-Type: application/pdf",
      "Content-Disposition: attachment; filename=\"statement.pdf\"",
      "Content-Transfer-Encoding: base64",
      "",
      pdf.toString("base64"),
      "--bound--",
      "",
    ].join("\r\n");
  }
  return [
    "From: alerts@hdfcbank.com",
    "Date: Sat, 18 Oct 2026 05:15:12 +0000",
    "Content-Type: text/plain",
    "",
    "Your A/C ending 4321 has been debited by INR 350.00 on 18-Oct-2026 10:45:12 via UPI ref 429182736451 to Swiggy. Avail Bal: INR 12,450.00.",
  ].join("\r\n");
}
