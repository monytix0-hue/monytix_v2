import type { FastifyPluginAsync } from "fastify";

export type AccountsStub = {
  module: "accounts";
  status: "stub";
};

/** Financial accounts. */
export const accountsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/accounts", async (): Promise<AccountsStub> => {
    return { module: "accounts", status: "stub" };
  });
};
