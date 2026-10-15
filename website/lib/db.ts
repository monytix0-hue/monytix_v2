import path from "path";
import { loadEnvConfig } from "@next/env";
import pg from "pg";

loadEnvConfig(path.join(process.cwd(), ".."), process.env.NODE_ENV !== "production", { info() {}, error() {} }, true);

let pool: pg.Pool | null = null;

export function databaseUrl(): string | null {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return null;
  if (process.env.MONYTIX_IN_DOCKER === "1") return raw;
  // The compose hostname is only resolvable inside the stack. The role is
  // monytix_api; the database created by POSTGRES_DB is monytix.
  return raw
    .replace("@postgres:", "@127.0.0.1:")
    .replace("@postgres/", "@127.0.0.1/")
    .replace(/\/monytix_api(?=$|\?)/, "/monytix");
}

export function getPool(): pg.Pool | null {
  const url = databaseUrl();
  if (!url) return null;
  if (!pool) pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 4000 });
  return pool;
}
