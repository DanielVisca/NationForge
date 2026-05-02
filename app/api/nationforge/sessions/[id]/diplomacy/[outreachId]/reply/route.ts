import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  MAX_DIPLOMACY_MESSAGE_LENGTH,
  type DiplomacyMessage,
} from "@/lib/nationforge/schema";
import { rateLimitDiplomacy } from "@/lib/nationforge/rate-limit";
import {
  filterSessionForClient,
  getGameSession,
  updateGameSession,
} from "@/lib/nationforge/store";

type Ctx = { params: Promise<{ id: string; outreachId: string }> };

function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("x-real-ip") ?? "local";
}

function nationIdForToken(
  seatTokens: Record<string, string>,
  token: string,
): string | null {
  for (const [nid, tok] of Object.entries(seatTokens)) {
    if (tok === token) return nid;
  }
  return null;
}

export async function POST(req: Request, context: Ctx) {
  const { id: sessionId, outreachId } = await context.params;
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

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { reply?: unknown }).reply !== "string"
  ) {
    return NextResponse.json(
      { error: "Body must include reply (string)." },
      { status: 400 },
    );
  }

  const reply = (body as { reply: string }).reply.trim();
  if (!reply) {
    return NextResponse.json({ error: "Reply cannot be empty." }, { status: 400 });
  }
  if (reply.length > MAX_DIPLOMACY_MESSAGE_LENGTH) {
    return NextResponse.json(
      {
        error: `Reply too long (max ${MAX_DIPLOMACY_MESSAGE_LENGTH} characters).`,
      },
      { status: 400 },
    );
  }

  const ip = clientIp(req);
  const rl = rateLimitDiplomacy(ip, sessionId);
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

  const replierNationId = nationIdForToken(session.seatTokens, token);
  if (!replierNationId) {
    return NextResponse.json({ error: "Invalid seat token" }, { status: 403 });
  }

  const idx = (session.diplomaticOutreach ?? []).findIndex((o) => o.id === outreachId);
  if (idx === -1) {
    return NextResponse.json({ error: "Outreach not found" }, { status: 404 });
  }

  const outreach = session.diplomaticOutreach[idx]!;
  if (outreach.toNationId !== replierNationId && outreach.fromNationId !== replierNationId) {
    return NextResponse.json(
      { error: "Only participants can reply to this thread." },
      { status: 403 },
    );
  }

  const newReply: DiplomacyMessage = {
    id: randomUUID(),
    at: new Date().toISOString(),
    fromNationId: replierNationId,
    text: reply,
  };

  await updateGameSession(sessionId, (s) => {
    const i = (s.diplomaticOutreach ?? []).findIndex((o) => o.id === outreachId);
    if (i === -1) return;
    const o = s.diplomaticOutreach[i]!;
    s.diplomaticOutreach = [...s.diplomaticOutreach];
    s.diplomaticOutreach[i] = {
      ...o,
      messages: [...o.messages, newReply],
    };
  });

  const fresh = await getGameSession(sessionId);
  if (!fresh) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(filterSessionForClient(fresh, null, token));
}
