import type { UIMessage } from "ai";

import type {
  EmergentEventRecord,
  GameSession,
  InteractionKind,
  InteractionStatus,
  InteractionVisibility,
  Nation,
} from "./schema";

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

/**
 * Cross-nation ledger record exposed to a client. Privacy-filtered: only public
 * records, or directed records where the viewer is the sender or a target, reach
 * the client. The raw per-target `detailByNation` map is dropped; `detail` carries
 * only the viewer's own entry, if any.
 */
export type PublicInteraction = {
  id: string;
  at: string;
  round: number;
  fromNationId: string;
  toNationIds: string[];
  kind: InteractionKind;
  summary: string;
  visibility: InteractionVisibility;
  status: InteractionStatus;
  /** The viewer's own entry from detailByNation, if any. */
  detail?: string;
};

/** A still-pending inbound interaction directed at the viewer nation. */
export type PublicInboundItem = {
  id: string;
  at: string;
  round: number;
  fromNationId: string;
  fromName: string;
  kind: InteractionKind;
  summary: string;
  /** The viewer's own entry from detailByNation, if any. */
  detail?: string;
};

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
  | "interactions"
  | "trajectoryByNation"
> & {
  nations: Nation[];
  nationRoster: NationRosterEntry[];
  secrets: PublicSecret[];
  turnLog: PublicTurnLogEntry[];
  emergentEvents: PublicEmergentEvent[];
  /** This seat’s GM transcript only (sanitized). */
  gmMessages: UIMessage[];
  /** Privacy-filtered cross-nation ledger; trajectoryByNation never reaches the client. */
  interactions: PublicInteraction[];
  /** Interactions still awaiting the viewer nation's response; [] for spectators. */
  pendingInbound: PublicInboundItem[];
  viewerNationId: string | null;
};
