import { NextResponse } from "next/server";

import {
  createConversation,
  listConversations,
} from "@/lib/conversation-store";

export async function GET() {
  const conversations = await listConversations();
  return NextResponse.json({ conversations });
}

export async function POST() {
  const conversation = await createConversation();
  return NextResponse.json(conversation);
}
