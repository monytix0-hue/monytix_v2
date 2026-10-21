import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { signToken } from "./auth-fixture.js";

async function startUpstream(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void>; seen: http.IncomingMessage[] }> {
  const seen: http.IncomingMessage[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req);
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test("FINANCE_BACKEND_URL proxies /v1/ui/decisions via @fastify/http-proxy", async () => {
  const signed = await signToken({ subject: "finance-proxy", expiresIn: "1h" });
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      meta: { api_version: "v1.2", recompute_status: "COMPLETE" },
      data: { empty_state: true, awareness_score: 0, heaviest_decision: null, upcoming_decisions: [] },
    }));
  });

  try {
    const app = await buildApp({
      ...signed.options,
      financeBackendUrl: upstream.url,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/ui/decisions",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "x-monytix-owner-id": "owner-allowed",
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().meta.api_version, "v1.2");
    assert.equal(response.json().data.empty_state, true);
    assert.equal(upstream.seen.length, 1);
    assert.equal(upstream.seen[0]?.url, "/v1/ui/decisions");
    assert.match(String(upstream.seen[0]?.headers.authorization || ""), /^Bearer /);
    assert.equal(upstream.seen[0]?.headers["x-monytix-owner-id"], "owner-allowed");
    await app.close();
  } finally {
    await upstream.close();
  }
});

test("FINANCE_BACKEND_URL proxies decision actions and returns upstream status", async () => {
  const signed = await signToken({ subject: "finance-proxy-action", expiresIn: "1h" });
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "decision_missing" }));
  });

  try {
    const app = await buildApp({
      ...signed.options,
      financeBackendUrl: upstream.url,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/decisions/missing/actions",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "x-monytix-owner-id": "owner-allowed",
        "content-type": "application/json",
      },
      payload: { action: "ACCEPT" },
    });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), { error: "decision_missing" });
    assert.equal(upstream.seen[0]?.url, "/v1/decisions/missing/actions");
    await app.close();
  } finally {
    await upstream.close();
  }
});

test("FINANCE_BACKEND_URL proxies /v1/imports initiate and complete", async () => {
  const signed = await signToken({ subject: "finance-proxy-imports", expiresIn: "1h" });
  const upstream = await startUpstream((req, res) => {
    if (req.url?.startsWith("/v1/imports/") && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { import_id: "imp-1", ingest_status: "PENDING" } }));
      return;
    }
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({
      data: {
        import_id: "imp-1",
        object_key: "pdf/owner/imp-1",
        declared_mime_type: "application/pdf",
        upload: { url: "memory://pdf/owner/imp-1", expires_at: "2099-01-01T00:00:00.000Z", headers: {} },
      },
    }));
  });

  try {
    const app = await buildApp({
      ...signed.options,
      financeBackendUrl: upstream.url,
    });
    const created = await app.inject({
      method: "POST",
      url: "/v1/imports",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "x-monytix-owner-id": "owner-allowed",
        "idempotency-key": "idem-import-1",
        "content-type": "application/json",
      },
      payload: {
        file_type: "PDF",
        byte_size: 12,
        sha256: "abc",
        original_filename: "stmt.pdf",
      },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().data.import_id, "imp-1");
    assert.equal(upstream.seen[0]?.url, "/v1/imports");

    const completed = await app.inject({
      method: "POST",
      url: "/v1/imports/imp-1/complete",
      headers: {
        authorization: `Bearer ${signed.token}`,
        "x-monytix-owner-id": "owner-allowed",
        "idempotency-key": "idem-complete-1",
        "content-type": "application/json",
      },
      payload: {},
    });
    assert.equal(completed.statusCode, 200);
    assert.equal(upstream.seen[1]?.url, "/v1/imports/imp-1/complete");
    assert.match(String(upstream.seen[1]?.headers.authorization || ""), /^Bearer /);
    await app.close();
  } finally {
    await upstream.close();
  }
});

test("finance proxy returns 502 when the Decision OS upstream is unreachable", async () => {
  const signed = await signToken({ subject: "finance-proxy-down", expiresIn: "1h" });
  const app = await buildApp({
    ...signed.options,
    financeBackendUrl: "http://127.0.0.1:1",
  });
  const response = await app.inject({
    method: "GET",
    url: "/v1/ui/missions",
    headers: {
      authorization: `Bearer ${signed.token}`,
      "x-monytix-owner-id": "owner-allowed",
    },
  });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().code, "UPSTREAM_GATEWAY_ERROR");
  await app.close();
});
