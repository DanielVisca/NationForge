import { NextResponse } from "next/server";

import { getConversation } from "@/lib/conversation-store";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const conversation = await getConversation(id);
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(conversation);
  } catch (e) {
    console.error("[api/conversations/[id]] GET failed", e);
    return NextResponse.json(
      { error: "Could not load conversation." },
      { status: 500 },
    );
  }
}
