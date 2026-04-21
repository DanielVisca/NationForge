import type { Nation } from "./schema";
import { STAT_KEYS } from "./schema";

/** Player-authored payload text for the first GM call after the table opens. */
export function buildOpeningBriefPlayerMessage(nation: Nation): string {
  const statLines = STAT_KEYS.map((k) => `${k}: ${nation.stats[k]}`).join("\n");
  return [
    "[NationForge — opening beat before the first crisis choice]",
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
    "What I want from you, GM:",
    "- Give me a rich, table-ready orientation to **this** polity: streets, factions, mood, and at least one tension implied by the build above.",
    "- Aim for roughly 5–9 paragraphs; Markdown with ## headings is fine if it reads better aloud.",
    "- Do **not** choose my crisis outcome; close by restating the table's Year-1 crisis in one or two neutral sentences so we can answer it on the next beat.",
    "- Prefer **no_stat_change_this_turn** unless a tiny atmospheric nudge is clearly justified.",
  ].join("\n");
}
