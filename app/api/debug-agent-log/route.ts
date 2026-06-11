import { NextResponse } from "next/server";

import { agentDebugLog } from "@/lib/debug-agent-log";

export const dynamic = "force-dynamic";

/** Dev-only bridge so browser logs reach `.cursor/debug-*.log` (ingest is server-local). */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const o = body as Record<string, unknown>;
  const message = typeof o.message === "string" ? o.message : "client_log";
  const hypothesisId =
    typeof o.hypothesisId === "string" ? o.hypothesisId : "H-client";
  const location = typeof o.location === "string" ? o.location : "unknown";
  const data = "data" in o ? o.data : undefined;

  await agentDebugLog({
    hypothesisId,
    location,
    message,
    ...(data !== undefined ? { data } : {}),
  });

  return NextResponse.json({ ok: true });
}
