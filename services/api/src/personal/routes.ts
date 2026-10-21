import type { FastifyPluginAsync } from "fastify";

export type PersonalStub = {
  module: "personal";
  status: "stub";
};

/** Personal finance views. */
export const personalRoutes: FastifyPluginAsync = async (app) => {
  app.get("/personal", async (): Promise<PersonalStub> => {
    return { module: "personal", status: "stub" };
  });
};
