import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UIMessage } from "ai";

import type { GameSession, Nation, NationStats } from "./schema";
import type {
  PublicEmergentEvent,
  PublicGameSession,
  PublicSecret,
  PublicTurnLogEntry,
} from "./public-types";
import { STAT_KEYS } from "./schema";
import { migrateSession } from "./session-migrate";
import { playerTurnChatDisplayBody } from "./player-input";
import type { NationForgeSessionSummary } from "./session-summary";

type StoreFile = {
  sessions: Record<string, GameSession>;
  /** roomCode (uppercase) -> sessionId */
  roomIndex: Record<string, string>;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "nationforge-sessions.json");
const MAX_NATIONS_PER_SESSION = 12;

/**
 * Serializes all JSON store mutations so concurrent finalize / turn / tool writes
 * cannot read stale snapshots and overwrite each other (lost-update on the file).
 */
let storeWriteChain: Promise<unknown> = Promise.resolve();

async function withLockedStore<T>(task: () => Promise<T>): Promise<T> {
  const next = storeWriteChain.then(() => task());
  storeWriteChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

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
  return withLockedStore(async (): Promise<MutateSessionResult> => {
    const store = await readStore();
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
    await writeStore(store);
    return { ok: true, session };
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
    const publicBody = playerTurnChatDisplayBody(publicTextFromUiMessage(message));
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

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<StoreFile> {
  try {
    const raw = await readFile(STORE_PATH, "utf-8");
    return JSON.parse(raw) as StoreFile;
  } catch {
    return { sessions: {}, roomIndex: {} };
  }
}

async function writeStore(store: StoreFile): Promise<void> {
  await ensureDataDir();
  const json = JSON.stringify(store, null, 2);
  const tmp = path.join(DATA_DIR, `nf-${randomUUID()}.tmp.json`);
  try {
    await writeFile(tmp, json, "utf-8");
    await rename(tmp, STORE_PATH);
  } catch (e) {
    try {
      await unlink(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export async function createGameSession(): Promise<GameSession> {
  return withLockedStore(async () => {
    const store = await readStore();
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
    };
    store.sessions[id] = session;
    store.roomIndex[roomCode] = id;
    await writeStore(store);
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
  return withLockedStore(async () => {
    const store = await readStore();
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
    await writeStore(store);
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
  const store = await readStore();
  const s = store.sessions[id];
  if (!s) return undefined;
  return migrateSession(s);
}

export async function getSessionIdByRoomCode(
  code: string,
): Promise<string | undefined> {
  const store = await readStore();
  return store.roomIndex[code.trim().toUpperCase()];
}

export async function saveGameSession(session: GameSession): Promise<void> {
  await withLockedStore(async () => {
    const store = await readStore();
    session.updatedAt = new Date().toISOString();
    applySessionToStoreFile(store, session);
    await writeStore(store);
  });
}

export async function updateGameSession(
  id: string,
  mutator: (s: GameSession) => void,
): Promise<GameSession | undefined> {
  return withLockedStore(async () => {
    const store = await readStore();
    const raw = store.sessions[id];
    if (!raw) return undefined;
    const s = migrateSession(raw);
    mutator(s);
    s.updatedAt = new Date().toISOString();
    store.sessions[id] = s;
    await writeStore(store);
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
  const effectiveViewer = viewerNationId ?? nationFromToken;

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
  return {
    ...rest,
    nations,
    nationRoster,
    secrets,
    turnLog,
    gmMessages: sanitizeGmMessagesForClient(viewerThread),
    diplomaticOutreach,
    emergentEvents,
    viewerNationId: effectiveViewer,
  };
}

export async function listGameSessions(): Promise<GameSession[]> {
  const store = await readStore();
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
