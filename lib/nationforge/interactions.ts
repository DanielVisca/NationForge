import { randomUUID } from "node:crypto";

import type {
  GameSession,
  InteractionKind,
  InteractionRecord,
  InteractionVisibility,
} from "./schema";
import { MAX_INBOUND_IN_PROMPT, MAX_INTERACTIONS_STORED } from "./schema";

/**
 * Cross-nation interaction ledger helpers.
 *
 * The ledger (`session.interactions`) is the single source of truth for "nation
 * A did something toward nation B". It is written from two places — the GM's
 * `signal_nation` tool and (later) prose auto-extraction — and read into each
 * seat's GM prompt as a mandatory "pending inbound" section so a target nation
 * reliably becomes aware that another nation acted on it, instead of each seat's
 * GM inventing contradictory fictions.
 */

/** Build a pending InteractionRecord with id/at/status defaults filled in. */
export function makeInteraction(input: {
  fromNationId: string;
  toNationIds: string[];
  kind: InteractionKind;
  summary: string;
  round: number;
  origin: "player_prose" | "gm_narration";
  visibility?: InteractionVisibility;
  detailByNation?: Record<string, string>;
  at?: string;
}): InteractionRecord {
  const toNationIds = [...new Set(input.toNationIds.filter(Boolean))];
  return {
    id: randomUUID(),
    at: input.at ?? new Date().toISOString(),
    round: input.round,
    fromNationId: input.fromNationId,
    toNationIds,
    kind: input.kind,
    summary: input.summary.trim(),
    detailByNation: input.detailByNation,
    origin: input.origin,
    visibility: input.visibility ?? "directed",
    status: "pending",
    acknowledgedBy: [],
  };
}

/** Append a record and cap the ledger length. Pure (returns a new array). */
export function pushInteractionCapped(
  interactions: InteractionRecord[],
  record: InteractionRecord,
): InteractionRecord[] {
  return [...interactions, record].slice(-MAX_INTERACTIONS_STORED);
}

/**
 * Interactions this nation has NOT yet folded into a beat: it is a target,
 * it has not acknowledged the record, and the record is still live.
 * Most-recent first.
 */
export function pendingInboundForNation(
  session: GameSession,
  nationId: string,
): InteractionRecord[] {
  const list = (session.interactions ?? []).filter(
    (i) =>
      i.fromNationId !== nationId &&
      i.toNationIds.includes(nationId) &&
      !i.acknowledgedBy.includes(nationId) &&
      i.status !== "resolved" &&
      i.status !== "stale",
  );
  return list.slice().reverse();
}

/**
 * Mark every pending inbound for `nationId` as acknowledged by it (the seat has
 * now had a beat where the inbound was shown). When all targets of a record have
 * acknowledged, the record flips to "acknowledged". Pure (returns a new array).
 */
export function acknowledgeInbound(
  interactions: InteractionRecord[],
  nationId: string,
): InteractionRecord[] {
  return interactions.map((i) => {
    if (
      i.fromNationId === nationId ||
      !i.toNationIds.includes(nationId) ||
      i.acknowledgedBy.includes(nationId)
    ) {
      return i;
    }
    const acknowledgedBy = [...i.acknowledgedBy, nationId];
    const allAck = i.toNationIds.every((t) => acknowledgedBy.includes(t));
    return {
      ...i,
      acknowledgedBy,
      status: allAck && i.status === "pending" ? "acknowledged" : i.status,
    };
  });
}

/**
 * Render the mandatory "PENDING INBOUND" block for a seat's GM prompt, or "" if
 * none. Caps to MAX_INBOUND_IN_PROMPT recent items and digests the remainder.
 */
export function formatInboundForPrompt(
  session: GameSession,
  nationId: string,
): string {
  const pending = pendingInboundForNation(session, nationId);
  if (pending.length === 0) return "";

  const nameById = new Map(session.nations.map((n) => [n.id, n.name]));
  const shown = pending.slice(0, MAX_INBOUND_IN_PROMPT);
  const lines = shown.map((i) => {
    const from = nameById.get(i.fromNationId) ?? i.fromNationId;
    const detail = i.detailByNation?.[nationId];
    const text = detail?.trim() ? detail.trim() : i.summary;
    return `- [round ${i.round}] ${from} (${i.kind}): ${text}`;
  });
  const extra = pending.length - shown.length;
  const more = extra > 0 ? `\n- (+${extra} older overture(s) still pending)` : "";

  return `PENDING INBOUND — other nations have ACTED TOWARD YOU and you have not yet responded. You MUST acknowledge and fold these into THIS beat (accept, refuse, counter, stall, or react in-world). Do not pretend they did not happen, and never claim "silence" when an item is listed here:
${lines.join("\n")}${more}`;
}
