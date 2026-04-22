import {
  convertToModelMessages,
  generateId,
  streamText,
  stepCountIs,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";

import { createNationForgeTools } from "@/lib/nationforge/game-tools";
import { buildGmSystemPrompt } from "@/lib/nationforge/gm-prompt";
import {
  formatPlayerTurnMessage,
  recoverStaleGmRunningPhase,
  stripOrphanOpeningUserMessage,
  type PlayerTurnPayload,
  validatePlayerTurn,
} from "@/lib/nationforge/player-input";
import { rateLimitNationForgeTurn } from "@/lib/nationforge/rate-limit";
import { sliceFromLastUser } from "@/lib/nationforge/slice-messages";
import {
  getGameSession,
  replaceGmMessages,
  saveGameSession,
} from "@/lib/nationforge/store";
import { defaultModelId, requireXaiApiKey, xai } from "@/lib/xai";

export const maxDuration = 300;

function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("x-real-ip") ?? "local";
}

export async function POST(req: Request) {
  try {
    requireXaiApiKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Configuration error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const ip = clientIp(req);
  let body: PlayerTurnPayload & { sessionId: string };
  try {
    body = (await req.json()) as PlayerTurnPayload & { sessionId: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const raw = await getGameSession(body.sessionId);
  if (!raw) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const cleaned = recoverStaleGmRunningPhase(stripOrphanOpeningUserMessage(raw));
  if (
    cleaned.gmMessages.length !== raw.gmMessages.length ||
    cleaned.phase !== raw.phase
  ) {
    await saveGameSession(cleaned);
  }

  const session = cleaned;

  const v = validatePlayerTurn(session, body);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }

  const rl = rateLimitNationForgeTurn(ip, body.sessionId);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limited", retryAfterMs: rl.retryAfterMs },
      { status: 429 },
    );
  }

  const userMessage: UIMessage = {
    id: generateId(),
    role: "user",
    parts: [{ type: "text", text: formatPlayerTurnMessage(body, session) }],
  };

  const allMessages: UIMessage[] = [...session.gmMessages, userMessage];
  await saveGameSession({
    ...session,
    gmMessages: allMessages,
    activeNationId: body.povNationId,
    phase: "gm_running",
  });

  const tools = createNationForgeTools(body.sessionId);
  const lastResponseId = session.lastGmResponseId;
  const usePreviousResponse = Boolean(lastResponseId);

  const fullModelMessages = await convertToModelMessages(allMessages, {
    tools,
  });

  const fresh = (await getGameSession(body.sessionId))!;
  const result = streamText({
    model: xai.responses(defaultModelId),
    system: buildGmSystemPrompt(fresh),
    messages: fullModelMessages,
    tools,
    stopWhen: stepCountIs(15),
    timeout: 360_000,
    prepareStep: async ({ stepNumber, steps }) => {
      if (stepNumber === 0 && usePreviousResponse) {
        return {
          messages: sliceFromLastUser(fullModelMessages),
          providerOptions: {
            xai: { previousResponseId: lastResponseId },
          },
        };
      }
      if (stepNumber > 0) {
        const rid = steps[stepNumber - 1]?.response?.id;
        if (rid) {
          return {
            providerOptions: {
              xai: { previousResponseId: rid },
            },
          };
        }
      }
      return undefined;
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: allMessages,
    onFinish: async ({ messages, isAborted }) => {
      if (isAborted) {
        const s = await getGameSession(body.sessionId);
        if (!s) return;
        const msgs = [...s.gmMessages];
        const last = msgs[msgs.length - 1];
        if (last?.role === "user") {
          msgs.pop();
        }
        await saveGameSession({
          ...s,
          gmMessages: msgs,
          phase: s.crisis ? "awaiting_decision" : "player_input",
        });
        return;
      }
      await replaceGmMessages(body.sessionId, messages);
      const steps = await result.steps;
      const newId = steps.at(-1)?.response?.id;
      const s = await getGameSession(body.sessionId);
      if (!s) return;
      await saveGameSession({
        ...s,
        lastGmResponseId: newId,
        phase: s.crisis ? "awaiting_decision" : "player_input",
      });
    },
  });
}
