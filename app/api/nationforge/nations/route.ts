import { NextResponse } from "next/server";

import {
  filterSessionForClient,
  getGameSession,
  registerNation,
} from "@/lib/nationforge/store";

export async function POST(req: Request) {
  let body: { roomCode?: string; displayName?: string };
  try {
    body = (await req.json()) as { roomCode?: string; displayName?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const roomCode = body.roomCode?.trim();
  if (!roomCode) {
    return NextResponse.json({ error: "roomCode is required" }, { status: 400 });
  }

  const result = await registerNation(roomCode, body.displayName ?? "");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const session = await getGameSession(result.sessionId);
  const publicView = session
    ? filterSessionForClient(session, null, result.token)
    : null;

  return NextResponse.json({
    sessionId: result.sessionId,
    nationId: result.nationId,
    name: result.name,
    token: result.token,
    session: publicView,
  });
}
