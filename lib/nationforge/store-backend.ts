import "server-only";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type NationForgePersistenceKind = "local" | "postgres";

let logged = false;

/**
 * Next.js loads `.env*` via @next/env without overriding keys that already exist
 * on `process.env` (even as empty strings). A shell or IDE that exports
 * `DATABASE_URL=` blocks the value from `.env`. We fall back to reading project
 * env files when the public env var is missing or blank after trim.
 */
function envFileChainForNodeEnv(): string[] {
  if (process.env.NODE_ENV === "production") {
    return [".env.production.local", ".env.local", ".env.production", ".env"];
  }
  if (process.env.NODE_ENV === "test") {
    return [".env.test.local", ".env.test", ".env.local", ".env"];
  }
  return [".env.development.local", ".env.local", ".env.development", ".env"];
}

function parseDatabaseUrlFromEnvFileContents(content: string): string | undefined {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (!line.startsWith("DATABASE_URL=")) continue;
    let v = line.slice("DATABASE_URL=".length).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    const t = v.trim();
    if (t.length > 0) return t;
  }
  return undefined;
}

function readDatabaseUrlFromProjectEnvFiles(): string | undefined {
  for (const name of envFileChainForNodeEnv()) {
    const fp = path.join(
      /* turbopackIgnore: true */ process.cwd(),
      name,
    );
    if (!existsSync(fp)) continue;
    try {
      const parsed = parseDatabaseUrlFromEnvFileContents(
        readFileSync(fp, "utf-8"),
      );
      if (parsed) return parsed;
    } catch {
      /* ignore unreadable env file */
    }
  }
  return undefined;
}

/** Resolved connection string for NationForge Postgres mode, or undefined for local file store. */
export function readNationForgeDatabaseUrl(): string | undefined {
  const fromProcess = process.env["DATABASE_URL"];
  if (typeof fromProcess === "string" && fromProcess.trim().length > 0) {
    return fromProcess.trim();
  }
  return readDatabaseUrlFromProjectEnvFiles();
}

/** Log once per Node process when NationForge persistence is first resolved. */
export function logNationForgePersistenceOnce(kind: NationForgePersistenceKind): void {
  if (logged) return;
  logged = true;
  if (kind === "postgres") {
    console.info("[nationforge] persistence: postgres (DATABASE_URL set)");
  } else {
    console.info(
      "[nationforge] persistence: local file (.data/nationforge-sessions.json)",
    );
  }
}

export function nationForgePersistenceKindFromEnv(): NationForgePersistenceKind {
  return readNationForgeDatabaseUrl() ? "postgres" : "local";
}
