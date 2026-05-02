import {
  convertToModelMessages,
  generateText,
  generateId,
  streamText,
  stepCountIs,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";

import { createNationForgeTools } from "@/lib/nationforge/game-tools";
import { buildGmSystemPrompt } from "@/lib/nationforge/gm-prompt";
import { preparePlayerTurnForPersistence } from "@/lib/nationforge/confidential-turn";
import { lastAssistantTextProseFromMessages } from "@/lib/nationforge/assistant-ui-prose";
import {
  formatPlayerTurnMessage,
  recoverStaleGmRunningPhase,
  stripOrphanOpeningUserMessage,
  type PlayerTurnPayload,
  validatePlayerTurn,
} from "@/lib/nationforge/player-input";
import { rateLimitNationForgeTurn } from "@/lib/nationforge/rate-limit";
import { sliceFromLastUser } from "@/lib/nationforge/slice-messages";
import { getNationGmMessages } from "@/lib/nationforge/gm-threads";
import {
  getGameSession,
  mutateSessionExclusive,
  replaceNationGmMessages,
  saveGameSession,
} from "@/lib/nationforge/store";
import { defaultModelId, requireXaiApiKey, xai } from "@/lib/xai";

export const maxDuration = 300;

const GM_MAX_OUTPUT_TOKENS = 5500;
const GM_CONTINUATION_MAX_OUTPUT_TOKENS = 1200;

function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("x-real-ip") ?? "local";
}

function proseLooksIncomplete(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/[.!?…)"'\]]$/.test(trimmed)) return false;
  const tail = trimmed.toLowerCase().split(/\s+/).slice(-4).join(" ");
  return /(\bof|\bthe|\band|\bor|\bto|\bwith|\bfor|\bfrom|\bexports of)$/.test(
    tail,
  );
}

function appendAssistantProse(messages: UIMessage[], addition: string): UIMessage[] {
  const text = addition.trim();
  if (!text) return messages;
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i--) {
    const message = next[i]!;
    if (message.role !== "assistant") continue;
    const parts = [...message.parts];
    const textIndex = parts.findIndex((p) => p.type === "text");
    if (textIndex === -1) {
      parts.push({ type: "text", text });
    } else {
      const part = parts[textIndex] as { type: "text"; text: string };
      parts[textIndex] = {
        ...part,
        text: `${part.text.trimEnd()}\n\n${text}`,
      };
    }
    next[i] = { ...message, parts };
    return next;
  }

  return [
    ...next,
    {
      id: generateId(),
      role: "assistant",
      parts: [{ type: "text", text }],
    },
  ];
}

async function completeCutOffGmProse(options: {
  sessionId: string;
  povNationId: string;
  messages: UIMessage[];
}): Promise<UIMessage[]> {
  const prose = lastAssistantTextProseFromMessages(options.messages);
  if (!proseLooksIncomplete(prose)) return options.messages;

  const latest = await getGameSession(options.sessionId);
  if (!latest) return options.messages;

  try {
    const continuation = await generateText({
      model: xai.responses(defaultModelId),
      system: buildGmSystemPrompt(latest, options.povNationId),
      maxOutputTokens: GM_CONTINUATION_MAX_OUTPUT_TOKENS,
      prompt: `The last NationForge GM response appears to have been cut off mid-thought.

Continue from exactly where it stopped. Return only the missing continuation needed to finish the current beat cleanly in complete sentences. Do not repeat earlier text. Do not call tools.

Cut-off GM prose:
${prose}`,
    });

    return appendAssistantProse(options.messages, continuation.text);
  } catch {
    return options.messages;
  }
}

