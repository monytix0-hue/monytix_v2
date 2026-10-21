import type { FastifyPluginAsync } from "fastify";

export type PlatformStub = {
  module: "platform";
  status: "ok";
};

export type PlatformCheck = "ok" | "down" | "unconfigured";

export type PlatformChecks = {
  auth: PlatformCheck;
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
      : {
          auth: "unconfigured" as const,
          database: "unconfigured" as const,
          storage: "unconfigured" as const,
          scanner: "unconfigured" as const,
        };
    const values = [checks.auth, checks.database, checks.storage, checks.scanner];
    const status = values.every((value) => value === "ok")
      ? "ok"
      : values.some((value) => value === "down")
        ? "down"
        : "unconfigured";
    if (status !== "ok") {
      return reply.status(503).send({ module: "platform", status, checks });
    }
    return { module: "platform", status, checks };
  });
};
