import type { FastifyPluginAsync } from "fastify";

export type ProjectionsStub = {
  module: "projections";
  status: "stub";
};

/** Cash projections. */
export const projectionsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/projections", async (): Promise<ProjectionsStub> => {
    return { module: "projections", status: "stub" };
  });
};
