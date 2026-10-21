import assert from "node:assert/strict";
import test from "node:test";
import { listAllMatchingMessages, type PollFetch } from "../src/gmail/poll.js";

test("search follows nextPageToken until pages are exhausted", async () => {
  const requestedPageTokens: (string | null)[] = [];
  const fetchImpl: PollFetch = async (url) => {
    const pageToken = new URL(url).searchParams.get("pageToken");
    requestedPageTokens.push(pageToken);
    if (!pageToken) {
      return {
        status: 200,
        json: async () => ({
          messages: [{ id: "msg-page-1" }],
          nextPageToken: "token-page-2",
        }),
      };
    }
    return {
      status: 200,
      json: async () => ({
        messages: [{ id: "msg-page-2" }],
      }),
    };
  };

  const ids = await listAllMatchingMessages(fetchImpl, "test-token", "test-query");
  assert.deepEqual(ids, ["msg-page-1", "msg-page-2"]);
  assert.deepEqual(requestedPageTokens, [null, "token-page-2"]);
});
