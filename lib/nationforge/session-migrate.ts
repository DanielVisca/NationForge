import type { UIMessage } from "ai";

import { migrateForgeWizardProgress } from "./nation-forge-catalog";
import type { GameSession, Nation, NationForgeProgress } from "./schema";

function hasAssistantReply(messages: UIMessage[]): boolean {
  return messages.some((m) => {
    if (m.role !== "assistant") return false;
    return m.parts.some(
      (p) => p.type === "text" && typeof (p as { text?: string }).text === "string",
    );
  });
}

export function normalizeNation(n: Nation): Nation {
  const domesticScratch = n.domesticScratch ?? "";
  const forgeComplete = n.forgeComplete ?? true;
  if (forgeComplete) {
    return { ...n, domesticScratch, forgeComplete: true, forgeProgress: null };
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
    domesticScratch,
    forgeComplete: false,
    forgeProgress: {
      stepIndex: fp.stepIndex,
      selections,
      suggestedNationName: fp.suggestedNationName,
      reviewNarrativeMarkdown: fp.reviewNarrativeMarkdown,
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

  const diplomaticOutreach = Array.isArray(s.diplomaticOutreach)
    ? s.diplomaticOutreach
    : [];

  return { ...s, nations, diplomaticOutreach };
}
