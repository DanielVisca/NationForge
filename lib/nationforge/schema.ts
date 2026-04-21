/** NationForge domain — authoritative game state (not chat prose). */

export type GamePhase =
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

export type Nation = {
  id: string;
  name: string;
  /** Free-form nation build / government line players maintain */
  buildNotes: string;
  stats: NationStats;
  reserve: number;
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
