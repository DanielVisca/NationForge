import "server-only";

import { generateText } from "ai";

import type { InteractionKind, Nation } from "./schema";
import { makeInteraction, pushInteractionCapped } from "./interactions";
import { getGameSession, updateGameSession } from "./store";
import { defaultModelId, xai } from "@/lib/xai";

/**
 * Silent post-beat cross-nation interaction extraction.
 *
 * When nation A acts toward nation B in prose ("we send envoys to Beta
 * requesting aid"), B's seat must learn of it via the shared ledger
 * (`session.interactions`). We have a `signal_nation` GM tool for this, but the
 * fast GM model does NOT reliably call it, so the ledger stays empty and the
 * target never finds out. This best-effort pass reads the actual prose AFTER a
 * committed GM beat and writes directed ledger records server-side — it does
 * not trust the model to call a tool. It MUST NEVER throw or delay the beat.
 *
 * Mirrors the stat-adjudicator pattern: env flag gate, small structured
 * generateText call, robust JSON parsing, applied via a locked
 * updateGameSession, with a top-level try/catch that swallows all errors.
 */
export async function runInteractionExtraction(opts: {
  sessionId: string;
  povNationId: string;
  playerProse: string;
  beatProse: string;
  /** ISO timestamp captured when this turn began; dedupe is scoped to records
   *  created during THIS beat (signal_nation / a re-run), so a genuinely new
   *  overture in a later beat to the same nation is still recorded. */
  sinceAt: string;
}): Promise<void> {
  try {
    const flag =
      process.env.NATIONFORGE_INTERACTION_EXTRACTOR_ENABLED?.trim().toLowerCase();
    if (flag === "0" || flag === "false") return;

    const session = await getGameSession(opts.sessionId);
    if (!session) return;

    const pov = session.nations.find((n) => n.id === opts.povNationId);
    if (!pov) return;

    const others = session.nations.filter(
      (n) => n.id !== opts.povNationId && n.forgeComplete,
    );
    if (others.length === 0) return; // no one to interact with

    const parsed = await requestExtraction({
      povName: pov.name,
      others,
      playerProse: opts.playerProse,
      beatProse: opts.beatProse,
    });
    if (!parsed || parsed.length === 0) return;

    // Resolve targets to ids, validate kind, trim summary.
    type ResolvedItem = {
      targetId: string;
      kind: InteractionKind;
      summary: string;
    };
    const resolved: ResolvedItem[] = [];
    for (const item of parsed) {
      const targetId = resolveTargetId(item.target, others);
      if (!targetId) continue;
      const summary = item.summary.trim();
      if (!summary) continue;
      resolved.push({ targetId, kind: item.kind, summary });
    }
    if (resolved.length === 0) return;

    // Dedupe ONLY against records created during THIS beat (the signal_nation
    // tool or a re-run of this pass), identified by timestamp >= the turn start.
    // A round-window check wrongly swallowed a genuinely new overture in a later
    // beat to the same nation; scoping to this beat fixes that.
    const existsThisBeat = (targetId: string): boolean =>
      (session.interactions ?? []).some(
        (i) =>
          i.at >= opts.sinceAt &&
          i.fromNationId === opts.povNationId &&
          i.toNationIds.includes(targetId),
      );
    const fresh = resolved.filter((r) => !existsThisBeat(r.targetId));
    if (fresh.length === 0) return;

    await updateGameSession(opts.sessionId, (s) => {
      for (const r of fresh) {
        // Re-check dedupe against the FRESH ledger inside the lock so a
        // concurrent signal_nation / re-run cannot create duplicates.
        const dup = s.interactions.some(
          (i) =>
            i.at >= opts.sinceAt &&
            i.fromNationId === opts.povNationId &&
            i.toNationIds.includes(r.targetId),
        );
        if (dup) continue;
        s.interactions = pushInteractionCapped(
          s.interactions,
          makeInteraction({
            fromNationId: opts.povNationId,
            toNationIds: [r.targetId],
            kind: r.kind,
            summary: r.summary,
            round: s.roundIndex,
            origin: "player_prose",
            visibility: "directed",
          }),
        );
      }
    });
  } catch (e) {
    console.error("[nationforge/interaction-extractor]", e);
  }
}

