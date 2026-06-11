import { NextResponse } from "next/server";

import { agentDebugLog } from "@/lib/debug-agent-log";
import { getConversation } from "@/lib/conversation-store";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const conversation = await getConversation(id);
    if (!conversation) {
      void agentDebugLog({
        hypothesisId: "H2",
        location: "app/api/conversations/[id]/route.ts:GET",
        message: "get_conversation_not_found",
        data: { id },
      });
      // #region agent log
      void fetch(
        "http://127.0.0.1:7711/ingest/ae23ea3c-0d7c-4b48-8c6c-33596b38e250",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "1416db",
          },
          body: JSON.stringify({
            sessionId: "1416db",
            hypothesisId: "H2",
            location: "app/api/conversations/[id]/route.ts:GET",
            message: "get_conversation_not_found",
            data: { id },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
      // #endregion
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    void agentDebugLog({
      hypothesisId: "H2",
      location: "app/api/conversations/[id]/route.ts:GET",
      message: "get_conversation_ok",
      data: {
        id,
        messageCount: conversation.messages?.length ?? 0,
        lastRole: conversation.messages?.at(-1)?.role ?? "none",
      },
    });
    // #region agent log
    void fetch(
      "http://127.0.0.1:7711/ingest/ae23ea3c-0d7c-4b48-8c6c-33596b38e250",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "1416db",
        },
        body: JSON.stringify({
          sessionId: "1416db",
          hypothesisId: "H2",
          location: "app/api/conversations/[id]/route.ts:GET",
          message: "get_conversation_ok",
          data: {
            id,
            messageCount: conversation.messages?.length ?? 0,
            lastRole:
              conversation.messages?.at(-1)?.role ?? "none",
          },
          timestamp: Date.now(),
        }),
      },
    ).catch(() => {});
    // #endregion
    return NextResponse.json(conversation);
  } catch (e) {
    console.error("[api/conversations/[id]] GET failed", e);
    void agentDebugLog({
      hypothesisId: "H2",
      location: "app/api/conversations/[id]/route.ts:GET",
      message: "get_conversation_throw",
      data: { err: e instanceof Error ? e.message : String(e) },
    });
    // #region agent log
    void fetch(
      "http://127.0.0.1:7711/ingest/ae23ea3c-0d7c-4b48-8c6c-33596b38e250",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "1416db",
        },
        body: JSON.stringify({
          sessionId: "1416db",
          hypothesisId: "H2",
          location: "app/api/conversations/[id]/route.ts:GET",
          message: "get_conversation_throw",
          data: { err: e instanceof Error ? e.message : String(e) },
          timestamp: Date.now(),
        }),
      },
    ).catch(() => {});
    // #endregion
    return NextResponse.json(
      { error: "Could not load conversation." },
      { status: 500 },
    );
  }
}
