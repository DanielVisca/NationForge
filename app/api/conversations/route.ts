import { NextResponse } from "next/server";

import { agentDebugLog } from "@/lib/debug-agent-log";
import {
  createConversation,
  listConversationSummaries,
} from "@/lib/conversation-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const conversations = await listConversationSummaries();
    void agentDebugLog({
      hypothesisId: "H1",
      location: "app/api/conversations/route.ts:GET",
      message: "list_conversations_ok",
      data: { count: conversations.length },
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
          hypothesisId: "H1",
          location: "app/api/conversations/route.ts:GET",
          message: "list_conversations_ok",
          data: { count: conversations.length },
          timestamp: Date.now(),
        }),
      },
    ).catch(() => {});
    // #endregion
    return NextResponse.json({ conversations });
  } catch (e) {
    console.error("[api/conversations] GET failed", e);
    void agentDebugLog({
      hypothesisId: "H1",
      location: "app/api/conversations/route.ts:GET",
      message: "list_conversations_error",
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
          hypothesisId: "H1",
          location: "app/api/conversations/route.ts:GET",
          message: "list_conversations_error",
          data: {
            err: e instanceof Error ? e.message : String(e),
          },
          timestamp: Date.now(),
        }),
      },
    ).catch(() => {});
    // #endregion
    return NextResponse.json(
      { error: "Could not list conversations." },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const conversation = await createConversation();
    return NextResponse.json(conversation);
  } catch (e) {
    console.error("[api/conversations] POST failed", e);
    return NextResponse.json(
      { error: "Could not create conversation." },
      { status: 500 },
    );
  }
}
