import { NextResponse } from "next/server";

import {
  filterSessionForClient,
  getGameSession,
} from "@/lib/nationforge/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Ctx) {
  const { id } = await context.params;
  const session = await getGameSession(id);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const viewer = url.searchParams.get("viewerNationId");
  const publicView = filterSessionForClient(
    session,
    viewer,
    token,
  );
  return NextResponse.json(publicView);
}
