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
import {
  repairAllGmThreadsInSession,
  repairNationGmThreadMessages,
} from "@/lib/nationforge/repair-gm-thread-for-model";
import { sliceFromLastUser } from "@/lib/nationforge/slice-messages";
import { getNationGmMessages } from "@/lib/nationforge/gm-threads";
import type { GameSession } from "@/lib/nationforge/schema";
import {
  getGameSession,
  mutateSessionExclusive,
  replaceNationGmMessages,
  saveGameSession,
} from "@/lib/nationforge/store";
import { defaultModelId, requireXaiApiKey, xai } from "@/lib/xai";

export const maxDuration = 300;

/** Remove pov from in-flight GM list; phase gm_running only while any seat still streams. */
function nationFinishesGmStream(session: GameSession, povId: string): GameSession {
  const ids = (session.gmStreamingNationIds ?? []).filter((id) => id !== povId);
  return {
    ...session,
    gmStreamingNationIds: ids,
    phase:
      ids.length > 0
        ? "gm_running"
        : session.crisis
          ? "awaiting_decision"
          : "player_input",
  };
}

/** Pop trailing queued user turn for `pov` and clear streaming slot (e.g. stream never started / onFinish threw). */
async function rollbackOngoingGmTurn(
  sessionId: string,
  povNationId: string,
  reason: string,
): Promise<void> {
  try {
    await mutateSessionExclusive(sessionId, (s) => {
      const msgs = [...getNationGmMessages(s, povNationId)];
      const last = msgs[msgs.length - 1];
      if (last?.role === "user") {
        msgs.pop();
      }
      const patched: GameSession = {
        ...s,
        gmMessagesByNationId: {
          ...s.gmMessagesByNationId,
          [povNationId]: msgs,
        },
      };
      return { ok: true, session: nationFinishesGmStream(patched, povNationId) };
    });
  } catch (e) {
    console.error(`[nationforge/turn] rollback after ${reason} failed`, e);
  }
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Primary GM stream; default high so we do not clip below provider limits (override via env). */
const GM_MAX_OUTPUT_TOKENS = intEnv(
  "NATIONFORGE_GM_MAX_OUTPUT_TOKENS",
  65536,
  4096,
  131072,
);
const GM_CONTINUATION_MAX_OUTPUT_TOKENS = intEnv(
  "NATIONFORGE_GM_CONTINUATION_MAX_OUTPUT_TOKENS",
  32768,
  1024,
  131072,
);
const GM_CONTINUATION_MAX_ROUNDS = intEnv(
  "NATIONFORGE_GM_CONTINUATION_MAX_ROUNDS",
  8,
  1,
  24,
);

function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("x-real-ip") ?? "local";
}

function hasUnclosedMarkdownBoldTail(text: string): boolean {
  const lines = text.trimEnd().split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  if (!lastLine.includes("**")) return false;
  return ((lastLine.match(/\*\*/g) ?? []).length % 2 === 1);
}

function proseLooksIncomplete(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (hasUnclosedMarkdownBoldTail(trimmed)) return true;
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

async function completeCutOffGmProseOnce(options: {
  sessionId: string;
  povNationId: string;
  messages: UIMessage[];
}): Promise<UIMessage[]> {
  const prose = lastAssistantTextProseFromMessages(options.messages);
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

/** Repeated continuation passes after token limit or incomplete tail. */
async function completeCutOffGmProseLoop(options: {
  sessionId: string;
  povNationId: string;
  messages: UIMessage[];
  lastFinishReason: string | undefined;
}): Promise<UIMessage[]> {
  let msgs = options.messages;
  for (let r = 0; r < GM_CONTINUATION_MAX_ROUNDS; r++) {
    const prose = lastAssistantTextProseFromMessages(msgs);
    const shouldRun =
      r === 0
        ? options.lastFinishReason === "length" || proseLooksIncomplete(prose)
        : proseLooksIncomplete(prose);
    if (!shouldRun) break;
    const prevLen = prose.length;
    const next = await completeCutOffGmProseOnce({
      sessionId: options.sessionId,
      povNationId: options.povNationId,
      messages: msgs,
    });
    const nextProse = lastAssistantTextProseFromMessages(next);
    if (nextProse.length <= prevLen) break;
    msgs = next;
  }
  return msgs;
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
    const cleaned = repairAllGmThreadsInSession(
      recoverStaleGmRunningPhase(stripOrphanOpeningUserMessage(s)),
    );
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
    const history = repairNationGmThreadMessages([
      ...getNationGmMessages(s, pov),
    ]);
    const allMessages: UIMessage[] = [...history, userMessage];
    const streamIds = [...(s.gmStreamingNationIds ?? [])];
    if (!streamIds.includes(pov)) {
      streamIds.push(pov);
    }
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
        gmStreamingNationIds: streamIds,
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

  const tools = createNationForgeTools(body.sessionId, pov);
  const lastResponseId =
    queued.lastGmResponseIdByNationId?.[pov] ?? queued.lastGmResponseId;
  /** Do not chain `previous_response_id` until this thread has a prior assistant turn — xAI rejects mismatched chains (400) and it breaks first opening beats. */
  const hasAssistantInThread = allMessages.some((m) => m.role === "assistant");
  const usePreviousResponse = Boolean(lastResponseId) && hasAssistantInThread;

  try {
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
      stopWhen: stepCountIs(40),
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
        try {
          if (isAborted) {
            const s = await getGameSession(body.sessionId);
            if (!s) return;
            const msgs = [...getNationGmMessages(s, pov)];
            const last = msgs[msgs.length - 1];
            if (last?.role === "user") {
              msgs.pop();
            }
            const patched = {
              ...s,
              gmMessagesByNationId: { ...s.gmMessagesByNationId, [pov]: msgs },
            };
            await saveGameSession(nationFinishesGmStream(patched, pov));
            return;
          }
          const steps = await result.steps;
          const lastFinishReason = steps.at(-1)?.finishReason;
          const finalMessages =
            lastFinishReason === "length" ||
            proseLooksIncomplete(lastAssistantTextProseFromMessages(messages))
              ? await completeCutOffGmProseLoop({
                  sessionId: body.sessionId,
                  povNationId: pov,
                  messages,
                  lastFinishReason,
                })
              : messages;
          await replaceNationGmMessages(body.sessionId, pov, finalMessages);
          const newId = steps.at(-1)?.response?.id;
          const s = await getGameSession(body.sessionId);
          if (!s) return;
          await saveGameSession(
            nationFinishesGmStream(
              {
                ...s,
                lastGmResponseIdByNationId: {
                  ...(s.lastGmResponseIdByNationId ?? {}),
                  [pov]: newId,
                },
              },
              pov,
            ),
          );
        } catch (e) {
          console.error("[nationforge/turn] onFinish error", e);
          await rollbackOngoingGmTurn(body.sessionId, pov, "onFinish");
        }
      },
    });
  } catch (e) {
    console.error("[nationforge/turn] stream setup failed", e);
    await rollbackOngoingGmTurn(body.sessionId, pov, "stream-setup");
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "GM stream failed to start — try again in a moment.",
      },
      { status: 502 },
    );
  }
}
