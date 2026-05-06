import { NextResponse } from "next/server";

import { nationforgeErrorResponse } from "@/lib/nationforge/nationforge-http-error";
import {
  createGameSession,
  listNationForgeSessionSummaries,
} from "@/lib/nationforge/store";

export async function GET() {
  try {
    const sessions = await listNationForgeSessionSummaries();
    return NextResponse.json({ sessions });
  } catch (e) {
    return nationforgeErrorResponse("NATIONFORGE_SESSIONS_GET", e);
  }
}

export async function POST() {
  try {
    const session = await createGameSession();
    return NextResponse.json(session);
  } catch (e) {
    return nationforgeErrorResponse("NATIONFORGE_SESSIONS_POST", e);
  }
}
