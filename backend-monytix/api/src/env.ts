import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function repoRoot(): string {
  return path.resolve(here, "../../..");
}

export function loadRepoEnv(env: NodeJS.ProcessEnv = process.env): void {
  const file = path.join(repoRoot(), ".env");
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const [key, value] of parseEnv(text)) {
    if (!env[key]) env[key] = value;
  }
  const credentials = env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ?? "";
  if (credentials && !path.isAbsolute(credentials)) {
    env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(repoRoot(), credentials);
  }
}

export function parseEnv(text: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    pairs.push([key, value]);
  }
  return pairs;
}

export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.FINANCE_DATABASE_URL?.trim() || env.DATABASE_URL?.trim() || "";
}

export function isFirebaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const projectId = env.FIREBASE_PROJECT_ID?.trim() ?? "";
  const file = env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ?? "";
  const inline = env.GOOGLE_CREDENTIALS_JSON?.trim() ?? "";
  return projectId.length > 0 && (file.length > 0 || inline.length > 0);
}
