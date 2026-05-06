import "server-only";

import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

import type {
  NationForgeSnapshotPersistence,
  SnapshotIo,
} from "./store-snapshot-persistence";
import {
  emptyStoreFile,
  NATIONFORGE_SNAPSHOT_ID,
  type StoreFile,
} from "./store-snapshot-types";

function parsePayload(raw: unknown): StoreFile {
  if (raw == null) return emptyStoreFile();
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as StoreFile;
    } catch {
      return emptyStoreFile();
    }
  }
  return raw as StoreFile;
}

/**
 * `channel_binding=require` (common on Neon pooled URLs) breaks many Node/pg
 * WebSocket paths; strip it for the Pool driver.
 */
function normalizePoolConnectionString(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    u.searchParams.delete("channel_binding");
    return u.href;
  } catch {
    return connectionString;
  }
}

function getPool(connectionString: string): Pool {
  const g = globalThis as typeof globalThis & { __nationforgeNeonPool?: Pool };
  if (!g.__nationforgeNeonPool) {
    neonConfig.webSocketConstructor = ws;
    g.__nationforgeNeonPool = new Pool({
      connectionString: normalizePoolConnectionString(connectionString),
    });
    g.__nationforgeNeonPool.on("error", (err: Error) => {
      console.error("[nationforge] Neon pool error", err);
    });
  }
  return g.__nationforgeNeonPool;
}

export function createPostgresSnapshotPersistence(
  connectionString: string,
): NationForgeSnapshotPersistence {
  const pool = getPool(connectionString);

  let schemaReady: Promise<void> | null = null;

  async function ensureSchema(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nationforge_snapshot (
        id text PRIMARY KEY,
        payload jsonb NOT NULL
      )
    `);
    await pool.query(
      `
      INSERT INTO nationforge_snapshot (id, payload)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (id) DO NOTHING
      `,
      [NATIONFORGE_SNAPSHOT_ID, JSON.stringify(emptyStoreFile())],
    );
  }

  function ensureReady(): Promise<void> {
    schemaReady ??= ensureSchema();
    return schemaReady;
  }

  let storeWriteChain: Promise<unknown> = Promise.resolve();

  async function withSerializedChain<T>(task: () => Promise<T>): Promise<T> {
    const next = storeWriteChain.then(() => task());
    storeWriteChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  return {
    readSnapshot: async () => {
      await ensureReady();
      const { rows } = await pool.query<{ payload: unknown }>(
        "SELECT payload FROM nationforge_snapshot WHERE id = $1",
        [NATIONFORGE_SNAPSHOT_ID],
      );
      return parsePayload(rows[0]?.payload);
    },

    withLockedStore: async <T>(fn: (io: SnapshotIo) => Promise<T>) => {
      return withSerializedChain(async () => {
        await ensureReady();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const { rows } = await client.query<{ payload: unknown }>(
            "SELECT payload FROM nationforge_snapshot WHERE id = $1 FOR UPDATE",
            [NATIONFORGE_SNAPSHOT_ID],
          );
          let current = parsePayload(rows[0]?.payload);

          const io: SnapshotIo = {
            read: async () => current,
            write: async (store: StoreFile) => {
              current = store;
              await client.query(
                "UPDATE nationforge_snapshot SET payload = $1::jsonb WHERE id = $2",
                [JSON.stringify(store), NATIONFORGE_SNAPSHOT_ID],
              );
            },
          };

          const result = await fn(io);
          await client.query("COMMIT");
          return result;
        } catch (e) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* ignore */
          }
          throw e;
        } finally {
          client.release();
        }
      });
    },
  };
}