export async function POST(req: Request) {
  try {
    requireXaiApiKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Configuration error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const ip = clientIp(req);
  let body: PlayerTurnPayload & { sessionId: string; token?: string };
  try {
    body = (await req.json()) as PlayerTurnPayload & { sessionId: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const stripResult = await mutateSessionExclusive(body.sessionId, (s) => {
    const cleaned = recoverStaleGmRunningPhase(stripOrphanOpeningUserMessage(s));
    return { ok: true, session: cleaned };
  });
  if (!stripResult.ok) {
    return NextResponse.json(
      { error: stripResult.message },
      { status: stripResult.status },
    );
  }

  const session = stripResult.session;

  const v = validatePlayerTurn(session, body);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }

  const token = body.token?.trim();
  if (!token || session.seatTokens[body.povNationId] !== token) {
    return NextResponse.json(
      { error: "A valid seat token is required to send moves for this nation." },
      { status: 403 },
    );
  }

  const rl = rateLimitNationForgeTurn(ip, body.sessionId);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limited", retryAfterMs: rl.retryAfterMs },
      { status: 429 },
    );
  }

  const prepared = await preparePlayerTurnForPersistence(body, session);

  const userMessage: UIMessage = {
    id: generateId(),
    role: "user",
    parts: [
      { type: "text", text: formatPlayerTurnMessage(prepared.publicPayload, session) },
    ],
  };

  const pov = body.povNationId;
  const enqueueResult = await mutateSessionExclusive(body.sessionId, (s) => {
    const v2 = validatePlayerTurn(s, body);
    if (!v2.ok) {
      return { ok: false, status: 400, message: v2.error };
    }
    const tok = body.token?.trim();
    if (!tok || s.seatTokens[body.povNationId] !== tok) {
      return {
        ok: false,
        status: 403,
        message:
          "A valid seat token is required to send moves for this nation.",
      };
    }
    const allMessages: UIMessage[] = [...getNationGmMessages(s, pov), userMessage];
    return {
      ok: true,
      session: {
        ...s,
        secrets: [...s.secrets, ...prepared.secrets],
        gmMessagesByNationId: {
          ...s.gmMessagesByNationId,
          [pov]: allMessages,
        },
        activeNationId: pov,
        phase: "gm_running",
      },
    };
  });

  if (!enqueueResult.ok) {
    return NextResponse.json(
      { error: enqueueResult.message },
      { status: enqueueResult.status },
    );
  }

  const queued = enqueueResult.session;
  const allMessages = getNationGmMessages(queued, pov);

  const tools = createNationForgeTools(body.sessionId);
  const lastResponseId =
    queued.lastGmResponseIdByNationId?.[pov] ?? queued.lastGmResponseId;
  const usePreviousResponse = Boolean(lastResponseId);

  const fullModelMessages = await convertToModelMessages(allMessages, {
    tools,
  });

  const fresh = queued;
  const result = streamText({
    model: xai.responses(defaultModelId),
    system: buildGmSystemPrompt(fresh, pov),
    messages: fullModelMessages,
    tools,
    maxOutputTokens: GM_MAX_OUTPUT_TOKENS,
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
        const msgs = [...getNationGmMessages(s, pov)];
        const last = msgs[msgs.length - 1];
        if (last?.role === "user") {
          msgs.pop();
        }
        await saveGameSession({
          ...s,
          gmMessagesByNationId: { ...s.gmMessagesByNationId, [pov]: msgs },
          phase: s.crisis ? "awaiting_decision" : "player_input",
        });
        return;
      }
      const steps = await result.steps;
      const lastFinishReason = steps.at(-1)?.finishReason;
      const finalMessages =
        lastFinishReason === "length" ||
        proseLooksIncomplete(lastAssistantTextProseFromMessages(messages))
          ? await completeCutOffGmProse({
              sessionId: body.sessionId,
              povNationId: pov,
              messages,
            })
          : messages;
      await replaceNationGmMessages(body.sessionId, pov, finalMessages);
      const newId = steps.at(-1)?.response?.id;
      const s = await getGameSession(body.sessionId);
      if (!s) return;
      await saveGameSession({
        ...s,
        lastGmResponseIdByNationId: {
          ...(s.lastGmResponseIdByNationId ?? {}),
          [pov]: newId,
        },
        phase: s.crisis ? "awaiting_decision" : "player_input",
      });
    },
  });
}
