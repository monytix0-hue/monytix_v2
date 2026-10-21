import pg from "pg";

export function openPool(databaseUrl: string, max = 4): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max });
  pool.on("error", (error: unknown) => {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "unknown";
    console.error(JSON.stringify({ level: "error", event: "database_pool_client_error", code }));
  });
  return pool;
}
