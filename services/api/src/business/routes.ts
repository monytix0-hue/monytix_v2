import type { FastifyPluginAsync } from "fastify";

export type BusinessStub = {
  module: "business";
  status: "stub";
};

/** Business finance views. */
export const businessRoutes: FastifyPluginAsync = async (app) => {
  app.get("/business", async (): Promise<BusinessStub> => {
    return { module: "business", status: "stub" };
  });
};
