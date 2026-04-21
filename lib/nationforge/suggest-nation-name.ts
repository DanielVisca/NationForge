import "server-only";

import { generateText } from "ai";

import {
  choiceById,
  SINGLE_STEP_SELECTION_KEY,
  type NationForgeSelections,
} from "./nation-forge-catalog";
import { defaultModelId, requireXaiApiKey, xai } from "@/lib/xai";

const SINGLE_PICK_STEPS = Object.keys(
  SINGLE_STEP_SELECTION_KEY,
) as (keyof typeof SINGLE_STEP_SELECTION_KEY)[];

function summarizeSelections(s: NationForgeSelections): string {
  const lines: string[] = [];
  for (const stepId of SINGLE_PICK_STEPS) {
    const key = SINGLE_STEP_SELECTION_KEY[stepId];
    const id = s[key];
    if (typeof id !== "string" || !id) continue;
    const label = choiceById(stepId, id)?.label ?? id;
    lines.push(`${stepId}: ${label}`);
  }
  for (const id of s.demographicsAddons ?? []) {
    const label = choiceById("demographicsAddons", id)?.label ?? id;
    lines.push(`add-on: ${label}`);
  }
  return lines.join("\n");
}

function heuristicName(s: NationForgeSelections): string {
  const gov = s.government ? choiceById("government", s.government)?.label : "";
  const cul = s.cultural ? choiceById("cultural", s.cultural)?.label : "";
  const parts = [gov, cul].filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "The Unwritten Republic";
  return parts.join(" · ").slice(0, 80);
}

function sanitizeName(raw: string): string {
  const t = raw
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 80);
  return t || "The Unwritten Republic";
}

export async function suggestNationNameFromSelections(
  s: NationForgeSelections,
): Promise<string> {
  const summary = summarizeSelections(s);
  requireXaiApiKey();
  const { text } = await generateText({
    model: xai.responses(defaultModelId),
    prompt: `You name fictional nation-states for a political grand-strategy game. Given this build (policies only, no real countries):

${summary}

Reply with ONE short proper-noun style name only (2–5 words), no quotes, no colon, no explanation. Evocative but not offensive.`,
    maxOutputTokens: 60,
  });
  return sanitizeName(text);
}

export async function suggestNationNameOrHeuristic(
  s: NationForgeSelections,
): Promise<string> {
  try {
    return await suggestNationNameFromSelections(s);
  } catch {
    return sanitizeName(heuristicName(s));
  }
}
