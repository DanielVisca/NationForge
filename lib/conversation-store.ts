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

/** Sidebar / list API: small payload, safe to JSON.stringify. */
export type ConversationListItem = {
  id: string;
  title: string;
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
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("conversations" in parsed) ||
      typeof (parsed as StoreFile).conversations !== "object" ||
      (parsed as StoreFile).conversations === null
    ) {
      return { conversations: {} };
    }
    return parsed as StoreFile;
  } catch {
    return { conversations: {} };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Old rows may have empty `id` on UI messages, which breaks React keys and reconciliation. */
function withStableMessageIds(messages: UIMessage[]): UIMessage[] {
  return messages.map((m, i) =>
    typeof m.id === "string" && m.id.trim().length > 0
      ? m
      : { ...m, id: `legacy-${i}` },
  );
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

export async function listConversationSummaries(): Promise<
  ConversationListItem[]
> {
  const { conversations } = await readStore();
  return Object.values(conversations)
    .filter(
      (c): c is StoredConversation =>
        isRecord(c) &&
        typeof c.id === "string" &&
        c.id.trim().length > 0 &&
        typeof c.title === "string" &&
        typeof c.updatedAt === "string",
    )
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function getConversation(
  id: string,
): Promise<StoredConversation | undefined> {
  const { conversations } = await readStore();
  const row = conversations[id];
  if (!row) return undefined;
  return {
    ...row,
    messages: withStableMessageIds(row.messages ?? []),
  };
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
