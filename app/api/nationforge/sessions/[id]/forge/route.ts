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
  mutateSessionExclusive,
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

  const { type, ...rest } = body;

  if (type === "loadNameSuggestion") {
    const force = Boolean(rest.force);
    const result = await mutateSessionExclusive(sessionId, async (s) => {
      const found = getForgeNationByToken(s, token);
      if (!found) {
        return {
          ok: false,
          status: 403,
          message: "Invalid token or nation already forged.",
        };
      }
      const applied = await applyLoadNameSuggestionToSession(
        s,
        found.index,
        force,
      );
      return applied.ok
        ? { ok: true, session: applied.session }
        : { ok: false, status: 400, message: applied.error };
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message },
        { status: result.status },
      );
    }
    const publicView = filterSessionForClient(result.session, null, token);
    return NextResponse.json({ ok: true, session: publicView });
  }

  if (type === "loadReviewNarrative") {
    const force = Boolean(rest.force);
    const result = await mutateSessionExclusive(sessionId, async (s) => {
      const found = getForgeNationByToken(s, token);
      if (!found) {
        return {
          ok: false,
          status: 403,
          message: "Invalid token or nation already forged.",
        };
      }
      const applied = await applyLoadReviewNarrativeToSession(
        s,
        found.index,
        force,
      );
      return applied.ok
        ? { ok: true, session: applied.session }
        : { ok: false, status: 400, message: applied.error };
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message },
        { status: result.status },
      );
    }
    const publicView = filterSessionForClient(result.session, null, token);
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

  const result = await mutateSessionExclusive(sessionId, (s) => {
    const found = getForgeNationByToken(s, token);
    if (!found) {
      return {
        ok: false,
        status: 403,
        message: "Invalid token or nation already forged.",
      };
    }
    const applied = applyForgeActionToSession(s, found.index, action);
    return applied.ok
      ? { ok: true, session: applied.session }
      : { ok: false, status: 400, message: applied.error };
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }

  const publicView = filterSessionForClient(result.session, null, token);
  return NextResponse.json({ ok: true, session: publicView });
}
