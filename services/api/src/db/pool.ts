import pg from "pg";

const pools = new Map<string, pg.Pool>();

// Supabase session mode allows 15 clients for the whole project. Every store in this
// process shares one pool so a screen open cannot open a connection per feature.
export function openPool(databaseUrl: string, max = 4): pg.Pool {
  const key = `${max}\0${databaseUrl}`;
  const cached = pools.get(key);
  if (cached) return cached;

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: true,
  });
  pool.on("error", (error: unknown) => {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "unknown";
    console.error(JSON.stringify({ level: "error", event: "database_pool_client_error", code }));
  });
  const end = pool.end.bind(pool);
  let ending: Promise<void> | undefined;
  pool.end = ((callback?: (err: Error) => void) => {
    ending ??= end().then(() => undefined, (error: unknown) => {
      throw error;
    }).finally(() => {
      pools.delete(key);
    });
    if (callback) {
      void ending.then(() => callback(undefined as unknown as Error), callback);
    }
    return ending;
  }) as typeof pool.end;
  pools.set(key, pool);
  return pool;
}
