import type { FastifyPluginAsync } from "fastify";

export type SourcesStub = {
  module: "sources";
  status: "stub";
};

/** Ingestion sources. */
export const sourcesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/sources", async (): Promise<SourcesStub> => {
    return { module: "sources", status: "stub" };
  });
};
