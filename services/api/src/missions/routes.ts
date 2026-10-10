import type { FastifyPluginAsync } from "fastify";

export type MissionsStub = {
  module: "missions";
  status: "stub";
};

/** Mission plans. */
export const missionsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/missions", async (): Promise<MissionsStub> => {
    return { module: "missions", status: "stub" };
  });
};
