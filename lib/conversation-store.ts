import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UIMessage } from "ai";

export type StoredConversation = {
  id: string;
  title: string;
  messages: UIMessage[];
  lastResponseId?: string;
  updatedAt: string;
};

type StoreFile = {
  conversations: Record<string, StoredConversation>;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "conversations.json");

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<StoreFile> {
  try {
    const raw = await readFile(STORE_PATH, "utf-8");
    return JSON.parse(raw) as StoreFile;
  } catch {
    return { conversations: {} };
  }
}

async function writeStore(store: StoreFile): Promise<void> {
  await ensureDataDir();
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function titleFromMessages(messages: UIMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const textPart = m.parts?.find(
      (p): p is { type: "text"; text: string } => p.type === "text",
    );
    if (textPart?.text?.trim()) {
      const t = textPart.text.trim().replace(/\s+/g, " ");
      return t.length > 48 ? `${t.slice(0, 47)}…` : t;
    }
  }
  return "New chat";
}

export async function listConversations(): Promise<StoredConversation[]> {
  const { conversations } = await readStore();
  return Object.values(conversations).sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

export async function getConversation(
  id: string,
): Promise<StoredConversation | undefined> {
  const { conversations } = await readStore();
  return conversations[id];
}

export async function createConversation(): Promise<StoredConversation> {
  const store = await readStore();
  const id = randomUUID();
  const now = new Date().toISOString();
  const conv: StoredConversation = {
    id,
    title: "New chat",
    messages: [],
    updatedAt: now,
  };
  store.conversations[id] = conv;
  await writeStore(store);
  return conv;
}

export async function saveConversationPatch(
  id: string,
  patch: Partial<
    Pick<StoredConversation, "messages" | "lastResponseId" | "title">
  >,
): Promise<StoredConversation | undefined> {
  const store = await readStore();
  const existing = store.conversations[id];
  if (!existing) return undefined;

  const messages = patch.messages ?? existing.messages;
  const updated: StoredConversation = {
    ...existing,
    ...patch,
    messages,
    title: patch.title ?? titleFromMessages(messages),
    updatedAt: new Date().toISOString(),
  };
  store.conversations[id] = updated;
  await writeStore(store);
  return updated;
}
