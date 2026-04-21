import { NextResponse } from "next/server";

import {
  applyForgeActionToSession,
  applyLoadNameSuggestionToSession,
  applyLoadReviewNarrativeToSession,
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
  let body: { token?: string; type?: string; force?: boolean } & Record<
    string,
    unknown
  >;
  try {
    body = (await req.json()) as { token?: string; type?: string } & Record<
      string,
      unknown
    >;
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

  if (type === "loadNameSuggestion") {
    const force = Boolean(rest.force);
    const applied = await applyLoadNameSuggestionToSession(
      session,
      found.index,
      force,
    );
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

  if (type === "loadReviewNarrative") {
    const force = Boolean(rest.force);
    const applied = await applyLoadReviewNarrativeToSession(
      session,
      found.index,
      force,
    );
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
  } else if (type === "submitNationName") {
    const name = (rest as { name?: string }).name;
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    action = { type: "submitNationName", name };
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
