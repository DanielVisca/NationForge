import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import {
  MAX_DIPLOMACY_MESSAGE_LENGTH,
  MAX_DIPLOMACY_OUTREACH_TOTAL,
  type DiplomaticOutreach,
} from "@/lib/nationforge/schema";
import { rateLimitDiplomacy } from "@/lib/nationforge/rate-limit";
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

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { toNationId?: unknown }).toNationId !== "string" ||
    typeof (body as { message?: unknown }).message !== "string"
  ) {
    return NextResponse.json(
      { error: "Body must include toNationId (string) and message (string)." },
      { status: 400 },
    );
  }

  const toNationId = (body as { toNationId: string }).toNationId.trim();
  const message = (body as { message: string }).message.trim();
  if (!toNationId) {
    return NextResponse.json({ error: "toNationId is required." }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Message cannot be empty." }, { status: 400 });
  }
  if (message.length > MAX_DIPLOMACY_MESSAGE_LENGTH) {
    return NextResponse.json(
      {
        error: `Message too long (max ${MAX_DIPLOMACY_MESSAGE_LENGTH} characters).`,
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

  const fromNationId = nationIdForToken(session.seatTokens, token);
  if (!fromNationId) {
    return NextResponse.json({ error: "Invalid seat token" }, { status: 403 });
  }

  if (fromNationId === toNationId) {
    return NextResponse.json(
      { error: "Cannot send diplomacy to your own nation." },
      { status: 400 },
    );
  }

  const fromNation = session.nations.find((n) => n.id === fromNationId);
  const toNation = session.nations.find((n) => n.id === toNationId);
  if (!fromNation?.forgeComplete || !toNation) {
    return NextResponse.json(
      { error: "Unknown target nation or your nation is not forge-complete." },
      { status: 400 },
    );
  }

  const entry: DiplomaticOutreach = {
    id: randomUUID(),
    at: new Date().toISOString(),
    fromNationId,
    toNationId,
    message,
  };

  await updateGameSession(sessionId, (s) => {
    const list = [...(s.diplomaticOutreach ?? []), entry];
    const trimmed =
      list.length > MAX_DIPLOMACY_OUTREACH_TOTAL
        ? list.slice(-MAX_DIPLOMACY_OUTREACH_TOTAL)
        : list;
    s.diplomaticOutreach = trimmed;
  });

  const fresh = await getGameSession(sessionId);
  if (!fresh) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(filterSessionForClient(fresh, null, token));
}
