import type { FastifyPluginAsync } from "fastify";

export type PlatformStub = {
  module: "platform";
  status: "ok";
};

/** Service health. */
export const platformRoutes: FastifyPluginAsync = async (app) => {
  app.get("/platform/health", async (): Promise<PlatformStub> => {
    return { module: "platform", status: "ok" };
  });
};
