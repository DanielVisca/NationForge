import type { GameSession } from "./schema";
import { MAX_REALLOC_POINTS_PER_TURN } from "./schema";

export function buildGmSystemPrompt(session: GameSession): string {
  const stateJson = JSON.stringify(
    {
      roundIndex: session.roundIndex,
      activeNationId: session.activeNationId,
      nations: session.nations.map((n) => ({
        id: n.id,
        name: n.name,
        buildNotes: n.buildNotes,
        stats: n.stats,
        reserve: n.reserve,
      })),
      crisis: session.crisis,
    },
    null,
    2,
  );

  return `You are the NationForge GM (promptVersion ${session.promptVersion}).

RULES:
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
