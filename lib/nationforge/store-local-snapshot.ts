import "server-only";

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type {
  NationForgeSnapshotPersistence,
  SnapshotIo,
} from "./store-snapshot-persistence";
import { emptyStoreFile, type StoreFile } from "./store-snapshot-types";

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "nationforge-sessions.json");

let storeWriteChain: Promise<unknown> = Promise.resolve();

async function withLockedStore<T>(task: () => Promise<T>): Promise<T> {
  const next = storeWriteChain.then(() => task());
  storeWriteChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<StoreFile> {
  try {
    const raw = await readFile(STORE_PATH, "utf-8");
    return JSON.parse(raw) as StoreFile;
  } catch {
    return emptyStoreFile();
  }
}

async function writeStore(store: StoreFile): Promise<void> {
  if (process.env.VERCEL) {
    throw new Error(
      "NationForge: add DATABASE_URL in Vercel project settings — the serverless filesystem cannot persist .data/nationforge-sessions.json.",
    );
  }
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

export function createLocalSnapshotPersistence(): NationForgeSnapshotPersistence {
  return {
    readSnapshot: readStore,
    withLockedStore: async <T>(fn: (io: SnapshotIo) => Promise<T>) => {
      return withLockedStore(() =>
        fn({
          read: readStore,
          write: writeStore,
        }),
      );
    },
  };
}
