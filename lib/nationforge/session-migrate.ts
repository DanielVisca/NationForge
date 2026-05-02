import type { UIMessage } from "ai";

import { migrateForgeWizardProgress } from "./nation-forge-catalog";
import type { GameSession, Nation, NationForgeProgress, StatImpactRecord } from "./schema";
import { ensureGmMessagesByNationId } from "./gm-threads";

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
  /** Only explicit `true` counts as forged; missing/false keeps the nation in the builder. */
  const forgeComplete = n.forgeComplete === true;
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
    forgeBriefingMarkdown: n.forgeBriefingMarkdown,
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
function hasAssistantReplyAnyThread(s: GameSession): boolean {
  const by = s.gmMessagesByNationId;
  if (by && Object.keys(by).length > 0) {
    return Object.values(by).some((m) => hasAssistantReply(m));
  }
  const legacy = s.gmMessages ?? [];
  return hasAssistantReply(legacy);
}

export function migrateSession(session: GameSession): GameSession {
  let s = { ...session };
  const nations = s.nations.map(normalizeNation);
  s = { ...s, nations };
  s = ensureGmMessagesByNationId(s as GameSession);

  if (s.gameStarted === undefined) {
    const legacyStarted =
      s.turnLog.length > 0 ||
      hasAssistantReplyAnyThread(s) ||
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

  const emergentEvents = Array.isArray(s.emergentEvents)
    ? s.emergentEvents
    : [];

  const statImpacts: StatImpactRecord[] = (
    Array.isArray(s.statImpacts) ? s.statImpacts : []
  ).map((raw) => {
    const x = raw as StatImpactRecord;
    const roundIndex =
      typeof x.roundIndex === "number" && Number.isFinite(x.roundIndex)
        ? x.roundIndex
        : 0;
    const reserveDelta =
      typeof x.reserveDelta === "number" && Number.isFinite(x.reserveDelta)
        ? x.reserveDelta
        : 0;
    return {
      ...x,
      roundIndex,
      reserveDelta,
      deltas: x.deltas && typeof x.deltas === "object" ? x.deltas : {},
    };
  });

  const tableEvents = Array.isArray(s.tableEvents) ? s.tableEvents : [];

  const gmStreamingNationIds = Array.isArray(
    (s as GameSession & { gmStreamingNationIds?: unknown }).gmStreamingNationIds,
  )
    ? (s as GameSession & { gmStreamingNationIds: string[] }).gmStreamingNationIds
    : [];

  return ensureGmMessagesByNationId({
    ...s,
    nations,
    diplomaticOutreach,
    emergentEvents,
    statImpacts,
    tableEvents,
    gmStreamingNationIds,
  });
}
