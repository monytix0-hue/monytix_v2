/**
 * Runtime env for services/api. Prefer FINANCE_BACKEND_URL; FINANCE_API_URL is accepted as a legacy alias.
 */
export type ApiEnv = {
  PORT: number;
  HOST: string;
  FINANCE_BACKEND_URL: string | null;
};

export function readApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const port = Number(env.PORT ?? 8080);
  return {
    PORT: Number.isFinite(port) && port > 0 ? port : 8080,
    HOST: (env.HOST?.trim() || "0.0.0.0"),
    FINANCE_BACKEND_URL: resolveFinanceBackendUrl(env),
  };
}

export function resolveFinanceBackendUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = (env.FINANCE_BACKEND_URL || env.FINANCE_API_URL || "").trim();
  return url.length > 0 ? url : null;
}
