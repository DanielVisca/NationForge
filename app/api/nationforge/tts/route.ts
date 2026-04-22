import { NextResponse } from "next/server";

import { normalizeXaiTtsVoiceId } from "@/lib/nationforge/tts-voices";
import { requireXaiApiKey } from "@/lib/xai";

export const maxDuration = 60;

const TTS_WINDOW_MS = 60_000;
const TTS_MAX_PER_WINDOW = 40;
const ttsBuckets = new Map<string, number[]>();

function rateLimitTts(ip: string): { ok: true } | { ok: false; retryAfterMs: number } {
  const now = Date.now();
  const prev = ttsBuckets.get(ip) ?? [];
  const recent = prev.filter((t) => now - t < TTS_WINDOW_MS);
  if (recent.length >= TTS_MAX_PER_WINDOW) {
    const oldest = recent[0] ?? now;
    return { ok: false, retryAfterMs: TTS_WINDOW_MS - (now - oldest) };
  }
  recent.push(now);
  ttsBuckets.set(ip, recent);
  return { ok: true };
}

function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("x-real-ip") ?? "local";
}

/** Single-request cap; client should chunk longer copy. */
const MAX_TEXT_CHARS = 4096;

export async function POST(req: Request) {
  let body: { text?: string; voice_id?: string; language?: string };
  try {
    body = (await req.json()) as {
      text?: string;
      voice_id?: string;
      language?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      { error: `text exceeds ${MAX_TEXT_CHARS} characters; split on the client.` },
      { status: 400 },
    );
  }

  let apiKey: string;
  try {
    apiKey = requireXaiApiKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Configuration error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const ip = clientIp(req);
  const rl = rateLimitTts(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limited", retryAfterMs: rl.retryAfterMs },
      { status: 429 },
    );
  }

  const voice_id = normalizeXaiTtsVoiceId(
    typeof body.voice_id === "string" && body.voice_id.trim()
      ? body.voice_id.trim()
      : process.env.XAI_TTS_VOICE_ID,
  );
  const language =
    typeof body.language === "string" && body.language.trim()
      ? body.language.trim()
      : "en";

  const res = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, voice_id, language }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return NextResponse.json(
      { error: errText || `TTS error ${res.status}` },
      { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
