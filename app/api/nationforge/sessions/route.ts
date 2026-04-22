import { NextResponse } from "next/server";

import { createGameSession, listGameSessions } from "@/lib/nationforge/store";

export async function GET() {
  const sessions = await listGameSessions();
  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      roomCode: s.roomCode,
      updatedAt: s.updatedAt,
      roundIndex: s.roundIndex,
      phase: s.phase,
      nationNames: s.nations.filter((n) => n.forgeComplete).map((n) => n.name),
      nationsInForge: s.nations.filter((n) => !n.forgeComplete).length,
    })),
  });
}

export async function POST() {
  const session = await createGameSession();
  return NextResponse.json(session);
}
