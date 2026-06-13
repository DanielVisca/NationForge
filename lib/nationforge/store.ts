import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { UIMessage } from "ai";

import type { GameSession, Nation, NationStats } from "./schema";
import type {
  PublicEmergentEvent,
  PublicGameSession,
  PublicInboundItem,
  PublicInteraction,
  PublicSecret,
  PublicTurnLogEntry,
} from "./public-types";
import { STAT_KEYS } from "./schema";
import { pendingInboundForNation } from "./interactions";
import { forceStartFirstBeat, maybeStartFirstBeat } from "./forge-handlers";
import { migrateSession } from "./session-migrate";
import { isOpeningBriefWireMessage } from "./opening-brief-narrative";
import { playerTurnChatDisplayBody } from "./player-input";
import type { NationForgeSessionSummary } from "./session-summary";
import {
  logNationForgePersistenceOnce,
  nationForgePersistenceKindFromEnv,
  readNationForgeDatabaseUrl,
} from "./store-backend";
import { createLocalSnapshotPersistence } from "./store-local-snapshot";
import { createPostgresSnapshotPersistence } from "./store-pg-snapshot";
import type { NationForgeSnapshotPersistence } from "./store-snapshot-persistence";
import type { StoreFile } from "./store-snapshot-types";

let persistence: NationForgeSnapshotPersistence | null = null;

function getPersistence(): NationForgeSnapshotPersistence {
  if (!persistence) {
    const kind = nationForgePersistenceKindFromEnv();
    logNationForgePersistenceOnce(kind);
    persistence =
      kind === "postgres"
        ? createPostgresSnapshotPersistence(readNationForgeDatabaseUrl()!)
        : createLocalSnapshotPersistence();
  }
  return persistence;
}

const MAX_NATIONS_PER_SESSION = 12;

function applySessionToStoreFile(store: StoreFile, session: GameSession): void {
  const prev = store.sessions[session.id];
  if (prev && prev.roomCode !== session.roomCode) {
    delete store.roomIndex[prev.roomCode];
    store.roomIndex[session.roomCode] = session.id;
  } else if (!prev) {
    store.roomIndex[session.roomCode] = session.id;
  }
  store.sessions[session.id] = session;
}

export type MutateSessionResult =
  | { ok: false; status: number; message: string }
  | { ok: true; session: GameSession };

/**
 * Read–mutate–write one session under the global store lock. `fn` receives a
 * migrated clone; return `next` to persist (full replacement for that session row).
 */
export async function mutateSessionExclusive(
  sessionId: string,
  fn: (
    s: GameSession,
  ) =>
    | MutateSessionResult
    | Promise<MutateSessionResult>,
): Promise<MutateSessionResult> {
  return getPersistence().withLockedStore(async (io): Promise<MutateSessionResult> => {
    const store = await io.read();
    const raw = store.sessions[sessionId];
    if (!raw) {
      return { ok: false, status: 404, message: "Not found" };
    }
    const s = migrateSession({ ...raw });
    const r = await Promise.resolve(fn(s));
    if (!r.ok) return r;
    const session = migrateSession(r.session);
    session.updatedAt = new Date().toISOString();
    applySessionToStoreFile(store, session);
    await io.write(store);
    return { ok: true, session };
  });
}

function requesterHasSeat(s: GameSession, requesterToken: string): boolean {
  return Object.values(s.seatTokens).some((tok) => tok === requesterToken);
}

/**
 * Remove an unfinished (unforged) seat that is blocking the table open. Any
 * seated participant in the room may call this. If removing the seat leaves a
 * room where every remaining nation is forged (and game not started), the table
 * opens automatically via maybeStartFirstBeat.
 */
