import { NextResponse } from "next/server";

import {
  createGameSession,
  listNationForgeSessionSummaries,
} from "@/lib/nationforge/store";

export async function GET() {
  const sessions = await listNationForgeSessionSummaries();
  return NextResponse.json({ sessions });
}

export async function POST() {
  const session = await createGameSession();
  return NextResponse.json(session);
}
