import "server-only";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 24;

const buckets = new Map<string, number[]>();

function key(ip: string, sessionId: string): string {
  return `${ip}::${sessionId}`;
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
