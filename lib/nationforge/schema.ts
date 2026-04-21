/** NationForge domain — authoritative game state (not chat prose). */

import type { NationForgeSelections } from "./nation-forge-catalog";

export type GamePhase =
  | "lobby"
  | "nation_forge"
  | "player_input"
  | "gm_running"
  | "awaiting_decision";

export type StatKey =
  | "prosperity"
  | "stability"
  | "freedom"
  | "power"
  | "happiness"
  | "innovation";

export const STAT_KEYS: StatKey[] = [
  "prosperity",
  "stability",
  "freedom",
  "power",
  "happiness",
  "innovation",
];

export type NationStats = Record<StatKey, number>;

export type NationForgeProgress = {
  stepIndex: number;
  selections: NationForgeSelections;
  /** 2 = naming step exists before confirm; undefined/1 = legacy single confirm index */
  forgeWizardVersion?: number;
  /** AI suggestion on naming step; cleared when backing before naming */
  suggestedNationName?: string;
};

export type Nation = {
  id: string;
  name: string;
  /** Free-form nation build / government line players maintain */
  buildNotes: string;
  stats: NationStats;
  reserve: number;
  /** False while the player is stepping through the 100-point builder. */
  forgeComplete: boolean;
  /** Present when forgeComplete is false; cleared after finalize. */
  forgeProgress: NationForgeProgress | null;
};

export type CrisisOption = {
  id: string;
  label: string;
};

export type Crisis = {
  id: string;
  prompt: string;
  options: CrisisOption[];
  allowCustom: boolean;
  activeNationIds: string[];
};

export type TurnLogEntry = {
  id: string;
  at: string;
  povNationId: string;
  publicSummary: string;
  privateByNation?: Record<string, string>;
};

export type GameSecret = {
  id: string;
  nationId: string;
  label: string;
  content: string;
  revealed: boolean;
};

export type GameSession = {
  id: string;
  /** Short code for LAN join */
  roomCode: string;
  createdAt: string;
  updatedAt: string;
  promptVersion: number;
  phase: GamePhase;
  /** First beat begins only after every nation present has completed the forge once. */
  gameStarted: boolean;
  roundIndex: number;
  activeNationId: string;
  nations: Nation[];
  crisis: Crisis | null;
  turnLog: TurnLogEntry[];
  secrets: GameSecret[];
  /** nationId -> join token (share with that seat for LAN) */
  seatTokens: Record<string, string>;
  /** Grok thread for GM narration */
  gmMessages: import("ai").UIMessage[];
  lastGmResponseId?: string;
};

export const MAX_REALLOC_POINTS_PER_TURN = 10;

export const STAT_MIN = 0;
export const STAT_MAX = 100;