export async function removeUnforgedSeat(
  sessionId: string,
  requesterToken: string,
  targetNationId: string,
): Promise<MutateSessionResult> {
  return mutateSessionExclusive(sessionId, (s) => {
    if (!requesterHasSeat(s, requesterToken)) {
      return { ok: false, status: 403, message: "A valid seat token is required." };
    }
    const target = s.nations.find((n) => n.id === targetNationId);
    if (!target) {
      return { ok: false, status: 404, message: "Seat not found." };
    }
    if (target.forgeComplete) {
      return {
        ok: false,
        status: 400,
        message: "Only an unfinished (unforged) seat can be removed.",
      };
    }

    const nations = s.nations.filter((n) => n.id !== targetNationId);

    const seatTokens = { ...s.seatTokens };
    delete seatTokens[targetNationId];

    const gmMessagesByNationId = { ...s.gmMessagesByNationId };
    delete gmMessagesByNationId[targetNationId];

    let lastGmResponseIdByNationId = s.lastGmResponseIdByNationId;
    if (lastGmResponseIdByNationId && targetNationId in lastGmResponseIdByNationId) {
      lastGmResponseIdByNationId = { ...lastGmResponseIdByNationId };
      delete lastGmResponseIdByNationId[targetNationId];
    }

    const activeNationId =
      s.activeNationId === targetNationId
        ? (nations[0]?.id ?? "")
        : s.activeNationId;

    let next: GameSession = {
      ...s,
      nations,
      seatTokens,
      gmMessagesByNationId,
      lastGmResponseIdByNationId,
      activeNationId,
    };

    if (
      next.nations.length >= 1 &&
      !next.gameStarted &&
      next.nations.every((n) => n.forgeComplete)
    ) {
      next = maybeStartFirstBeat(next);
    }

    return { ok: true, session: next };
  });
}

/**
 * Open the table now using only the seats that have finished the forge. Any
 * seated participant may call this. Unforged seats remain as in-progress
 * builders.
 */
export async function forceStartTable(
  sessionId: string,
  requesterToken: string,
): Promise<MutateSessionResult> {
  return mutateSessionExclusive(sessionId, (s) => {
    if (!requesterHasSeat(s, requesterToken)) {
      return { ok: false, status: 403, message: "A valid seat token is required." };
    }
    if (s.gameStarted) {
      return { ok: false, status: 400, message: "The table has already started." };
    }
    if (!s.nations.some((n) => n.forgeComplete)) {
      return {
        ok: false,
        status: 400,
        message: "At least one nation must finish the forge before starting.",
      };
    }
    return { ok: true, session: forceStartFirstBeat(s) };
  });
}

const COMPLETED_TOOL_STATES = new Set(["output-available", "output-error"]);
const PUBLIC_GM_TOOL_PARTS = new Set([
  "tool-append_turn_log",
  "tool-apply_stat_deltas",
  "tool-no_stat_change_this_turn",
  "tool-declare_emergent_event",
]);

function publicTextFromUiMessage(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function sanitizeGmMessageForClient(message: UIMessage): UIMessage | null {
  if (message.role === "user") {
    const raw = publicTextFromUiMessage(message);
    if (isOpeningBriefWireMessage(raw)) return null;
    const publicBody = playerTurnChatDisplayBody(raw);
    if (!publicBody.trim()) return null;
    return {
      id: message.id,
      role: "user",
      parts: [{ type: "text", text: publicBody }],
    };
  }

  if (message.role !== "assistant") return null;

  const parts: UIMessage["parts"] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      parts.push(part);
      continue;
    }

    const state = (part as { state?: string }).state;
    if (
      PUBLIC_GM_TOOL_PARTS.has(part.type) &&
      state &&
      COMPLETED_TOOL_STATES.has(state)
    ) {
      parts.push({ type: part.type, state } as UIMessage["parts"][number]);
    }
  }

  return parts.length > 0
    ? {
        id: message.id,
        role: "assistant",
        parts,
      }
    : null;
}

function sanitizeGmMessagesForClient(messages: UIMessage[]): UIMessage[] {
  return messages
    .map(sanitizeGmMessageForClient)
    .filter((message): message is UIMessage => Boolean(message));
}

function defaultStats(): NationStats {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, 50])) as NationStats;
}

function randomRoomCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

export async function createGameSession(): Promise<GameSession> {
  return getPersistence().withLockedStore(async (io) => {
    const store = await io.read();
    const id = randomUUID();
    let roomCode = randomRoomCode();
    while (store.roomIndex[roomCode]) {
      roomCode = randomRoomCode();
    }
    const now = new Date().toISOString();
    const session: GameSession = {
      id,
      roomCode,
      createdAt: now,
      updatedAt: now,
      promptVersion: 1,
      phase: "lobby",
      gmStreamingNationIds: [],
      gameStarted: false,
      roundIndex: 0,
      activeNationId: "",
      nations: [],
      crisis: null,
      turnLog: [],
      secrets: [],
      seatTokens: {},
      gmMessagesByNationId: {},
      diplomaticOutreach: [],
      emergentEvents: [],
      statImpacts: [],
      tableEvents: [],
      interactions: [],
    };
    store.sessions[id] = session;
    store.roomIndex[roomCode] = id;
    await io.write(store);
    return session;
  });
}

export async function registerNation(
  roomCode: string,
  displayName: string,
): Promise<
  | { ok: true; sessionId: string; nationId: string; token: string; name: string }
  | { ok: false; error: string }
> {
  return getPersistence().withLockedStore(async (io) => {
    const store = await io.read();
    const sessionId = store.roomIndex[roomCode.trim().toUpperCase()];
    if (!sessionId) return { ok: false, error: "Room not found" };
    const raw = store.sessions[sessionId];
    if (!raw) return { ok: false, error: "Room not found" };
    const session = migrateSession(raw);

    if (session.nations.length >= MAX_NATIONS_PER_SESSION) {
      return { ok: false, error: "Room is full (12 nations max)." };
    }

    const trimmed = displayName.trim().slice(0, 80);
    const nationId = randomUUID();
    const token = randomUUID();
    const provisionalName = trimmed || `Unnamed seat ${nationId.slice(0, 4)}`;

    const nation: Nation = {
      id: nationId,
      name: provisionalName,
      buildNotes: "Nation forge in progress — finish the builder to take turns.",
      domesticScratch: "",
      stats: defaultStats(),
      reserve: 0,
      forgeComplete: false,
      forgeProgress: {
        stepIndex: 0,
        selections: { demographicsAddons: [] },
        forgeWizardVersion: 2,
      },
    };

    const next: GameSession = {
      ...session,
      nations: [...session.nations, nation],
      seatTokens: { ...session.seatTokens, [nationId]: token },
      gmMessagesByNationId: {
        ...session.gmMessagesByNationId,
        [nationId]: [],
      },
      phase:
        session.phase === "lobby"
          ? "nation_forge"
          : session.phase === "player_input" ||
              session.phase === "awaiting_decision" ||
              session.phase === "gm_running"
            ? session.phase
            : "nation_forge",
      activeNationId: session.activeNationId || nationId,
    };

    store.sessions[sessionId] = next;
    await io.write(store);
    return {
      ok: true,
      sessionId,
      nationId,
      token,
      name: provisionalName,
    };
  });
}

export async function getGameSession(
  id: string,
): Promise<GameSession | undefined> {
  const store = await getPersistence().readSnapshot();
  const s = store.sessions[id];
  if (!s) return undefined;
  return migrateSession(s);
}

export async function getSessionIdByRoomCode(
  code: string,
): Promise<string | undefined> {
  const store = await getPersistence().readSnapshot();
  return store.roomIndex[code.trim().toUpperCase()];
}

export async function saveGameSession(session: GameSession): Promise<void> {
  await getPersistence().withLockedStore(async (io) => {
    const store = await io.read();
    session.updatedAt = new Date().toISOString();
    applySessionToStoreFile(store, session);
    await io.write(store);
  });
}

