import type { FastifyPluginAsync } from "fastify";

export type PlatformStub = {
  module: "platform";
  status: "ok";
};

export type PlatformCheck = "ok" | "down" | "unconfigured";

export type PlatformChecks = {
  database: PlatformCheck;
  storage: PlatformCheck;
  scanner: PlatformCheck;
};

export type PlatformProbe = () => Promise<PlatformChecks>;

export type PlatformOptions = {
  probe?: PlatformProbe;
};

/** Service health. */
export const platformRoutes: FastifyPluginAsync<PlatformOptions> = async (app, options) => {
  app.get("/platform/health", async (): Promise<PlatformStub> => {
    return { module: "platform", status: "ok" };
  });

  app.get("/platform/ready", async (_request, reply) => {
    const checks = options.probe
      ? await options.probe()
      : { database: "unconfigured" as const, storage: "unconfigured" as const, scanner: "unconfigured" as const };
    const status = checks.database === "down" ? "down" : checks.storage === "down" || checks.scanner === "down" ? "degraded" : "ok";
    if (checks.database === "down") {
      return reply.status(503).send({ module: "platform", status, checks });
    }
    return { module: "platform", status, checks };
  });
};
