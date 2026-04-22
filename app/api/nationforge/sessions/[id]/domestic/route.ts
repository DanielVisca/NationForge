import { NextResponse } from "next/server";

import { MAX_DOMESTIC_SCRATCH_LENGTH } from "@/lib/nationforge/schema";
import type { GameSession } from "@/lib/nationforge/schema";
import { rateLimitDomesticScratch } from "@/lib/nationforge/rate-limit";
import {
  filterSessionForClient,
  getGameSession,
  updateGameSession,
} from "@/lib/nationforge/store";

type Ctx = { params: Promise<{ id: string }> };

function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("x-real-ip") ?? "local";
}

function nationIdForToken(session: GameSession, token: string): string | null {
  for (const [nid, tok] of Object.entries(session.seatTokens)) {
    if (tok === token) return nid;
  }
  return null;
}

export async function PATCH(req: Request, context: Ctx) {
  const { id: sessionId } = await context.params;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token?.trim()) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw =
    typeof body === "object" &&
    body !== null &&
    "domesticScratch" in body &&
    typeof (body as { domesticScratch: unknown }).domesticScratch === "string"
      ? (body as { domesticScratch: string }).domesticScratch
      : null;
  if (raw === null) {
    return NextResponse.json(
      { error: "Body must include domesticScratch (string)." },
      { status: 400 },
    );
  }

  const domesticScratch = raw.trim();
  if (domesticScratch.length > MAX_DOMESTIC_SCRATCH_LENGTH) {
    return NextResponse.json(
      {
        error: `Domestic scene is too long (max ${MAX_DOMESTIC_SCRATCH_LENGTH} characters).`,
      },
      { status: 400 },
    );
  }

  const ip = clientIp(req);
  const rl = rateLimitDomesticScratch(ip, sessionId);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limited", retryAfterMs: rl.retryAfterMs },
      { status: 429 },
    );
  }

  const session = await getGameSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const nationId = nationIdForToken(session, token);
  if (!nationId) {
    return NextResponse.json({ error: "Invalid seat token" }, { status: 403 });
  }

  const idx = session.nations.findIndex((n) => n.id === nationId);
  if (idx === -1) {
    return NextResponse.json({ error: "Nation not found" }, { status: 404 });
  }

  await updateGameSession(sessionId, (s) => {
    const i = s.nations.findIndex((n) => n.id === nationId);
    if (i === -1) return;
    const n = s.nations[i]!;
    s.nations[i] = { ...n, domesticScratch };
  });

  const fresh = await getGameSession(sessionId);
  if (!fresh) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const publicView = filterSessionForClient(fresh, null, token);
  return NextResponse.json(publicView);
}