export async function updateGameSession(
  id: string,
  mutator: (s: GameSession) => void,
): Promise<GameSession | undefined> {
  return getPersistence().withLockedStore(async (io) => {
    const store = await io.read();
    const raw = store.sessions[id];
    if (!raw) return undefined;
    const s = migrateSession(raw);
    mutator(s);
    s.updatedAt = new Date().toISOString();
    store.sessions[id] = s;
    await io.write(store);
    return s;
  });
}

/** Strip secret contents for LAN spectators; reveal only viewer nation's secrets when token matches. */
export function filterSessionForClient(
  session: GameSession,
  viewerNationId: string | null,
  seatToken: string | null,
): PublicGameSession {
  const s = migrateSession(session);
  let nationFromToken: string | null = null;
  if (seatToken) {
    for (const [nid, tok] of Object.entries(s.seatTokens)) {
      if (tok === seatToken) {
        nationFromToken = nid;
        break;
      }
    }
  }
  // SECURITY: the effective viewer must come ONLY from the seat token. The
  // `viewerNationId` query hint may never override the token-derived identity;
  // it is honored solely when it strictly equals the token's nation. A request
  // with `viewerNationId` but no valid token resolves to a spectator (null).
  const effectiveViewer =
    nationFromToken && viewerNationId === nationFromToken
      ? viewerNationId
      : nationFromToken;

  const secrets: PublicSecret[] = s.secrets.map((sec) => {
    if (sec.revealed) {
      return {
        id: sec.id,
        nationId: sec.nationId,
        label: sec.label,
        revealed: true,
        content: sec.content,
      };
    }
    if (effectiveViewer && sec.nationId === effectiveViewer) {
      return {
        id: sec.id,
        nationId: sec.nationId,
        label: sec.label,
        revealed: false,
        content: sec.content,
      };
    }
    return {
      id: sec.id,
      nationId: sec.nationId,
      label: sec.label,
      revealed: false,
    };
  });

  const nationRoster = s.nations.map((n) => ({
    id: n.id,
    name: n.name,
    forgeComplete: n.forgeComplete,
  }));

  const nationsVisible = s.nations.filter(
    (n) =>
      n.forgeComplete ||
      (Boolean(effectiveViewer) && n.id === effectiveViewer),
  );

  const nations = nationsVisible.map((n) => {
    if (effectiveViewer && n.id === effectiveViewer) {
      return n;
    }
    const { domesticScratch: _omit, ...pub } = n;
    void _omit;
    return { ...pub, domesticScratch: "" };
  });

  const diplomaticOutreach = (s.diplomaticOutreach ?? []).filter(
    (o) =>
      Boolean(effectiveViewer) &&
      (o.fromNationId === effectiveViewer || o.toNationId === effectiveViewer),
  );

  const emergentEvents: PublicEmergentEvent[] = s.emergentEvents.map(
    ({ privateNotes: _omit, ...pub }) => {
      void _omit;
      return pub;
    },
  );

  const turnLog: PublicTurnLogEntry[] = s.turnLog.map((entry) => ({
    id: entry.id,
    at: entry.at,
    povNationId: entry.povNationId,
    publicSummary: entry.publicSummary,
    privateText:
      effectiveViewer && entry.privateByNation
        ? entry.privateByNation[effectiveViewer]
        : undefined,
  }));

  const viewerThread =
    effectiveViewer && s.gmMessagesByNationId[effectiveViewer]
      ? s.gmMessagesByNationId[effectiveViewer]!
      : [];

  // Privacy boundary for the cross-nation ledger: a record reaches a client only
  // if it is public, or it is directed and the viewer is the sender or a target.
  // The per-target `detailByNation` map is dropped; only the viewer's own entry
  // (if any) is exposed via `detail`.
  const interactions: PublicInteraction[] = (s.interactions ?? [])
    .filter(
      (record) =>
        record.visibility === "public" ||
        (Boolean(effectiveViewer) &&
          (record.fromNationId === effectiveViewer ||
            record.toNationIds.includes(effectiveViewer!))),
    )
    .map((record) => ({
      id: record.id,
      at: record.at,
      round: record.round,
      fromNationId: record.fromNationId,
      toNationIds: record.toNationIds,
      kind: record.kind,
      summary: record.summary,
      visibility: record.visibility,
      status: record.status,
      detail: effectiveViewer
        ? record.detailByNation?.[effectiveViewer]
        : undefined,
    }));

  const nationNameById = new Map(s.nations.map((n) => [n.id, n.name]));
  const pendingInbound: PublicInboundItem[] = effectiveViewer
    ? pendingInboundForNation(s, effectiveViewer).map((record) => ({
        id: record.id,
        at: record.at,
        round: record.round,
        fromNationId: record.fromNationId,
        fromName:
          nationNameById.get(record.fromNationId) ?? record.fromNationId,
        kind: record.kind,
        summary: record.summary,
        detail: record.detailByNation?.[effectiveViewer],
      }))
    : [];

  const {
    seatTokens,
    secrets: _sessionSecrets,
    nations: _n,
    diplomaticOutreach: _allOutreach,
    emergentEvents: _emergentRaw,
    turnLog: _turnLogRaw,
    gmMessagesByNationId: _gmByNation,
    lastGmResponseIdByNationId: _lastGmBy,
    gmMessages: _gmLegacy,
    lastGmResponseId: _lastGmLegacy,
    interactions: _interactionsRaw,
    trajectoryByNation: _trajectoryRaw,
    ...rest
  } = s;
  void seatTokens;
  void _sessionSecrets;
  void _n;
  void _allOutreach;
  void _emergentRaw;
  void _turnLogRaw;
  void _gmByNation;
  void _lastGmBy;
  void _gmLegacy;
  void _lastGmLegacy;
  void _interactionsRaw;
  void _trajectoryRaw;
  return {
    ...rest,
    nations,
    nationRoster,
    secrets,
    turnLog,
    gmMessages: sanitizeGmMessagesForClient(viewerThread),
    diplomaticOutreach,
    emergentEvents,
    interactions,
    pendingInbound,
    viewerNationId: effectiveViewer,
  };
}

