import assert from "node:assert/strict";
import test from "node:test";
import { needsWatchRenewal, qualifyTopic, renewWatch, type WatchPorts } from "../src/gmail/watch.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);

test("a missing watch is renewed", () => {
  assert.equal(needsWatchRenewal(null, NOW), true);
  assert.equal(needsWatchRenewal(new Date(Number.NaN), NOW), true);
});

test("a watch inside the renewal window is renewed, one outside it is left alone", () => {
  // Gmail caps a watch at 7 days; renewing a day early leaves room for a missed tick.
  assert.equal(needsWatchRenewal(new Date(NOW + 23 * 60 * 60 * 1000), NOW), true);
  assert.equal(needsWatchRenewal(new Date(NOW + 25 * 60 * 60 * 1000), NOW), false);
  assert.equal(needsWatchRenewal(new Date(NOW - DAY), NOW), true);
});

test("a bare topic id is qualified with the project", () => {
  assert.equal(qualifyTopic("gmail-events", "momentra-v2"), "projects/momentra-v2/topics/gmail-events");
});

test("an already-qualified topic is passed through unchanged", () => {
  const full = "projects/momentra-v2/topics/gmail-events";
  assert.equal(qualifyTopic(full, "ignored"), full);
});

test("a bare topic with no project is refused rather than posted raw", () => {
  // This is exactly the silent failure being fixed: posting "gmail-events" to
  // users.watch is rejected, and the rejection used to be swallowed.
  assert.equal(qualifyTopic("gmail-events", ""), null);
  assert.equal(qualifyTopic("", "momentra-v2"), null);
  assert.equal(qualifyTopic("projects/x", "momentra-v2"), null);
});

function ports(overrides: Partial<WatchPorts> = {}): WatchPorts & { saved: string[]; logs: Record<string, unknown>[] } {
  const saved: string[] = [];
  const logs: Record<string, unknown>[] = [];
  return {
    saved,
    logs,
    fetchImpl: async () => ({
      status: 200,
      json: async () => ({ expiration: String(NOW + 7 * DAY) }),
    }),
    topic: "gmail-events",
    project: "momentra-v2",
    clientId: "id",
    clientSecret: "secret",
    tokenUri: "https://oauth2.googleapis.com/token",
    accessToken: async () => "access",
    saveWatch: async (input) => {
      saved.push(input.expiresAt);
    },
    mailbox: "someone@example.test",
    log: (event) => {
      logs.push(event);
    },
    now: () => NOW,
    ...overrides,
  };
}

const target = {
  gmailConnectionId: "conn",
  ownerId: "owner",
  refreshToken: "refresh",
  watchExpiresAt: null as Date | null,
};

test("a successful renewal writes the expiry the API returned", async () => {
  const p = ports();
  const outcome = await renewWatch(target, p);
  assert.equal(outcome.status, "renewed");
  assert.deepEqual(p.saved, [new Date(NOW + 7 * DAY).toISOString()]);
});

test("a live watch is skipped without a network call", async () => {
  let called = false;
  const p = ports({
    fetchImpl: async () => {
      called = true;
      return { status: 200, json: async () => ({}) };
    },
  });
  const outcome = await renewWatch({ ...target, watchExpiresAt: new Date(NOW + 6 * DAY) }, p);
  assert.equal(outcome.status, "skipped");
  assert.equal(called, false);
});

test("a rejected watch is reported, not swallowed", async () => {
  const p = ports({
    fetchImpl: async () => ({ status: 403, json: async () => ({ error: { status: "PERMISSION_DENIED" } }) }),
  });
  const outcome = await renewWatch(target, p);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.status === "failed" && outcome.reason, "permission_denied");
  assert.equal(p.saved.length, 0);
  assert.equal(p.logs.at(-1)?.event, "failed");
});

test("an unconfigured topic reports the reason instead of failing silently", async () => {
  const p = ports({ topic: "" });
  const outcome = await renewWatch(target, p);
  assert.equal(outcome.status, "failed");
  assert.equal(p.logs.at(-1)?.reason, "missing_topic");
});

test("a token refresh failure does not attempt the watch call", async () => {
  let called = false;
  const p = ports({
    accessToken: async () => {
      throw new Error("nope");
    },
    fetchImpl: async () => {
      called = true;
      return { status: 200, json: async () => ({}) };
    },
  });
  const outcome = await renewWatch(target, p);
  assert.equal(outcome.status, "failed");
  assert.equal(called, false);
});