const INTERACTION_KINDS: InteractionKind[] = [
  "diplomacy",
  "aid",
  "trade",
  "threat",
  "military",
  "covert",
  "info",
  "other",
];

/**
 * Resolve a model-supplied target name to a nation id among `others`.
 * Case-insensitive exact match first, then case-insensitive contains match
 * (either direction). Returns null if unresolved.
 */
function resolveTargetId(target: string, others: Nation[]): string | null {
  const t = target.trim().toLowerCase();
  if (!t) return null;

  const exact = others.find((n) => n.name.trim().toLowerCase() === t);
  if (exact) return exact.id;

  const contains = others.find((n) => {
    const name = n.name.trim().toLowerCase();
    if (!name) return false;
    return t.includes(name) || name.includes(t);
  });
  return contains ? contains.id : null;
}

type ExtractedItem = {
  target: string;
  kind: InteractionKind;
  summary: string;
};

/** Small structured LLM call; returns extracted items or null on any failure. */
async function requestExtraction(args: {
  povName: string;
  others: Nation[];
  playerProse: string;
  beatProse: string;
}): Promise<ExtractedItem[] | null> {
  const { povName, others, playerProse, beatProse } = args;
  const otherNames = others.map((n) => n.name).join(", ");

  const system = `You extract directed cross-nation actions from a turn in a nations game. The acting nation is ${povName}. The other nations are: ${otherNames}. Given the acting nation's stated move and the GM's narration of this beat, list any CONCRETE action the acting nation directed AT one or more of those other nations this beat — an offer, request, threat, aid, trade proposal, envoy/diplomatic contact, shared intel, or military move. Only include actions actually aimed at a named other nation. Ignore purely internal/domestic actions and vague musings. Respond with ONLY a single-line minified JSON object, no prose/markdown/fences.`;

  const prompt = `Acting nation: ${povName}
Other nations: ${otherNames}

Player's stated move:
${playerProse}

GM narration of the beat:
${beatProse}

Respond with ONLY this single-line minified JSON object (no code fences), empty array if no directed actions:
{"interactions":[{"target":"<exact other-nation name>","kind":"diplomacy|aid|trade|threat|military|covert|info|other","summary":"<short third-person: what the acting nation did toward them, <=200 chars>"}]}`;

  let raw: string;
  try {
    const result = await generateText({
      model: xai.responses(defaultModelId),
      system,
      prompt,
      maxOutputTokens: 400,
    });
    raw = result.text;
  } catch (e) {
    console.error("[nationforge/interaction-extractor] generateText failed", e);
    return null;
  }

  return parseExtraction(raw);
}

/** Robustly extract + parse the JSON object; returns sanitized items or null. */
export function parseExtraction(raw: string): ExtractedItem[] | null {
  if (!raw) return null;
  // Strip code fences / backticks, then grab the first {...} object.
  const stripped = raw.replace(/```[a-zA-Z]*/g, "").replace(/`/g, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = stripped.slice(start, end + 1);

  let obj: unknown;
  try {
    obj = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const list = (obj as { interactions?: unknown }).interactions;
  if (!Array.isArray(list)) return null;

  const items: ExtractedItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as {
      target?: unknown;
      kind?: unknown;
      summary?: unknown;
    };
    if (typeof rec.target !== "string") continue;
    if (typeof rec.summary !== "string") continue;
    const target = rec.target.trim();
    const summary = rec.summary.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!target || !summary) continue;
    const kind: InteractionKind =
      typeof rec.kind === "string" &&
      (INTERACTION_KINDS as string[]).includes(rec.kind)
        ? (rec.kind as InteractionKind)
        : "other";
    items.push({ target, kind, summary });
  }
  return items;
}
