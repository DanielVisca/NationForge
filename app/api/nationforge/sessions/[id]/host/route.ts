import { NextResponse } from "next/server";

import {
  forceStartTable,
  removeUnforgedSeat,
} from "@/lib/nationforge/store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: Ctx) {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const token = (body as { token?: unknown }).token;
  const action = (body as { action?: unknown }).action;
  if (typeof token !== "string" || !token.trim()) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  if (action === "removeSeat") {
    const targetNationId = (body as { targetNationId?: unknown }).targetNationId;
    if (typeof targetNationId !== "string" || !targetNationId.trim()) {
      return NextResponse.json(
        { error: "targetNationId is required." },
        { status: 400 },
      );
    }
    const result = await removeUnforgedSeat(id, token, targetNationId);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "forceStart") {
    const result = await forceStartTable(id, token);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