export async function listGameSessions(): Promise<GameSession[]> {
  const store = await getPersistence().readSnapshot();
  return Object.values(store.sessions)
    .map((s) => migrateSession(s))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** Public list rows for the lobby / “My games” UI (same shape as GET /api/nationforge/sessions). */
export async function listNationForgeSessionSummaries(): Promise<
  NationForgeSessionSummary[]
> {
  const sessions = await listGameSessions();
  return sessions.map((s) => {
    const activeNation = s.nations.find((n) => n.id === s.activeNationId);
    return {
      id: s.id,
      roomCode: s.roomCode,
      updatedAt: s.updatedAt,
      roundIndex: s.roundIndex,
      phase: s.phase,
      gameStarted: s.gameStarted,
      activeNationId: s.activeNationId || null,
      activeNationName: activeNation?.name ?? null,
      nationNames: s.nations.filter((n) => n.forgeComplete).map((n) => n.name),
      nationRoster: s.nations.map((n) => ({
        id: n.id,
        name: n.name,
        forgeComplete: Boolean(n.forgeComplete),
      })),
      nationsInForge: s.nations.filter((n) => !n.forgeComplete).length,
    };
  });
}

export async function appendGmMessage(
  sessionId: string,
  nationId: string,
  message: UIMessage,
): Promise<void> {
  await updateGameSession(sessionId, (sess) => {
    const cur = sess.gmMessagesByNationId[nationId] ?? [];
    sess.gmMessagesByNationId = {
      ...sess.gmMessagesByNationId,
      [nationId]: [...cur, message],
    };
  });
}

export async function replaceNationGmMessages(
  sessionId: string,
  nationId: string,
  messages: UIMessage[],
): Promise<void> {
  await updateGameSession(sessionId, (sess) => {
    sess.gmMessagesByNationId = {
      ...sess.gmMessagesByNationId,
      [nationId]: messages,
    };
  });
}
