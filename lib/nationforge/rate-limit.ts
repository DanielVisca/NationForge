import "server-only";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 24;

const buckets = new Map<string, number[]>();

function key(ip: string, sessionId: string): string {
  return `${ip}::${sessionId}`;
}

const DOMESTIC_WINDOW_MS = 60_000;
const DOMESTIC_MAX_REQUESTS = 40;

const domesticBuckets = new Map<string, number[]>();

function domesticKey(ip: string, sessionId: string): string {
  return `domestic::${ip}::${sessionId}`;
}

const DIPLOMACY_WINDOW_MS = 60_000;
const DIPLOMACY_MAX_REQUESTS = 36;

const diplomacyBuckets = new Map<string, number[]>();

function diplomacyKey(ip: string, sessionId: string): string {
  return `diplomacy::${ip}::${sessionId}`;
}

// Periodic sweep so keys for clients that simply stopped calling are eventually
// evicted (the per-call cleanup only fires for keys that are touched again).
// We guard against running on every call by only sweeping once every
// SWEEP_INTERVAL_MS. Each sweep is O(total timestamps) and just drops any key
// whose timestamps are all older than its window.
const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweepAt = 0;

function sweepBucketMap(map: Map<string, number[]>, windowMs: number, now: number): void {
  for (const [k, timestamps] of map) {
    const hasRecent = timestamps.some((t) => now - t < windowMs);
    if (!hasRecent) {
      map.delete(k);
    }
  }
}

function maybeSweep(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  sweepBucketMap(buckets, WINDOW_MS, now);
  sweepBucketMap(domesticBuckets, DOMESTIC_WINDOW_MS, now);
  sweepBucketMap(diplomacyBuckets, DIPLOMACY_WINDOW_MS, now);
}

export function rateLimitDiplomacy(
  ip: string,
  sessionId: string,
): { ok: true } | { ok: false; retryAfterMs: number } {
  const k = diplomacyKey(ip, sessionId);
  const now = Date.now();
  maybeSweep(now);
  const prev = diplomacyBuckets.get(k) ?? [];
  const recent = prev.filter((t) => now - t < DIPLOMACY_WINDOW_MS);
  // Evict on empty: if all stored timestamps have aged out, drop the stale key
  // rather than leaving (or re-storing) an empty array that would leak memory.
  if (recent.length === 0) diplomacyBuckets.delete(k);
  if (recent.length >= DIPLOMACY_MAX_REQUESTS) {
    const oldest = recent[0] ?? now;
    return { ok: false, retryAfterMs: DIPLOMACY_WINDOW_MS - (now - oldest) };
  }
  recent.push(now);
  diplomacyBuckets.set(k, recent);
  return { ok: true };
}

export function rateLimitDomesticScratch(
  ip: string,
  sessionId: string,
): { ok: true } | { ok: false; retryAfterMs: number } {
  const k = domesticKey(ip, sessionId);
  const now = Date.now();
  maybeSweep(now);
  const prev = domesticBuckets.get(k) ?? [];
  const recent = prev.filter((t) => now - t < DOMESTIC_WINDOW_MS);
  // Evict on empty: if all stored timestamps have aged out, drop the stale key
  // rather than leaving (or re-storing) an empty array that would leak memory.
  if (recent.length === 0) domesticBuckets.delete(k);
  if (recent.length >= DOMESTIC_MAX_REQUESTS) {
    const oldest = recent[0] ?? now;
    return { ok: false, retryAfterMs: DOMESTIC_WINDOW_MS - (now - oldest) };
  }
  recent.push(now);
  domesticBuckets.set(k, recent);
  return { ok: true };
}

export function rateLimitNationForgeTurn(
  ip: string,
  sessionId: string,
): { ok: true } | { ok: false; retryAfterMs: number } {
  const k = key(ip, sessionId);
  const now = Date.now();
  maybeSweep(now);
  const prev = buckets.get(k) ?? [];
  const recent = prev.filter((t) => now - t < WINDOW_MS);
  // Evict on empty: if all stored timestamps have aged out, drop the stale key
  // rather than leaving (or re-storing) an empty array that would leak memory.
  if (recent.length === 0) buckets.delete(k);
  if (recent.length >= MAX_REQUESTS) {
    const oldest = recent[0] ?? now;
    return { ok: false, retryAfterMs: WINDOW_MS - (now - oldest) };
  }
  recent.push(now);
  buckets.set(k, recent);
  return { ok: true };
}
