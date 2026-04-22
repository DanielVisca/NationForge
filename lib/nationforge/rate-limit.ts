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

export function rateLimitDiplomacy(
  ip: string,
  sessionId: string,
): { ok: true } | { ok: false; retryAfterMs: number } {
  const k = diplomacyKey(ip, sessionId);
  const now = Date.now();
  const prev = diplomacyBuckets.get(k) ?? [];
  const recent = prev.filter((t) => now - t < DIPLOMACY_WINDOW_MS);
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
  const prev = domesticBuckets.get(k) ?? [];
  const recent = prev.filter((t) => now - t < DOMESTIC_WINDOW_MS);
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
  const prev = buckets.get(k) ?? [];
  const recent = prev.filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    const oldest = recent[0] ?? now;
    return { ok: false, retryAfterMs: WINDOW_MS - (now - oldest) };
  }
  recent.push(now);
  buckets.set(k, recent);
  return { ok: true };
}
