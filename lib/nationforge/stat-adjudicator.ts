import "server-only";

import { randomUUID } from "node:crypto";
import { generateText } from "ai";

import type { Nation, StatKey } from "./schema";
import {
  MAX_STAT_IMPACTS_STORED,
  MAX_TRAJECTORY_LENGTH,
  STAT_KEYS,
} from "./schema";
import {
  applyDeltasToStats,
  type StatDeltas,
  validateReallocBudget,
} from "./validation";
import { getGameSession, updateGameSession } from "./store";
import { defaultModelId, xai } from "@/lib/xai";

/**
 * Silent post-beat stat reconciliation.
 *
 * The GM (a fast model) narrates outcomes but rarely calls `apply_stat_deltas`,
 * so nation stats freeze at their forge values. This best-effort pass runs AFTER
 * each committed GM beat and nudges the pov nation's six Key Stats + reserve so
 * the numbers track the fiction. It is numbers-only (the UI surfaces them) and
 * MUST NEVER throw or delay the player's beat.
 */
export async function runStatAdjudication(opts: {
  sessionId: string;
  povNationId: string;
  beatProse: string;
  gmAlreadyMovedStats: boolean;
}): Promise<void> {
  try {
    const flag = process.env.NATIONFORGE_STAT_ADJUDICATOR_ENABLED?.trim().toLowerCase();
    if (flag === "0" || flag === "false") return;

    // Trust the GM when it already moved stats this beat; do not double-move.
    if (opts.gmAlreadyMovedStats) return;
    if (!opts.beatProse.trim()) return;

    const session = await getGameSession(opts.sessionId);
    if (!session) return;
    const nation = session.nations.find((n) => n.id === opts.povNationId);
    if (!nation) return;

    const currentTrajectory = session.trajectoryByNation?.[opts.povNationId] ?? "";

    const parsed = await requestAdjudication({
      nation,
      currentTrajectory,
      beatProse: opts.beatProse,
    });
    if (!parsed) return;

    const { deltas, reserveDelta, trajectory } = parsed;

    // Budget guard: never apply an over-budget move — drop the numbers to a
    // no-op (but still allow a trajectory-only update below).
    let applyDeltas: StatDeltas = deltas;
    let applyReserveDelta = reserveDelta;
    if (!validateReallocBudget(applyDeltas, applyReserveDelta).ok) {
      applyDeltas = {};
      applyReserveDelta = 0;
    }

    const hasNumericChange =
      STAT_KEYS.some((k) => (applyDeltas[k] ?? 0) !== 0) || applyReserveDelta !== 0;
    if (!hasNumericChange && !trajectory) return;

    await updateGameSession(opts.sessionId, (s) => {
      const idx = s.nations.findIndex((n) => n.id === opts.povNationId);
      if (idx === -1) return;

      const fresh = s.nations[idx];

      // Enforce reserve floor: clamp the reserve change so reserve stays >= 0.
      let reserveDeltaToApply = applyReserveDelta;
      if (fresh.reserve + reserveDeltaToApply < 0) {
        reserveDeltaToApply = -fresh.reserve;
      }

      const newStats = applyDeltasToStats(fresh.stats, applyDeltas);
      const newReserve = fresh.reserve + reserveDeltaToApply;
      const updated: Nation = {
        ...fresh,
        stats: newStats,
        reserve: newReserve,
      };
      s.nations[idx] = updated;

      const nonZeroDeltas = Object.fromEntries(
        Object.entries(applyDeltas).filter(([, v]) => v !== 0),
      ) as Partial<Record<StatKey, number>>;
      const hasImpact =
        Object.keys(nonZeroDeltas).length > 0 || reserveDeltaToApply !== 0;
      if (hasImpact) {
        s.statImpacts = [
          ...s.statImpacts,
          {
            id: randomUUID(),
            at: new Date().toISOString(),
            roundIndex: s.roundIndex,
            nationId: opts.povNationId,
            deltas: nonZeroDeltas,
            reserveDelta: reserveDeltaToApply,
          },
        ].slice(-MAX_STAT_IMPACTS_STORED);
      }

      if (trajectory) {
        s.trajectoryByNation = {
          ...s.trajectoryByNation,
          [opts.povNationId]: trajectory.slice(0, MAX_TRAJECTORY_LENGTH),
        };
      }
    });
  } catch (e) {
    console.error("[nationforge/stat-adjudicator]", e);
  }
}

type AdjudicationResult = {
  deltas: StatDeltas;
  reserveDelta: number;
  trajectory: string;
};

/** Small structured LLM call; returns sanitized deltas or null on any failure. */
async function requestAdjudication(args: {
  nation: Nation;
  currentTrajectory: string;
  beatProse: string;
}): Promise<AdjudicationResult | null> {
  const { nation, currentTrajectory, beatProse } = args;

  const statsLine = STAT_KEYS.map((k) => `${k}=${nation.stats[k] ?? 0}`).join(", ");

  const system = `You are a neutral bookkeeper for a nation-simulation game. After each story beat you reconcile a nation's six Key Stats and its reserve so the numbers reflect the fiction. You output numbers only — never prose, never commentary.

Rules:
- The six Key Stats are prosperity, stability, freedom, power, happiness, innovation. Each is 0–100. Reserve is >= 0.
- Deltas are small signed integers; ±1 to ±4 is typical. A delta of 0 means no change.
- The sum of the absolute values of all stat deltas plus the absolute value of reserveDelta MUST be <= 10.
- "No change" (every delta 0) is valid and common for pure deliberation, dialogue, or planning beats. Do not invent movement.
- On quiet beats, gentle drift toward the nation's implied trajectory is allowed.
- Reflect THIS beat plus the nation's ongoing trajectory.
- Respond with ONLY a single-line minified JSON object — no prose, no markdown, no code fences.`;

  const prompt = `Nation current Key Stats: ${statsLine}
Nation current reserve: ${nation.reserve}
Nation current trajectory: ${currentTrajectory || "(none recorded)"}

This beat's GM prose:
${beatProse}

Respond with ONLY this single-line minified JSON object (no code fences):
{"deltas":{"prosperity":0,"stability":0,"freedom":0,"power":0,"happiness":0,"innovation":0},"reserveDelta":0,"trajectory":"<=240 char one-line current direction"}`;

  let raw: string;
  try {
    const result = await generateText({
      model: xai.responses(defaultModelId),
      system,
      prompt,
      maxOutputTokens: 512,
    });
    raw = result.text;
  } catch (e) {
    console.error("[nationforge/stat-adjudicator] generateText failed", e);
    return null;
  }

  return parseAdjudication(raw);
}

/** Robustly extract + parse the JSON object; returns sanitized result or null. */
export function parseAdjudication(raw: string): AdjudicationResult | null {
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

  const record = obj as {
    deltas?: unknown;
    reserveDelta?: unknown;
    trajectory?: unknown;
  };

  const deltas: StatDeltas = {};
  if (record.deltas && typeof record.deltas === "object") {
    const src = record.deltas as Record<string, unknown>;
    for (const k of STAT_KEYS) {
      const v = src[k];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const n = Math.trunc(v);
      if (n === 0) continue;
      deltas[k] = n;
    }
  }

  let reserveDelta = 0;
  if (typeof record.reserveDelta === "number" && Number.isFinite(record.reserveDelta)) {
    reserveDelta = Math.trunc(record.reserveDelta);
  }

  let trajectory = "";
  if (typeof record.trajectory === "string") {
    trajectory = record.trajectory.replace(/\s+/g, " ").trim();
  }

  return { deltas, reserveDelta, trajectory };
}
