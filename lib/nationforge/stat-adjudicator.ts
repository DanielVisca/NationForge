import "server-only";

import { randomUUID } from "node:crypto";
import { generateText } from "ai";

import type { Nation, StatKey } from "./schema";
import {
  MAX_REALLOC_POINTS_PER_TURN,
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

    // Budget guard: eventful beats naturally propose more than the L1 cap.
    // Instead of dropping the whole move to a no-op (which froze stats on
    // exactly the interesting beats), trim it down to fit while preserving
    // direction, then defensively verify it passes the shared budget check.
    let { deltas: applyDeltas, reserveDelta: applyReserveDelta } = fitToBudget(
      deltas,
      reserveDelta,
      MAX_REALLOC_POINTS_PER_TURN,
    );
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

const RESERVE_KEY = "__reserve__";

/**
 * Trim a proposed move so the L1 budget (sum of |stat deltas| + |reserveDelta|)
 * fits within `cap`, preserving direction. Repeatedly shrinks the
 * largest-magnitude component by 1 — so the biggest intended swings survive and
 * small ones drop out first. Integer-only; guaranteed L1 <= cap on return.
 */
export function fitToBudget(
  deltas: StatDeltas,
  reserveDelta: number,
  cap: number,
): { deltas: StatDeltas; reserveDelta: number } {
  const comp = new Map<string, number>();
  for (const k of STAT_KEYS) {
    const v = Math.trunc(deltas[k] ?? 0);
    if (v !== 0) comp.set(k, v);
  }
  const r = Math.trunc(reserveDelta);
  if (r !== 0) comp.set(RESERVE_KEY, r);

  const l1 = () => [...comp.values()].reduce((a, v) => a + Math.abs(v), 0);

  let guard = 1000;
  while (l1() > cap && guard-- > 0) {
    let key: string | null = null;
    let best = 0;
    for (const [k, v] of comp) {
      if (Math.abs(v) > best) {
        best = Math.abs(v);
        key = k;
      }
    }
    if (!key) break;
    const v = comp.get(key)!;
    const nv = v - Math.sign(v);
    if (nv === 0) comp.delete(key);
    else comp.set(key, nv);
  }

  const outDeltas: StatDeltas = {};
  for (const k of STAT_KEYS) {
    const v = comp.get(k);
    if (v) outDeltas[k] = v;
  }
  return { deltas: outDeltas, reserveDelta: comp.get(RESERVE_KEY) ?? 0 };
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
- Move only the few stats the beat actually touches — at most 2–3 stats in a single beat. Leave the rest at 0.
- Deltas are small signed integers; ±1 to ±3 each. Even a dramatic beat is a nudge, not a leap.
- HARD LIMIT: the sum of the absolute values of all stat deltas plus the absolute value of reserveDelta MUST be <= 10. Stay safely under it; do not spread movement across all six stats.
- "No change" (every delta 0) is valid ONLY for pure deliberation, dialogue, or planning beats where nothing concrete happens. Do not invent movement on those.
- BUT a clearly consequential, concrete beat — disaster, war, plague, famine, economic shock, major breakthrough, treasury spent, territory or population gained or lost — MUST register: move at least one stat and/or reserve in the fiction's direction. Do not return all-zero for a beat where something materially happened.
- On quiet beats, gentle drift toward the nation's implied trajectory is allowed.
- Reflect THIS beat plus the nation's ongoing trajectory; pick the stats whose direction the fiction most clearly justifies.
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
