import { NextResponse } from "next/server";

import {
  createConversation,
  listConversationSummaries,
} from "@/lib/conversation-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const conversations = await listConversationSummaries();
    return NextResponse.json({ conversations });
  } catch (e) {
    console.error("[api/conversations] GET failed", e);
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
