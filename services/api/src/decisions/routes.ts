import type { FastifyPluginAsync } from "fastify";

export type DecisionsStub = {
  module: "decisions";
  status: "stub";
};

/** Decision records. */
export const decisionsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/decisions", async (): Promise<DecisionsStub> => {
    return { module: "decisions", status: "stub" };
  });
};
