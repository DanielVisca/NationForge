import { NextResponse } from "next/server";

import {
  applyForgeActionToSession,
  type ForgeClientAction,
  getForgeNationByToken,
} from "@/lib/nationforge/forge-handlers";
import {
  filterSessionForClient,
  getGameSession,
  saveGameSession,
} from "@/lib/nationforge/store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: Ctx) {
  const { id: sessionId } = await context.params;
  let body: { token?: string } & ForgeClientAction;
  try {
    body = (await req.json()) as { token?: string } & ForgeClientAction;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const session = await getGameSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const found = getForgeNationByToken(session, token);
  if (!found) {
    return NextResponse.json(
      { error: "Invalid token or nation already forged." },
      { status: 403 },
    );
  }

  const { type, ...rest } = body;
  let action: ForgeClientAction;
  if (type === "pick") {
    const choiceId = (rest as { choiceId?: string }).choiceId?.trim();
    if (!choiceId) {
      return NextResponse.json({ error: "choiceId required" }, { status: 400 });
    }
    action = { type: "pick", choiceId };
  } else if (type === "setAddons") {
    const ids = (rest as { ids?: string[] }).ids;
    if (!Array.isArray(ids)) {
      return NextResponse.json({ error: "ids array required" }, { status: 400 });
    }
    action = { type: "setAddons", ids };
  } else if (type === "back") {
    action = { type: "back" };
  } else if (type === "finalize") {
    action = { type: "finalize" };
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const applied = applyForgeActionToSession(session, found.index, action);
  if (!applied.ok) {
    return NextResponse.json({ error: applied.error }, { status: 400 });
  }

  await saveGameSession(applied.session);
  const fresh = await getGameSession(sessionId);
  const publicView = fresh
    ? filterSessionForClient(fresh, null, token)
    : null;

  return NextResponse.json({ ok: true, session: publicView });
}
