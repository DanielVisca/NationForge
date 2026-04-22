import type { EmergentEventRecord, GameSession, Nation } from "./schema";

export type PublicSecret = {
  id: string;
  nationId: string;
  label: string;
  revealed: boolean;
  content?: string;
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
  "secrets" | "seatTokens" | "nations" | "emergentEvents"
> & {
  nations: Nation[];
  nationRoster: NationRosterEntry[];
  secrets: PublicSecret[];
  emergentEvents: PublicEmergentEvent[];
  viewerNationId: string | null;
};
