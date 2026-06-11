import { getErrorMessage } from "@ai-sdk/provider-utils";
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";

import { agentDebugLog } from "@/lib/debug-agent-log";
import { chatTools } from "@/lib/chat-tools";
import { getConversation, saveConversationPatch } from "@/lib/conversation-store";
import { filterModelMessagesWithXaiInputContent } from "@/lib/nationforge/model-message-content";
import { sliceFromLastUser } from "@/lib/nationforge/slice-messages";
import { defaultModelId, requireXaiApiKey, xai } from "@/lib/xai";

export const maxDuration = 300;

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

  // #region agent log
  void agentDebugLog({
    hypothesisId: "H3-H5",
    location: "app/api/chat/route.ts:POST",
    message: "chat_post_start",
    data: {
      conversationId,
      uiMessageCount: uiMessages.length,
      trigger,
      usePreviousResponse,
    },
  });
  void fetch(
    "http://127.0.0.1:7711/ingest/ae23ea3c-0d7c-4b48-8c6c-33596b38e250",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "1416db",
      },
      body: JSON.stringify({
        sessionId: "1416db",
        hypothesisId: "H3-H5",
        location: "app/api/chat/route.ts:POST",
        message: "chat_post_start",
        data: {
          conversationId,
          uiMessageCount: uiMessages.length,
          trigger,
          usePreviousResponse,
        },
        timestamp: Date.now(),
      }),
    },
  ).catch(() => {});
  // #endregion

  let fullModelMessages: ModelMessage[];
  try {
    fullModelMessages = await convertToModelMessages(uiMessages, {
      tools: chatTools,
    });
  } catch (convErr) {
    void agentDebugLog({
      hypothesisId: "H3",
      location: "app/api/chat/route.ts:POST",
      message: "convertToModelMessages_failed",
      data: {
        err: convErr instanceof Error ? convErr.message : String(convErr),
        uiMessageCount: uiMessages.length,
      },
    });
    // #region agent log
    void fetch(
      "http://127.0.0.1:7711/ingest/ae23ea3c-0d7c-4b48-8c6c-33596b38e250",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "1416db",
        },
        body: JSON.stringify({
          sessionId: "1416db",
          hypothesisId: "H3",
          location: "app/api/chat/route.ts:POST",
          message: "convertToModelMessages_failed",
          data: {
            err:
              convErr instanceof Error ? convErr.message : String(convErr),
            uiMessageCount: uiMessages.length,
          },
          timestamp: Date.now(),
        }),
      },
    ).catch(() => {});
    // #endregion
    return NextResponse.json(
      {
        error:
          convErr instanceof Error
            ? convErr.message
            : "Failed to prepare messages for the model.",
      },
      { status: 400 },
    );
  }

  let streamErrorSeen = false;

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
        const sliced = sliceFromLastUser(fullModelMessages);
        const cleaned = filterModelMessagesWithXaiInputContent(sliced);
        const chainOk =
          cleaned.length > 0 && cleaned[cleaned.length - 1]?.role === "user";
        if (!chainOk) {
          void agentDebugLog({
            hypothesisId: "NF-xAI",
            location: "app/api/chat/route.ts:prepareStep",
            message: "previous_response_chain_skipped_empty_slice",
            data: {
              conversationId,
              slicedLen: sliced.length,
              cleanedLen: cleaned.length,
              lastRole: cleaned.at(-1)?.role ?? null,
            },
          });
          return { messages: fullModelMessages };
        }
        if (cleaned.length !== sliced.length) {
          void agentDebugLog({
            hypothesisId: "NF-xAI",
            location: "app/api/chat/route.ts:prepareStep",
            message: "previous_response_slice_filtered_empty_rows",
            data: {
              conversationId,
              slicedLen: sliced.length,
              cleanedLen: cleaned.length,
            },
          });
        }
        return {
          messages: cleaned,
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
    onError: (err) => {
      streamErrorSeen = true;
      const text = getErrorMessage(err);
      void agentDebugLog({
        hypothesisId: "H5",
        location: "app/api/chat/route.ts:toUIMessageStreamResponse",
        message: "ui_message_stream_error",
        data: { conversationId, text },
      });
      void fetch(
        "http://127.0.0.1:7711/ingest/ae23ea3c-0d7c-4b48-8c6c-33596b38e250",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "1416db",
          },
          body: JSON.stringify({
            sessionId: "1416db",
            hypothesisId: "H5",
            location: "app/api/chat/route.ts:toUIMessageStreamResponse",
            message: "ui_message_stream_error",
            data: { conversationId, text },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
      return text;
    },
    onFinish: async ({ messages, finishReason }) => {
      const steps = await result.steps;
      const lastStep = steps.at(-1);
      const newResponseId = lastStep?.response?.id;

      const streamFailed =
        finishReason === "error" || streamErrorSeen;
      const messagesToSave = streamFailed ? uiMessages : messages;
      const lastResponseIdToSave = streamFailed ? undefined : newResponseId;

      if (streamFailed) {
        void agentDebugLog({
          hypothesisId: "H5",
          location: "app/api/chat/route.ts:onFinish",
          message: "persist_ui_messages_after_stream_error",
          data: {
            conversationId,
            finishReason: finishReason ?? null,
            streamErrorSeen,
            savedCount: messagesToSave.length,
          },
        });
        void fetch(
          "http://127.0.0.1:7711/ingest/ae23ea3c-0d7c-4b48-8c6c-33596b38e250",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-Session-Id": "1416db",
            },
            body: JSON.stringify({
              sessionId: "1416db",
              hypothesisId: "H5",
              location: "app/api/chat/route.ts:onFinish",
              message: "persist_ui_messages_after_stream_error",
              data: {
                conversationId,
                finishReason: finishReason ?? null,
                streamErrorSeen,
                savedCount: messagesToSave.length,
              },
              timestamp: Date.now(),
            }),
          },
        ).catch(() => {});
      }

      try {
        await saveConversationPatch(conversationId, {
          messages: messagesToSave,
          lastResponseId: lastResponseIdToSave,
        });
        void agentDebugLog({
          hypothesisId: "H4",
          location: "app/api/chat/route.ts:onFinish",
          message: "save_conversation_ok",
          data: {
            conversationId,
            savedCount: messagesToSave.length,
            hasNewResponseId: Boolean(lastResponseIdToSave),
            streamFailed,
          },
        });
        // #region agent log
        void fetch(
          "http://127.0.0.1:7711/ingest/ae23ea3c-0d7c-4b48-8c6c-33596b38e250",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-Session-Id": "1416db",
            },
            body: JSON.stringify({
              sessionId: "1416db",
              hypothesisId: "H4",
              location: "app/api/chat/route.ts:onFinish",
              message: "save_conversation_ok",
              data: {
                conversationId,
                savedCount: messagesToSave.length,
                hasNewResponseId: Boolean(lastResponseIdToSave),
                streamFailed,
              },
              timestamp: Date.now(),
            }),
          },
        ).catch(() => {});
        // #endregion
      } catch (saveErr) {
        void agentDebugLog({
          hypothesisId: "H4",
          location: "app/api/chat/route.ts:onFinish",
          message: "save_conversation_failed",
          data: {
            conversationId,
            err:
              saveErr instanceof Error ? saveErr.message : String(saveErr),
          },
        });
        // #region agent log
        void fetch(
          "http://127.0.0.1:7711/ingest/ae23ea3c-0d7c-4b48-8c6c-33596b38e250",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-Session-Id": "1416db",
            },
            body: JSON.stringify({
              sessionId: "1416db",
              hypothesisId: "H4",
              location: "app/api/chat/route.ts:onFinish",
              message: "save_conversation_failed",
              data: {
                conversationId,
                err:
                  saveErr instanceof Error
                    ? saveErr.message
                    : String(saveErr),
              },
              timestamp: Date.now(),
            }),
          },
        ).catch(() => {});
        // #endregion
        throw saveErr;
      }
    },
  });
}
