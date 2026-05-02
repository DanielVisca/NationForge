import type { UIMessage } from "ai";

import type { EmergentEventRecord, GameSession, Nation } from "./schema";

export type PublicSecret = {
  id: string;
  nationId: string;
  label: string;
  revealed: boolean;
  content?: string;
};

export type PublicTurnLogEntry = {
  id: string;
  at: string;
  povNationId: string;
  publicSummary: string;
  /** Present only for the matching viewer nation. */
  privateText?: string;
};

/** Full room roster (ids + forge status) for host copy; gameplay `nations` omits others’ in-progress builds. */
export type NationRosterEntry = {
  id: string;
  name: string;
  forgeComplete: boolean;
};

/** Emergent beats visible at the table; GM-only privateNotes stripped. */
export type PublicEmergentEvent = Omit<EmergentEventRecord, "privateNotes">;

export type PublicGameSession = Omit<
  GameSession,
  | "secrets"
  | "seatTokens"
  | "nations"
  | "emergentEvents"
  | "turnLog"
  | "gmMessagesByNationId"
  | "lastGmResponseIdByNationId"
  | "gmMessages"
  | "lastGmResponseId"
> & {
  nations: Nation[];
  nationRoster: NationRosterEntry[];
  secrets: PublicSecret[];
  turnLog: PublicTurnLogEntry[];
  emergentEvents: PublicEmergentEvent[];
  /** This seat’s GM transcript only (sanitized). */
  gmMessages: UIMessage[];
  viewerNationId: string | null;
};
