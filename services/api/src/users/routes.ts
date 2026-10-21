import type { FastifyPluginAsync } from "fastify";

export type UsersStub = {
  module: "users";
  status: "stub";
};

/** User profiles. */
export const usersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/users", async (): Promise<UsersStub> => {
    return { module: "users", status: "stub" };
  });
};
