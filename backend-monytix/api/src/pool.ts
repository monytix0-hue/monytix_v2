import pg from "pg";

// The public API and this process share one Supabase session pool of 15 clients.
export function openPool(databaseUrl: string, max = 2): pg.Pool {
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
  return pool;
}
