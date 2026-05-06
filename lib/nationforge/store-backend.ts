import "server-only";

export type NationForgePersistenceKind = "local" | "postgres";

let logged = false;

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
  return process.env.DATABASE_URL?.trim() ? "postgres" : "local";
}
