import type { GameSession } from "./schema";

/** Primary key for the singleton JSON snapshot row (Postgres) and logical id for migrations. */
export const NATIONFORGE_SNAPSHOT_ID = "sessions_v1" as const;

export type StoreFile = {
  sessions: Record<string, GameSession>;
  /** roomCode (uppercase) -> sessionId */
  roomIndex: Record<string, string>;
};

export function emptyStoreFile(): StoreFile {
  return { sessions: {}, roomIndex: {} };
}
