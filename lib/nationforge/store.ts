import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UIMessage } from "ai";

import type { GameSession, Nation, NationStats } from "./schema";
import type { PublicGameSession, PublicSecret } from "./public-types";
import { STAT_KEYS } from "./schema";
import { migrateSession } from "./session-migrate";

type StoreFile = {
  sessions: Record<string, GameSession>;
  /** roomCode (uppercase) -> sessionId */
  roomIndex: Record<string, string>;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "nationforge-sessions.json");
const MAX_NATIONS_PER_SESSION = 12;

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
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export async function createGameSession(): Promise<GameSession> {
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
    gmMessages: [],
    diplomaticOutreach: [],
  };
  store.sessions[id] = session;
  store.roomIndex[roomCode] = id;
  await writeStore(store);
  return session;
}

export async function registerNation(
  roomCode: string,
  displayName: string,
): Promise<
  | { ok: true; sessionId: string; nationId: string; token: string; name: string }
  | { ok: false; error: string }
> {
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
  const store = await readStore();
  const prev = store.sessions[session.id];
  if (prev && prev.roomCode !== session.roomCode) {
    delete store.roomIndex[prev.roomCode];
    store.roomIndex[session.roomCode] = session.id;
  } else if (!prev) {
    store.roomIndex[session.roomCode] = session.id;
  }
  session.updatedAt = new Date().toISOString();
  store.sessions[session.id] = session;
  await writeStore(store);
}

export async function updateGameSession(
  id: string,
  mutator: (s: GameSession) => void,
): Promise<GameSession | undefined> {
  const store = await readStore();
  const s = store.sessions[id];
  if (!s) return undefined;
  mutator(s);
  s.updatedAt = new Date().toISOString();
  store.sessions[id] = s;
  await writeStore(store);
  return s;
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

  const {
    seatTokens,
    secrets: _sessionSecrets,
    nations: _n,
    diplomaticOutreach: _allOutreach,
    ...rest
  } = s;
  void seatTokens;
  void _sessionSecrets;
  void _n;
  void _allOutreach;
  return {
    ...rest,
    nations,
    nationRoster,
    secrets,
    diplomaticOutreach,
    viewerNationId: effectiveViewer,
  };
}

export async function listGameSessions(): Promise<GameSession[]> {
  const store = await readStore();
  return Object.values(store.sessions)
    .map((s) => migrateSession(s))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function appendGmMessage(
  sessionId: string,
  message: UIMessage,
): Promise<void> {
  await updateGameSession(sessionId, (sess) => {
    sess.gmMessages = [...sess.gmMessages, message];
  });
}

export async function replaceGmMessages(
  sessionId: string,
  messages: UIMessage[],
): Promise<void> {
  await updateGameSession(sessionId, (sess) => {
    sess.gmMessages = messages;
  });
}
