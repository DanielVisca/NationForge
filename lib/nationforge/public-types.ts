import type { GameSession } from "./schema";

export type PublicSecret = {
  id: string;
  nationId: string;
  label: string;
  revealed: boolean;
  content?: string;
};

export type PublicGameSession = Omit<GameSession, "secrets" | "seatTokens"> & {
  secrets: PublicSecret[];
  viewerNationId: string | null;
};
