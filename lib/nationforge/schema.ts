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
  /** AI Markdown chronicle on confirm step; cleared when leaving review */
  reviewNarrativeMarkdown?: string;
};

/** Ongoing governance / society development (GM sees full text server-side; peers do not). */
export const MAX_DOMESTIC_SCRATCH_LENGTH = 1500;

/** Bilateral outreach between two seats; optional reply from the recipient. */
export const MAX_DIPLOMACY_MESSAGE_LENGTH = 2000;
export const MAX_DIPLOMACY_REPLY_LENGTH = 2000;
export const MAX_DIPLOMACY_OUTREACH_TOTAL = 80;
/** Per-nation cap when serializing governance text into the GM prompt. */
export const GM_GOVERNANCE_CLIP = 1200;

export type DiplomaticOutreach = {
  id: string;
  at: string;
  fromNationId: string;
  toNationId: string;
  message: string;
  /** Recipient may reply once, or leave unanswered. */
  reply?: { text: string; at: string };
};

export type Nation = {
  id: string;
  name: string;
  /** Free-form nation build / government line players maintain */
  buildNotes: string;
  /**
   * Ongoing governance and domestic development: policy moves, mood, projects.
   * Fed to the GM as authoritative context for your nation; hidden from other players’ clients.
   */
  domesticScratch: string;
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
  /** Bilateral messages; each party sees only threads they are part of (client filter). */
  diplomaticOutreach: DiplomaticOutreach[];
};

export const MAX_REALLOC_POINTS_PER_TURN = 10;

export const STAT_MIN = 0;
export const STAT_MAX = 100;
