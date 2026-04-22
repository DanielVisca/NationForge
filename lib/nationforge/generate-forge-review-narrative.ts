import "server-only";

import { generateText } from "ai";

import type { NationStats } from "./schema";
import { STAT_KEYS } from "./schema";
import { defaultModelId, requireXaiApiKey, xai } from "@/lib/xai";

export type ForgeReviewFacts = {
  nationName: string;
  spend: number;
  reserve: number;
  stats: NationStats;
  buildNotes: string;
  synergyLines: string[];
};

function heuristicReviewMarkdown(f: ForgeReviewFacts): string {
  const syn =
    f.synergyLines.length > 0
      ? f.synergyLines.map((line) => `- ${line}`).join("\n")
      : "- *No extra scripted synergy package on this build — your pillars do the talking.*";

  const statsLines = STAT_KEYS.map(
    (k) =>
      `- **${k}** — ${f.stats[k]}/100 (this is the number the GM and board will use)`,
  ).join("\n");

  return [
    `## ${f.nationName}`,
    "",
    "### Your allocation",
    "",
    `- **Spend:** ${f.spend} / 100 pts`,
    `- **Reserve:** ${f.reserve} pts (extra stability cushion when crises hit the table)`,
    "",
    "### Authoritative build log",
    "",
    "```",
    f.buildNotes,
    "```",
    "",
    "### Key stats (locked for play)",
    "",
    statsLines,
    "",
    "### Scripted synergies (mechanical hooks)",
    "",
    syn,
    "",
    "> **Want the full story?** Add \`XAI_API_KEY\` and tap **Refresh chronicle** on the review step — Grok will expand this into a GM-style briefing in Markdown.",
  ].join("\n");
}

export async function generateForgeReviewNarrativeOrHeuristic(
  f: ForgeReviewFacts,
): Promise<string> {
  try {
    requireXaiApiKey();
  } catch {
    return heuristicReviewMarkdown(f);
  }

  const payload = JSON.stringify({
    nationName: f.nationName,
    spend: f.spend,
    reserve: f.reserve,
    stats: f.stats,
    synergyLines: f.synergyLines,
    buildNotes: f.buildNotes,
  });

  try {
    const { text } = await generateText({
      model: xai.responses(defaultModelId),
      prompt: `You are the NationForge narrator — upbeat, GM-facing, for players at a physical or online table building a fictional polity before a grand-strategy roleplay.

Write **one** Markdown document they read on the final "review" screen before locking in. Go long on flavor; keep mechanics honest.

## Hard rules
- Output **Markdown only** (## / ### headings, bullets, **bold**, short paragraphs). No HTML.
- The JSON below is **authoritative**. Do **not** change spend, reserve, any stat number, or contradict listed picks. You may only narrate and dramatize what is already there.
- Do **not** invent new mechanical bonuses beyond what synergy lines imply; those lines are story hooks tied to real in-game nudges.
- Fictional setting only; inclusive; no slurs; do not vilify real-world peoples or countries by name.
- Do **not** write a multi-decade timeline, "opening era", or **first-fifty-years** style campaign opening. The player has **not** locked this nation into play yet; the live GM delivers that official opening only **after** they finalize the forge and the table opens. This document is a pre-lock table read only.
- Aim roughly **900–1800 words** unless the build is extremely minimal — lean into tensions, everyday life, who holds power, and how it *feels* to live there.

## Content to cover (use headings; rename or merge if it reads better)
1. **At a glance** — punchy recap of each pillar choice and point costs in gamer language (can mirror the build log briefly).
2. **Nation overview** — several paragraphs: geography-agnostic portrait of society, economy, labor, elites vs masses.
3. **Your stats as fiction** — for each of the six stats, tie the **exact number** to how citizens and rivals experience this nation (one focused paragraph or two short ones per stat).
4. **Synergies & contradictions** — weave synergy lines into drama; spotlight clashing picks (e.g. freedom vs control, growth vs ecology) even if synergy list is empty.
5. **Fault lines going into play (no era timeline)** — where this build is likely to snag once the sim runs: institutions, legitimacy, external envy, internal factions. You may reference **reserve** as cushion vs fragility, but do **not** narrate decades of in-world history — that stays with the GM after lock-in.
6. **Strengths** and **Pressure points** — tight bullet lists the player can use at the table.

## Authoritative facts (JSON)
${payload}`,
      maxOutputTokens: 3200,
    });
    const trimmed = text.trim();
    if (!trimmed) return heuristicReviewMarkdown(f);
    return trimmed;
  } catch {
    return heuristicReviewMarkdown(f);
  }
}
