import type { FastifyPluginAsync } from "fastify";

export type StatementsStub = {
  module: "statements";
  status: "stub";
};

/** Statement documents. */
export const statementsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/statements", async (): Promise<StatementsStub> => {
    return { module: "statements", status: "stub" };
  });
};
