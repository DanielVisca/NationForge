import "server-only";

import { randomUUID } from "node:crypto";

import {
  choiceById,
  clearForgeSelectionsAfterStepIndex,
  computeSpend,
  FORGE_POINT_BUDGET,
  FORGE_STEP_IDS,
  SINGLE_STEP_SELECTION_KEY,
  stepIdAtIndex,
} from "./nation-forge-catalog";
import { resolveForgeToNation } from "./nation-forge-resolve";
import { migrateSession, normalizeNation } from "./session-migrate";
import type { Crisis, GameSession, Nation } from "./schema";

export type ForgeClientAction =
  | { type: "pick"; choiceId: string }
  | { type: "setAddons"; ids: string[] }
  | { type: "back" }
  | { type: "finalize" };

function starterCrisisForNations(nationIds: string[]): Crisis {
  const n = nationIds.length;
  const prompt =
    n <= 1
      ? "Year 1 — your power defines the frontier. Choose how the era opens."
      : n === 2
        ? "Year 1 — both powers scan the frontier. Choose how your nation opens the era."
        : `Year 1 — ${n} powers scan the frontier. Choose how your nation opens the era.`;
  return {
    id: randomUUID(),
    prompt,
    options: [
      { id: "a", label: "Signal peaceful intent; invest in trade envoys" },
      { id: "b", label: "Fortify borders; prioritize internal security" },
      { id: "c", label: "Secretly accelerate a high-risk research program" },
      { id: "d", label: "Demand joint inspection of shared infrastructure" },
    ],
    allowCustom: true,
    activeNationIds: [...nationIds],
  };
}

function nationIndexByToken(session: GameSession, token: string): number {
  for (let i = 0; i < session.nations.length; i++) {
    const nid = session.nations[i]!.id;
    if (session.seatTokens[nid] === token) return i;
  }
  return -1;
}

function maybeStartFirstBeat(s: GameSession): GameSession {
  if (s.gameStarted) return s;
  if (s.nations.length === 0) return s;
  if (!s.nations.every((n) => n.forgeComplete)) return s;
  const ids = s.nations.map((n) => n.id);
  return {
    ...s,
    gameStarted: true,
    crisis: starterCrisisForNations(ids),
    phase: "awaiting_decision",
    activeNationId: s.activeNationId || ids[0]!,
  };
}

export function applyForgeActionToSession(
  session: GameSession,
  nationIndex: number,
  action: ForgeClientAction,
): { ok: true; session: GameSession } | { ok: false; error: string } {
  const s = migrateSession(session);
  const nation = s.nations[nationIndex];
  if (!nation || nation.forgeComplete || !nation.forgeProgress) {
    return { ok: false, error: "Nation is not in forge mode." };
  }

  const progress = nation.forgeProgress;
  const stepId = stepIdAtIndex(progress.stepIndex);
  if (!stepId) {
    return { ok: false, error: "Invalid forge step." };
  }

  if (action.type === "back") {
    const nextIndex = Math.max(0, progress.stepIndex - 1);
    const selections = clearForgeSelectionsAfterStepIndex(
      progress.selections,
      nextIndex,
    );
    const nations = [...s.nations];
    nations[nationIndex] = normalizeNation({
      ...nation,
      forgeComplete: false,
      forgeProgress: { stepIndex: nextIndex, selections },
    });
    return { ok: true, session: { ...s, nations } };
  }

  if (action.type === "finalize") {
    if (stepId !== "confirm") {
      return { ok: false, error: "Complete each step before forging your nation." };
    }
    const resolved = resolveForgeToNation(progress.selections);
    if (!("stats" in resolved)) {
      return { ok: false, error: resolved.error };
    }
    const nations = [...s.nations];
    nations[nationIndex] = normalizeNation({
      ...nation,
      stats: resolved.stats,
      reserve: resolved.reserve,
      buildNotes: resolved.buildNotes,
      forgeComplete: true,
      forgeProgress: null,
    });
    let next: GameSession = { ...s, nations };
    next = maybeStartFirstBeat(next);
    return { ok: true, session: next };
  }

  if (action.type === "setAddons") {
    if (stepId !== "demographicsAddons") {
      return { ok: false, error: "Add-ons are only set on the add-ons step." };
    }
    const ids = [...new Set(action.ids)];
    for (const id of ids) {
      if (!choiceById("demographicsAddons", id)) {
        return { ok: false, error: `Unknown add-on: ${id}` };
      }
    }
    const nextSelections = {
      ...progress.selections,
      demographicsAddons: ids,
    };
    const spend = computeSpend(nextSelections);
    if (spend > FORGE_POINT_BUDGET) {
      return {
        ok: false,
        error: `That combination exceeds ${FORGE_POINT_BUDGET} points (including add-ons).`,
      };
    }
    const maxStep = FORGE_STEP_IDS.length - 1;
    const nextStepIndex = Math.min(progress.stepIndex + 1, maxStep);
    const nations = [...s.nations];
    nations[nationIndex] = normalizeNation({
      ...nation,
      forgeComplete: false,
      forgeProgress: {
        stepIndex: nextStepIndex,
        selections: nextSelections,
      },
    });
    return { ok: true, session: { ...s, nations } };
  }

  if (action.type === "pick") {
    if (stepId === "confirm") {
      return { ok: false, error: "Use finalize on the last step." };
    }
    if (stepId === "demographicsAddons") {
      return {
        ok: false,
        error: "Use setAddons with your selected add-ons for this step.",
      };
    }
    const key = SINGLE_STEP_SELECTION_KEY[stepId];
    const choice = choiceById(stepId, action.choiceId);
    if (!choice) {
      return { ok: false, error: "Unknown choice for this step." };
    }
    const nextSelections = { ...progress.selections, [key]: action.choiceId };
    const spend = computeSpend(nextSelections);
    if (spend > FORGE_POINT_BUDGET) {
      return {
        ok: false,
        error: `That choice would exceed ${FORGE_POINT_BUDGET} points spent (${spend}). Pick something lighter or go back.`,
      };
    }
    const maxStep = FORGE_STEP_IDS.length - 1;
    const nextStepIndex = Math.min(progress.stepIndex + 1, maxStep);
    const nations = [...s.nations];
    nations[nationIndex] = normalizeNation({
      ...nation,
      forgeComplete: false,
      forgeProgress: {
        stepIndex: nextStepIndex,
        selections: nextSelections,
      },
    });
    return { ok: true, session: { ...s, nations } };
  }

  return { ok: false, error: "Unsupported action." };
}

export function getForgeNationByToken(
  session: GameSession,
  token: string,
): { nation: Nation; index: number } | null {
  const idx = nationIndexByToken(session, token);
  if (idx === -1) return null;
  const nation = session.nations[idx]!;
  if (nation.forgeComplete || !nation.forgeProgress) return null;
  return { nation, index: idx };
}
