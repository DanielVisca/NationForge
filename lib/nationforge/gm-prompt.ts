import type { DiplomaticOutreach, GameSession } from "./schema";
import {
  GM_GOVERNANCE_CLIP,
  MAX_REALLOC_POINTS_PER_TURN,
} from "./schema";

function clipGovernance(text: string): string {
  const t = text.trim();
  if (t.length <= GM_GOVERNANCE_CLIP) return t;
  return `${t.slice(0, GM_GOVERNANCE_CLIP)}…`;
}

function clipDiploText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

const DIPLO_CLIP = 900;
const RECENT_DIPLOMACY = 32;

function outreachForGm(
  list: DiplomaticOutreach[],
  nameById: Map<string, string>,
): unknown[] {
  const tail = list.slice(-RECENT_DIPLOMACY);
  return tail.map((o) => ({
    at: o.at,
    from: nameById.get(o.fromNationId) ?? o.fromNationId,
    to: nameById.get(o.toNationId) ?? o.toNationId,
    message: clipDiploText(o.message, DIPLO_CLIP),
    reply: o.reply
      ? {
          at: o.reply.at,
          text: clipDiploText(o.reply.text, DIPLO_CLIP),
        }
      : undefined,
  }));
}

export function buildGmSystemPrompt(session: GameSession): string {
  const nameById = new Map(session.nations.map((n) => [n.id, n.name]));
  const stateJson = JSON.stringify(
    {
      roundIndex: session.roundIndex,
      activeNationId: session.activeNationId,
      nations: session.nations.map((n) => ({
        id: n.id,
        name: n.name,
        buildNotes: n.buildNotes,
        governanceNotes: clipGovernance(n.domesticScratch ?? ""),
        stats: n.stats,
        reserve: n.reserve,
      })),
      crisis: session.crisis,
      recentDiplomacy: outreachForGm(
        session.diplomaticOutreach ?? [],
        nameById,
      ),
    },
    null,
    2,
  );

  return `You are the NationForge GM (promptVersion ${session.promptVersion}).

RULES:
- Each nation has ongoing governanceNotes (player-authored, updated between turns). Use them to reflect how they govern domestically, internal pressures, and continuity. They are not automatic stat changes unless the player also asks for that in their storyline turn and you apply tools.
- recentDiplomacy lists bilateral messages between two nations (initiator → recipient, optional reply). Recipients may ignore outreach in the UI; honor who spoke, who answered, and who stayed silent. Weave this into regional politics when relevant.
- Crises may involve one nation or many (see crisis.activeNationIds). Prefer inflections that match that scope.
- If the latest player message includes "(orientationRequest: first opening beat — crisis choice deferred)", write a rich orientation to that nation from their locked stats and build notes first; tee up the crisis at the end without choosing it for them. Their next normal turn should pick a crisis option or custom response.
- Narrate outcomes, diplomacy, tension, and optional movie picks in natural language.
- Do NOT invent new stat totals in prose. The UI shows numbers from the database only.
- ANY change to the six Key Stats (Prosperity, Stability, Freedom, Power, Happiness, Innovation) or reserve MUST be done by calling the tool apply_stat_deltas with explicit integer deltas per nation (omit nations you do not change).
- Per tool call, total movement is capped: sum of absolute stat deltas across all nations in that call + absolute reserveDelta for each affected nation must respect the realloc budget of ${MAX_REALLOC_POINTS_PER_TURN} points per nation per invocation for the stats+reserve movement you attach to that nation (each nation entry is validated separately).
- If nothing numeric changes this turn, call no_stat_change_this_turn once.
- After resolving, call set_inflection with the next crisis (id, prompt, 4–5 options with stable string ids, allowCustom: true, activeNationIds).
- Call append_turn_log with a short public summary; use privateByNationId only for strings that should stay hidden from other nations' players (LAN mode).
- For player secrets, call register_secret when they declare a secret action.

Current authoritative state:
${stateJson}
`;
}
