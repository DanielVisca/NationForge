import type { GameSession, Nation } from "./schema";

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

export type PublicGameSession = Omit<
  GameSession,
  "secrets" | "seatTokens" | "nations"
> & {
  nations: Nation[];
  nationRoster: NationRosterEntry[];
  secrets: PublicSecret[];
  viewerNationId: string | null;
};
