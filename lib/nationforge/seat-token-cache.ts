/**
 * Browser localStorage helpers for NationForge seat tokens.
 * Safe to import from client components (no server-only).
 */

export const NATIONFORGE_HOST_TOKENS_KEY = "nationforge-host-tokens";

const LAST_SEAT_KEY = "nationforge-last-seat";

type HostTokenStore = Record<string, Record<string, string>>;

type LastSeatEntry = {
  nationId: string;
  token: string;
  savedAt: string;
};

type LastSeatStore = Record<string, LastSeatEntry>;

/** Host copy map for a session (nationId → token), for Share & join UI. */
export function readHostTokensForSession(
  sessionId: string,
): Record<string, string> | null {
  if (typeof globalThis.window === "undefined") return null;
  try {
    const raw = globalThis.localStorage.getItem(NATIONFORGE_HOST_TOKENS_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as HostTokenStore;
    return all[sessionId] ?? null;
  } catch {
    return null;
  }
}

/** Last seat used in this browser for auto-restore when the URL has no `?token=`. */
export function readLastNationForgeSeat(
  sessionId: string,
): { nationId: string; token: string } | null {
  if (typeof globalThis.window === "undefined") return null;
  try {
    const raw = globalThis.localStorage.getItem(LAST_SEAT_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as LastSeatStore;
    const e = map[sessionId];
    if (!e?.token?.trim() || !e.nationId?.trim()) return null;
    return { nationId: e.nationId, token: e.token };
  } catch {
    return null;
  }
}

/**
 * Persist host token map entry and mark this seat as the last-used for the session.
 */
export function rememberNationForgeSeat(
  sessionId: string,
  nationId: string,
  token: string,
): void {
  if (typeof globalThis.window === "undefined") return;
  try {
    const raw = globalThis.localStorage.getItem(NATIONFORGE_HOST_TOKENS_KEY);
    const all = (raw ? JSON.parse(raw) : {}) as HostTokenStore;
    all[sessionId] = { ...(all[sessionId] ?? {}), [nationId]: token };
    globalThis.localStorage.setItem(
      NATIONFORGE_HOST_TOKENS_KEY,
      JSON.stringify(all),
    );

    const lastRaw = globalThis.localStorage.getItem(LAST_SEAT_KEY);
    const lastMap = (lastRaw ? JSON.parse(lastRaw) : {}) as LastSeatStore;
    lastMap[sessionId] = {
      nationId,
      token,
      savedAt: new Date().toISOString(),
    };
    globalThis.localStorage.setItem(LAST_SEAT_KEY, JSON.stringify(lastMap));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Drop last-seat auto-restore and remove that nation from the host copy map for the session. */
export function clearNationForgeSeat(sessionId: string): void {
  if (typeof globalThis.window === "undefined") return;
  try {
    const lastRaw = globalThis.localStorage.getItem(LAST_SEAT_KEY);
    const lastMap = (lastRaw ? JSON.parse(lastRaw) : {}) as LastSeatStore;
    const nationId = lastMap[sessionId]?.nationId;
    delete lastMap[sessionId];
    globalThis.localStorage.setItem(LAST_SEAT_KEY, JSON.stringify(lastMap));

    const hostRaw = globalThis.localStorage.getItem(NATIONFORGE_HOST_TOKENS_KEY);
    const hostAll = (hostRaw ? JSON.parse(hostRaw) : {}) as HostTokenStore;
    const row = hostAll[sessionId];
    if (row && nationId) {
      const nextRow = { ...row };
      delete nextRow[nationId];
      if (Object.keys(nextRow).length === 0) {
        delete hostAll[sessionId];
      } else {
        hostAll[sessionId] = nextRow;
      }
      globalThis.localStorage.setItem(
        NATIONFORGE_HOST_TOKENS_KEY,
        JSON.stringify(hostAll),
      );
    }
  } catch {
    /* ignore */
  }
}
