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

/** Bilateral outreach between two seats; full conversation history (multiple messages). */
export const MAX_DIPLOMACY_MESSAGE_LENGTH = 2000;
export const MAX_DIPLOMACY_OUTREACH_TOTAL = 80;
/** Per-nation cap when serializing governance text into the GM prompt. */
export const GM_GOVERNANCE_CLIP = 1200;

export type DiplomacyMessage = {
  id: string;
  at: string;
  fromNationId: string;
  text: string;
};

export type DiplomaticOutreach = {
  id: string;
  at: string;
  fromNationId: string;
  toNationId: string;
  messages: DiplomacyMessage[];
};

/** Append-only table events for GM / world digest (e.g. new forged seat). */
export type TableEventKind = "seat_forged";

export type TableEvent = {
  id: string;
  at: string;
  kind: TableEventKind;
  nationId: string;
  name: string;
};

export const MAX_TABLE_EVENTS_STORED = 32;

export type Nation = {
  id: string;
  name: string;
  /** Free-form nation build / government line players maintain */
  buildNotes: string;
  /** Optional forge review chronicle (Markdown); peers may open after finalize. */
  forgeBriefingMarkdown?: string;
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

export type StatImpactRecord = {
  id: string;
  at: string;
  roundIndex: number;
  nationId: string;
  deltas: Partial<Record<StatKey, number>>;
  reserveDelta: number;
};

export type GameSecret = {
  id: string;
  nationId: string;
  label: string;
  content: string;
  revealed: boolean;
};

export type EmergentSeverity =
  | "minor"
  | "moderate"
  | "major"
  | "world-shaking";

/** GM-logged emergent world beats (server truth; privateNotes stripped for clients). */
export type EmergentEventRecord = {
  id: string;
  at: string;
  eventTitle: string;
  description: string;
  affectedNationIds: string[];
  severity?: EmergentSeverity;
  /** GM-only; never sent to player clients. */
  privateNotes?: string;
};

/** Cap for emergentEvents on disk / in prompts. */
export const MAX_EMERGENT_EVENTS_STORED = 50;
export const MAX_STAT_IMPACTS_STORED = 120;

export type GameSession = {
  id: string;
  /** Short code for LAN join */
  roomCode: string;
  createdAt: string;
  updatedAt: string;
  promptVersion: number;
  phase: GamePhase;
  /**
   * Nation ids with an in-flight GM stream (user message enqueued + model streaming).
   * Other seats may still POST turns; only the same pov is blocked while listed here.
   */
  gmStreamingNationIds: string[];
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
  /**
   * Per-seat GM + user transcript. Legacy saves used a single `gmMessages` array;
   * migrateSession copies that into each forged seat once.
   */
  gmMessagesByNationId: Record<string, import("ai").UIMessage[]>;
  /** xAI Responses chain id per seat (optional per key). */
  lastGmResponseIdByNationId?: Record<string, string | undefined>;
  /** @deprecated Migrated into gmMessagesByNationId; read only for old JSON. */
  gmMessages?: import("ai").UIMessage[];
  /** @deprecated Use lastGmResponseIdByNationId. */
  lastGmResponseId?: string;
  /** Recent seat / table events for world snapshot (capped). */
  tableEvents?: TableEvent[];
  /** Bilateral messages; each party sees only threads they are part of (client filter). */
  diplomaticOutreach: DiplomaticOutreach[];
  /** GM tool append-only log; hydrate to [] in session-migrate for legacy saves. */
  emergentEvents: EmergentEventRecord[];
  /** Numeric stat/reserve impacts from apply_stat_deltas, shown in player-facing stat UI. */
  statImpacts: StatImpactRecord[];
};

export const MAX_REALLOC_POINTS_PER_TURN = 10;

export const STAT_MIN = 0;
export const STAT_MAX = 100;
