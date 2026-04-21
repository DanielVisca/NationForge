import type { UIMessage } from "ai";

import {
  FORGE_STEP_IDS,
  isForgeSelectionsComplete,
} from "./nation-forge-catalog";
import type { GameSession, Nation, NationForgeProgress } from "./schema";

const LEGACY_CONFIRM_STEP_INDEX = 11;
const NEW_CONFIRM_STEP_INDEX = FORGE_STEP_IDS.indexOf("confirm");

/** Old saves used confirm at index 11; bump to new confirm after inserting naming. */
function migrateForgeWizardProgress(fp: NationForgeProgress): NationForgeProgress {
  if (fp.forgeWizardVersion === 2) return fp;
  if (
    fp.forgeWizardVersion === undefined &&
    fp.stepIndex === LEGACY_CONFIRM_STEP_INDEX
  ) {
    if (isForgeSelectionsComplete(fp.selections)) {
      return {
        ...fp,
        stepIndex: NEW_CONFIRM_STEP_INDEX,
        forgeWizardVersion: 2,
      };
    }
  }
  return { ...fp, forgeWizardVersion: 2 };
}

function hasAssistantReply(messages: UIMessage[]): boolean {
  return messages.some((m) => {
    if (m.role !== "assistant") return false;
    return m.parts.some(
      (p) => p.type === "text" && typeof (p as { text?: string }).text === "string",
    );
  });
}

export function normalizeNation(n: Nation): Nation {
  const forgeComplete = n.forgeComplete ?? true;
  if (forgeComplete) {
    return { ...n, forgeComplete: true, forgeProgress: null };
  }
  const raw: NationForgeProgress =
    n.forgeProgress ??
    ({
      stepIndex: 0,
      selections: { demographicsAddons: [] },
      forgeWizardVersion: 2,
    } satisfies NationForgeProgress);
  const fp = migrateForgeWizardProgress(raw);
  const selections = { ...fp.selections };
  if (!Array.isArray(selections.demographicsAddons)) {
    selections.demographicsAddons = [];
  }
  return {
    ...n,
    forgeComplete: false,
    forgeProgress: {
      stepIndex: fp.stepIndex,
      selections,
      suggestedNationName: fp.suggestedNationName,
      forgeWizardVersion: fp.forgeWizardVersion ?? 2,
    },
  };
}

/** Hydrate sessions saved before lobby / forge / gameStarted existed. */
export function migrateSession(session: GameSession): GameSession {
  let s = { ...session };
  const nations = s.nations.map(normalizeNation);

  if (s.gameStarted === undefined) {
    const legacyStarted =
      s.turnLog.length > 0 ||
      hasAssistantReply(s.gmMessages) ||
      nations.every((n) => n.forgeComplete);
    s.gameStarted = legacyStarted;
  }

  if (!s.gameStarted && nations.length === 0 && s.phase !== "lobby") {
    s = { ...s, phase: "lobby" };
  }
  if (!s.gameStarted && nations.length > 0 && s.phase === "lobby") {
    s = { ...s, phase: "nation_forge" };
  }

  return { ...s, nations };
}
