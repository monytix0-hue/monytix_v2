import type { FastifyPluginAsync } from "fastify";

export type NudgesStub = {
  module: "nudges";
  status: "stub";
};

/** Nudge delivery. */
export const nudgesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/nudges", async (): Promise<NudgesStub> => {
    return { module: "nudges", status: "stub" };
  });
};
