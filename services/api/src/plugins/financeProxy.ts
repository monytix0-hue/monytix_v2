import httpProxy from "@fastify/http-proxy";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest, HookHandlerDoneFunction } from "fastify";

/** Paths owned by backend-monytix Decision OS (:8090). */
export const FINANCE_PROXY_PREFIXES = [
  "/v1/imports",
  "/v1/ui/decisions",
  "/v1/ui/missions",
  "/v1/ui/rewards",
  "/v1/mile",
  "/v1/ui/journey",
  "/v1/decisions",
  "/v1/missions",
  "/v1/human-context",
] as const;

export type FinanceProxyOptions = {
  upstream: string;
};

/**
 * Reverse-proxies Decision OS UI and mutation routes to backend-monytix.
 * Firebase Authorization is validated by services/api first, then forwarded intact.
 */
export const financeProxyPlugin: FastifyPluginAsync<FinanceProxyOptions> = async (fastify, options) => {
  const upstream = options.upstream.replace(/\/$/, "");

  for (const prefix of FINANCE_PROXY_PREFIXES) {
    await fastify.register(httpProxy, {
      upstream,
      prefix,
      rewritePrefix: prefix,
      http2: false,
      // Body already parsed by services/api (secure-json-parse); avoid re-registering parsers.
      proxyPayloads: false,
      preHandler: ((
        request: FastifyRequest,
        reply: FastifyReply,
        done: HookHandlerDoneFunction,
      ) => {
        if (!request.actorId) {
          reply.status(401).send({ error: "unauthorized" });
          return;
        }
        if (!request.ownerId) {
          reply.status(403).send({ error: "owner_forbidden" });
          return;
        }
        done();
      }) as never,
      replyOptions: {
        rewriteRequestHeaders: (request, headers) => {
          const req = request as FastifyRequest;
          const requestId =
            (typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"]) || req.id;
          return {
            ...headers,
            authorization: req.headers.authorization,
            "x-monytix-owner-id": req.ownerId || headers["x-monytix-owner-id"],
            "x-request-id": requestId,
            "x-forwarded-for": req.ip,
            "x-forwarded-host": req.hostname,
          };
        },
        onError: (reply, { error }) => {
          fastify.log.error({ err: error, prefix, upstream }, "Upstream finance proxy error (:8090)");
          reply.status(502).send({
            code: "UPSTREAM_GATEWAY_ERROR",
            message: "Unable to reach the Decision OS engine. Please try again shortly.",
          });
        },
      },
    });
  }

  fastify.log.info(`[FinanceProxy] Routing Ingest (/v1/imports) & Decision OS -> ${upstream}`);
};
