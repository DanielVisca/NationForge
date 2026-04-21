import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UIMessage } from "ai";

import type { Crisis, GameSession, Nation, NationStats } from "./schema";
import type { PublicGameSession, PublicSecret } from "./public-types";
import { STAT_KEYS } from "./schema";

type StoreFile = {
  sessions: Record<string, GameSession>;
  /** roomCode (uppercase) -> sessionId */
  roomIndex: Record<string, string>;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "nationforge-sessions.json");

function defaultStats(): NationStats {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, 50])) as NationStats;
}

function starterCrisis(nationA: string, nationB: string): Crisis {
  return {
    id: randomUUID(),
    prompt:
      "Year 1 — both powers scan the frontier. Choose how your nation opens the era.",
    options: [
      { id: "a", label: "Signal peaceful intent; invest in trade envoys" },
      { id: "b", label: "Fortify borders; prioritize internal security" },
      { id: "c", label: "Secretly accelerate a high-risk research program" },
      { id: "d", label: "Demand joint inspection of shared infrastructure" },
    ],
    allowCustom: true,
    activeNationIds: [nationA, nationB],
  };
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

function emptySeatTokens(nationIds: string[]): Record<string, string> {
  return Object.fromEntries(
    nationIds.map((id) => [id, randomUUID()] as const),
  );
}

export async function createGameSession(): Promise<GameSession> {
  const store = await readStore();
  const id = randomUUID();
  const na = randomUUID();
  const nb = randomUUID();
  const nations: Nation[] = [
    {
      id: na,
      name: "Nation A",
      buildNotes: "100-point build TBD — edit on first turn.",
      stats: defaultStats(),
      reserve: 0,
    },
    {
      id: nb,
      name: "Nation B",
      buildNotes: "100-point build TBD — edit on first turn.",
      stats: defaultStats(),
      reserve: 0,
    },
  ];
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
    phase: "awaiting_decision",
    roundIndex: 0,
    activeNationId: na,
    nations,
    crisis: starterCrisis(na, nb),
    turnLog: [],
    secrets: [],
    seatTokens: emptySeatTokens([na, nb]),
    gmMessages: [],
  };
  store.sessions[id] = session;
  store.roomIndex[roomCode] = id;
  await writeStore(store);
  return session;
}

export async function getGameSession(
  id: string,
): Promise<GameSession | undefined> {
  const store = await readStore();
  return store.sessions[id];
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
  let nationFromToken: string | null = null;
  if (seatToken) {
    for (const [nid, tok] of Object.entries(session.seatTokens)) {
      if (tok === seatToken) {
        nationFromToken = nid;
        break;
      }
    }
  }
  const effectiveViewer = viewerNationId ?? nationFromToken;

  const secrets: PublicSecret[] = session.secrets.map((s) => {
    if (s.revealed) {
      return {
        id: s.id,
        nationId: s.nationId,
        label: s.label,
        revealed: true,
        content: s.content,
      };
    }
    if (effectiveViewer && s.nationId === effectiveViewer) {
      return {
        id: s.id,
        nationId: s.nationId,
        label: s.label,
        revealed: false,
        content: s.content,
      };
    }
    return {
      id: s.id,
      nationId: s.nationId,
      label: s.label,
      revealed: false,
    };
  });

  const { seatTokens, secrets: _sessionSecrets, ...rest } = session;
  void seatTokens;
  void _sessionSecrets;
  return {
    ...rest,
    secrets,
    viewerNationId: effectiveViewer,
  };
}

export async function listGameSessions(): Promise<GameSession[]> {
  const store = await readStore();
  return Object.values(store.sessions).sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

export async function appendGmMessage(
  sessionId: string,
  message: UIMessage,
): Promise<void> {
  await updateGameSession(sessionId, (s) => {
    s.gmMessages = [...s.gmMessages, message];
  });
}

export async function replaceGmMessages(
  sessionId: string,
  messages: UIMessage[],
): Promise<void> {
  await updateGameSession(sessionId, (s) => {
    s.gmMessages = messages;
  });
}
