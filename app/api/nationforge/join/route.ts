import { NextResponse } from "next/server";

import { getSessionIdByRoomCode } from "@/lib/nationforge/store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim();
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }
  const sessionId = await getSessionIdByRoomCode(code);
  if (!sessionId) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  return NextResponse.json({ sessionId, roomCode: code.toUpperCase() });
}
