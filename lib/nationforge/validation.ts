import type { NationStats, StatKey } from "./schema";
import {
  MAX_REALLOC_POINTS_PER_TURN,
  STAT_KEYS,
  STAT_MAX,
  STAT_MIN,
} from "./schema";

export type StatDeltas = Partial<Record<StatKey, number>>;

export function clampStat(n: number): number {
  return Math.min(STAT_MAX, Math.max(STAT_MIN, Math.round(n)));
}

/** L1 movement cap: total absolute stat movement + abs(reserve delta) per GM tool invocation. */
export function validateReallocBudget(
  deltas: StatDeltas,
  reserveDelta: number,
): { ok: true } | { ok: false; reason: string } {
  let statMove = 0;
  for (const k of STAT_KEYS) {
    const v = deltas[k];
    if (v === undefined || v === 0) continue;
    statMove += Math.abs(v);
  }
  const reserveMove = Math.abs(reserveDelta);
  const total = statMove + reserveMove;
  if (total > MAX_REALLOC_POINTS_PER_TURN) {
    return {
      ok: false,
      reason: `Realloc budget exceeded: ${total} > ${MAX_REALLOC_POINTS_PER_TURN} (stats+reserve movement).`,
    };
  }
  return { ok: true };
}

export function applyDeltasToStats(
  stats: NationStats,
  deltas: StatDeltas,
): NationStats {
  const next = { ...stats };
  for (const k of STAT_KEYS) {
    const d = deltas[k];
    if (d === undefined) continue;
    next[k] = clampStat((next[k] ?? 0) + d);
  }
  return next;
}

export function validateCrisisOptionIds(
  optionIds: string[],
  allowed: Set<string>,
): { ok: true } | { ok: false; reason: string } {
  for (const id of optionIds) {
    if (!allowed.has(id)) {
      return { ok: false, reason: `Unknown crisis option id: ${id}` };
    }
  }
  return { ok: true };
}
