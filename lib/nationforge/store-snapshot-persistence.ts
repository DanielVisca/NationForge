import "server-only";

import type { StoreFile } from "./store-snapshot-types";

export type SnapshotIo = {
  read: () => Promise<StoreFile>;
  write: (store: StoreFile) => Promise<void>;
};

export type NationForgeSnapshotPersistence = {
  readSnapshot: () => Promise<StoreFile>;
  withLockedStore: <T>(fn: (io: SnapshotIo) => Promise<T>) => Promise<T>;
};
