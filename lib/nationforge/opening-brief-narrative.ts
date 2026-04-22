import type { Nation } from "./schema";
import { STAT_KEYS } from "./schema";

/** Player-authored payload text for the first GM call after the table opens. */
export function buildOpeningBriefPlayerMessage(nation: Nation): string {
  const statLines = STAT_KEYS.map((k) => `${k}: ${nation.stats[k]}`).join("\n");
  return [
    "[NationForge — opening beat: first fifty years, then first event]",
    "",
    `POV nation: ${nation.name}`,
    `Reserve: ${nation.reserve}`,
    "",
    "Key stats (locked — describe in fiction only, never change the numbers):",
    statLines,
    "",
    "Forge build notes (authoritative texture for your prose):",
    nation.buildNotes,
    "",
    "What I want from you, GM — structure this opening dispatch clearly:",
    "",
    "1) **First 50 Years – A Brief History** — chronological or thematic sweep from founding through Year 50: how power, economy, culture, and borders evolved from the forge choices above.",
    "2) **Strengths and weaknesses at Year 50** — concrete snapshot: what this nation does well, what strains it, what could snap under pressure.",
    "3) **First event** — introduce one decisive situation (any in-world year you choose; not locked to Year 1). It can be political, military, social, environmental, a movement, a standout figure, diplomacy, or anything that fits — your pick. You may suggest angles in your prose, but the table will answer in **open-ended prose** (no forced multiple choice).",
    "4) **Do not resolve that first event** in this beat — leave the choice to us on the next message.",
    "5) Call **set_inflection** once at the end so the session crisis prompt matches the first event you described (vivid prompt; internal options for your bookkeeping). Replace the placeholder crisis entirely.",
    "6) Prefer **no_stat_change_this_turn** unless a tiny atmospheric nudge is clearly justified.",
    "",
    "Aim for depth and generativity; Markdown with ## headings is fine.",
  ].join("\n");
}
