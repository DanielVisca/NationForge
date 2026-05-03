import type { GamePhase } from "./schema";

export type NationForgeSessionSummary = {
  id: string;
  roomCode: string;
  updatedAt: string;
  roundIndex: number;
  phase: GamePhase;
  gameStarted: boolean;
  activeNationId: string | null;
  activeNationName: string | null;
  nationNames: string[];
  nationRoster: Array<{
    id: string;
    name: string;
    forgeComplete: boolean;
  }>;
  nationsInForge: number;
};
