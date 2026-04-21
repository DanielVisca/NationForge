import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";

import { chatTools } from "@/lib/chat-tools";
import { getConversation, saveConversationPatch } from "@/lib/conversation-store";
import { defaultModelId, requireXaiApiKey, xai } from "@/lib/xai";

export const maxDuration = 300;

function sliceFromLastUser(messages: ModelMessage[]): ModelMessage[] {
  let i = messages.length - 1;
  while (i >= 0 && messages[i].role !== "user") {
    i -= 1;
  }
  if (i < 0) {
    return messages;
  }
  return messages.slice(i);
}

type ChatRequestBody = {
  id?: string;
  messages?: UIMessage[];
  trigger?: string;
};

export async function POST(req: Request) {
  try {
    requireXaiApiKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Configuration error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const conversationId = body.id;
  const uiMessages = body.messages ?? [];
  const trigger = body.trigger ?? "submit-message";

  if (!conversationId) {
    return NextResponse.json({ error: "Missing conversation id" }, { status: 400 });
  }

  const conv = await getConversation(conversationId);
  if (!conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const lastResponseId = conv.lastResponseId;
  const usePreviousResponse =
    Boolean(lastResponseId) && trigger === "submit-message";

  const fullModelMessages = await convertToModelMessages(uiMessages, {
    tools: chatTools,
  });

  const result = streamText({
    model: xai.responses(defaultModelId),
    system:
      "You are Grok in the Aetheria app. Be helpful and concise. Call tools when they give a better or exact answer.",
    messages: fullModelMessages,
    tools: chatTools,
    stopWhen: stepCountIs(12),
    timeout: 360_000,
    prepareStep: ({ stepNumber, steps }) => {
      if (stepNumber === 0 && usePreviousResponse) {
        return {
          messages: sliceFromLastUser(fullModelMessages),
          providerOptions: {
            xai: { previousResponseId: lastResponseId },
          },
        };
      }
      if (stepNumber > 0) {
        const prev = steps[stepNumber - 1];
        const rid = prev?.response?.id;
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
    originalMessages: uiMessages,
    onFinish: async ({ messages }) => {
      const steps = await result.steps;
      const lastStep = steps.at(-1);
      const newResponseId = lastStep?.response?.id;

      await saveConversationPatch(conversationId, {
        messages,
        lastResponseId: newResponseId,
      });
    },
  });
}
