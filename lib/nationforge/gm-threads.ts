import type { UIMessage } from "ai";

import type { GameSession } from "./schema";

/** Deep-clone UI messages for migration (JSON round-trip). */
function cloneMessages(msgs: UIMessage[]): UIMessage[] {
  return JSON.parse(JSON.stringify(msgs)) as UIMessage[];
}

/**
 * Ensures every nation id has a GM thread bucket and migrates legacy single
 * `gmMessages` into each forged nation's bucket once.
 */
export function ensureGmMessagesByNationId(session: GameSession): GameSession {
  const nations = session.nations;
  const legacy = Array.isArray(session.gmMessages) ? session.gmMessages : [];
  const byId: Record<string, UIMessage[]> = {
    ...(session.gmMessagesByNationId ?? {}),
  };

  const hasLegacy = legacy.length > 0;
  const hadNoBuckets = Object.keys(byId).length === 0;

  if (nations.length === 0) {
    return {
      ...session,
      gmMessagesByNationId: {},
      gmMessages: hasLegacy ? legacy : [],
      lastGmResponseIdByNationId: session.lastGmResponseIdByNationId,
    };
  }

  if (hasLegacy && hadNoBuckets) {
    for (const n of nations) {
      byId[n.id] = n.forgeComplete ? cloneMessages(legacy) : [];
    }
  }

  for (const n of nations) {
    if (!byId[n.id]) {
      byId[n.id] = [];
    }
  }

  const lastBy = { ...(session.lastGmResponseIdByNationId ?? {}) };
  const lastSingle = session.lastGmResponseId;
  if (
    lastSingle &&
    Object.keys(lastBy).length === 0 &&
    nations.some((n) => n.forgeComplete)
  ) {
    for (const n of nations) {
      if (n.forgeComplete) {
        lastBy[n.id] = lastSingle;
      }
    }
  }

  return {
    ...session,
    gmMessagesByNationId: byId,
    gmMessages: [],
    lastGmResponseId: undefined,
    lastGmResponseIdByNationId: lastBy,
  };
}

export function getNationGmMessages(
  session: GameSession,
  nationId: string,
): UIMessage[] {
  return session.gmMessagesByNationId[nationId] ?? [];
}

export function withNationGmMessages(
  session: GameSession,
  nationId: string,
  messages: UIMessage[],
): GameSession {
  return {
    ...session,
    gmMessagesByNationId: {
      ...session.gmMessagesByNationId,
      [nationId]: messages,
    },
  };
}

export function withLastGmResponseIdForNation(
  session: GameSession,
  nationId: string,
  responseId: string | undefined,
): GameSession {
  return {
    ...session,
    lastGmResponseIdByNationId: {
      ...(session.lastGmResponseIdByNationId ?? {}),
      [nationId]: responseId,
    },
  };
}

export function gmThreadsEqual(a: GameSession, b: GameSession): boolean {
  const ids = new Set([
    ...Object.keys(a.gmMessagesByNationId ?? {}),
    ...Object.keys(b.gmMessagesByNationId ?? {}),
  ]);
  for (const id of ids) {
    const x = JSON.stringify(a.gmMessagesByNationId?.[id] ?? []);
    const y = JSON.stringify(b.gmMessagesByNationId?.[id] ?? []);
    if (x !== y) return false;
  }
  return true;
}
