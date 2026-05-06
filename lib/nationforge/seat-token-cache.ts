/**
 * Browser localStorage helpers for NationForge seat tokens.
 * Safe to import from client components (no server-only).
 */

export const NATIONFORGE_HOST_TOKENS_KEY = "nationforge-host-tokens";

const LAST_SEAT_KEY = "nationforge-last-seat";
const PLAYER_PROFILE_KEY = "nationforge-player-profile";
const ENROLLED_SESSIONS_KEY = "nationforge-enrolled-sessions";

type HostTokenStore = Record<string, Record<string, string>>;

type LastSeatEntry = {
  nationId: string;
  token: string;
  savedAt: string;
};

type LastSeatStore = Record<string, LastSeatEntry>;

export type NationForgePlayerProfile = {
  playerId: string;
  displayName?: string;
  createdAt: string;
};

export type NationForgeEnrollment = {
  sessionId: string;
  nationId: string;
  token: string;
  roomCode?: string;
  nationName?: string;
  label?: string;
  favorite?: boolean;
  createdAt: string;
  lastOpenedAt: string;
};

type EnrollmentStore = Record<string, NationForgeEnrollment>;

type RememberSeatMeta = {
  roomCode?: string;
  nationName?: string;
  label?: string;
};

function safeRandomId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `nf-${Date.now()}`;
  } catch {
    return `nf-${Date.now()}`;
  }
}

export function ensureNationForgePlayerProfile(): NationForgePlayerProfile | null {
  if (typeof globalThis.window === "undefined") return null;
  try {
    const raw = globalThis.localStorage.getItem(PLAYER_PROFILE_KEY);
    if (raw) {
      const profile = JSON.parse(raw) as NationForgePlayerProfile;
      if (profile.playerId?.trim()) return profile;
    }
    const profile: NationForgePlayerProfile = {
      playerId: safeRandomId(),
      createdAt: new Date().toISOString(),
    };
    globalThis.localStorage.setItem(PLAYER_PROFILE_KEY, JSON.stringify(profile));
    return profile;
  } catch {
    return null;
  }
}

export function readNationForgeEnrollments(): EnrollmentStore {
  if (typeof globalThis.window === "undefined") return {};
  try {
    const raw = globalThis.localStorage.getItem(ENROLLED_SESSIONS_KEY);
    return (raw ? JSON.parse(raw) : {}) as EnrollmentStore;
  } catch {
    return {};
  }
}

export function readNationForgeEnrollment(
  sessionId: string,
): NationForgeEnrollment | null {
  return readNationForgeEnrollments()[sessionId] ?? null;
}

function writeNationForgeEnrollments(store: EnrollmentStore): void {
  globalThis.localStorage.setItem(ENROLLED_SESSIONS_KEY, JSON.stringify(store));
}

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
  meta: RememberSeatMeta = {},
): void {
  if (typeof globalThis.window === "undefined") return;
  try {
    ensureNationForgePlayerProfile();
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

    const enrollments = readNationForgeEnrollments();
    const prev = enrollments[sessionId];
    const now = new Date().toISOString();
    enrollments[sessionId] = {
      sessionId,
      nationId,
      token,
      roomCode: meta.roomCode ?? prev?.roomCode,
      nationName: meta.nationName ?? prev?.nationName,
      label: meta.label ?? prev?.label,
      favorite: prev?.favorite,
      createdAt: prev?.createdAt ?? now,
      lastOpenedAt: now,
    };
    writeNationForgeEnrollments(enrollments);
  } catch {
    /* ignore quota / private mode */
  }
}

export function touchNationForgeEnrollment(
  sessionId: string,
  meta: RememberSeatMeta = {},
): void {
  if (typeof globalThis.window === "undefined") return;
  try {
    const enrollments = readNationForgeEnrollments();
    const prev = enrollments[sessionId];
    if (!prev) return;
    enrollments[sessionId] = {
      ...prev,
      roomCode: meta.roomCode ?? prev.roomCode,
      nationName: meta.nationName ?? prev.nationName,
      label: meta.label ?? prev.label,
      lastOpenedAt: new Date().toISOString(),
    };
    writeNationForgeEnrollments(enrollments);
  } catch {
    /* ignore */
  }
}

export function setNationForgeEnrollmentFavorite(
  sessionId: string,
  favorite: boolean,
): void {
  if (typeof globalThis.window === "undefined") return;
  try {
    const enrollments = readNationForgeEnrollments();
    const prev = enrollments[sessionId];
    if (!prev) return;
    enrollments[sessionId] = { ...prev, favorite };
    writeNationForgeEnrollments(enrollments);
  } catch {
    /* ignore */
  }
}

export function forgetNationForgeSession(sessionId: string): void {
  if (typeof globalThis.window === "undefined") return;
  try {
    const enrollments = readNationForgeEnrollments();
    delete enrollments[sessionId];
    writeNationForgeEnrollments(enrollments);

    const lastRaw = globalThis.localStorage.getItem(LAST_SEAT_KEY);
    const lastMap = (lastRaw ? JSON.parse(lastRaw) : {}) as LastSeatStore;
    delete lastMap[sessionId];
    globalThis.localStorage.setItem(LAST_SEAT_KEY, JSON.stringify(lastMap));

    const hostRaw = globalThis.localStorage.getItem(NATIONFORGE_HOST_TOKENS_KEY);
    const hostAll = (hostRaw ? JSON.parse(hostRaw) : {}) as HostTokenStore;
    delete hostAll[sessionId];
    globalThis.localStorage.setItem(
      NATIONFORGE_HOST_TOKENS_KEY,
      JSON.stringify(hostAll),
    );
  } catch {
    /* ignore */
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

    const enrollments = readNationForgeEnrollments();
    delete enrollments[sessionId];
    writeNationForgeEnrollments(enrollments);

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
