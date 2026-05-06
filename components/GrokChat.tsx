"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

function isToolPart(
  part: UIMessage["parts"][number],
): part is UIMessage["parts"][number] & { type: string; toolCallId: string } {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    typeof (part as { type: string }).type === "string" &&
    (part as { type: string }).type.startsWith("tool-")
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        data-chat-role={isUser ? "user" : "assistant"}
        className={`max-w-[min(100%,42rem)] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
            : "border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        }`}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <p key={i} className="whitespace-pre-wrap">
                {part.text}
              </p>
            );
          }
          if (part.type === "reasoning") {
            return (
              <details
                key={i}
                className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-400"
              >
                <summary className="cursor-pointer font-medium">
                  Reasoning
                </summary>
                <pre className="mt-2 whitespace-pre-wrap font-mono">{part.text}</pre>
              </details>
            );
          }
          if (isToolPart(part)) {
            const toolName = part.type.replace(/^tool-/, "");
            return (
              <div
                key={i}
                className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
              >
                <div className="font-mono font-semibold">Tool: {toolName}</div>
                <div className="mt-1 opacity-90">
                  state:{" "}
                  {"state" in part ? String(part.state) : "unknown"}
                </div>
                {"input" in part && part.input != null ? (
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-white/60 p-2 font-mono text-[11px] dark:bg-black/30">
                    {JSON.stringify(part.input, null, 2)}
                  </pre>
                ) : null}
                {"output" in part && part.output != null ? (
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-white/60 p-2 font-mono text-[11px] dark:bg-black/30">
                    {JSON.stringify(part.output, null, 2)}
                  </pre>
                ) : null}
                {"errorText" in part && part.errorText ? (
                  <p className="mt-1 text-red-600 dark:text-red-400">
                    {String(part.errorText)}
                  </p>
                ) : null}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function ChatSession({
  conversationId,
  initialMessages,
  onListRefresh,
}: {
  conversationId: string;
  initialMessages: UIMessage[];
  onListRefresh: () => Promise<void>;
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
      }),
    [],
  );

  const { messages, sendMessage, status, stop, error, clearError } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    onFinish: () => {
      void onListRefresh();
    },
  });

  const [draft, setDraft] = useState("");
  const busy = status === "streaming" || status === "submitted";

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if (!text || busy) return;
      setDraft("");
      await sendMessage({ text });
    },
    [draft, busy, sendMessage],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-zinc-500">
            Say hello to Grok. Tools: current time, add two numbers.
          </p>
        ) : (
          messages.map((m, i) => (
            <MessageBubble
              key={`${i}-${m.id?.trim() ? m.id : "noid"}-${m.role}`}
              message={m}
            />
          ))
        )}
      </div>

      {error ? (
        <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          <span>{error.message}</span>
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => clearError()}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="border-t border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="mx-auto flex max-w-3xl gap-2">
          <textarea
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            placeholder="Message Grok…"
            rows={2}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSubmit(e);
              }
            }}
          />
          {busy ? (
            <button
              type="button"
              className="shrink-0 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => void stop()}
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              disabled={!draft.trim()}
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export function GrokChat() {
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const refreshList = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (!res.ok) return;
    const data = (await res.json()) as { conversations: ConversationSummary[] };
    setList(data.conversations);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const switchingAway = id !== activeIdRef.current;
    if (switchingAway) {
      setHydrated(false);
    }
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) {
      if (switchingAway) {
        setHydrated(true);
      }
      return;
    }
    const data = (await res.json()) as { messages: UIMessage[] };
    setInitialMessages(data.messages ?? []);
    setActiveId(id);
    setHydrated(true);
  }, []);

  const newChat = useCallback(async () => {
    const res = await fetch("/api/conversations", { method: "POST" });
    if (!res.ok) return;
    const data = (await res.json()) as { id: string };
    await refreshList();
    await loadConversation(data.id);
  }, [loadConversation, refreshList]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/conversations");
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as {
        conversations: ConversationSummary[];
      };
      if (cancelled) return;
      setList(data.conversations);
      if (data.conversations.length > 0) {
        await loadConversation(data.conversations[0].id);
      } else {
        const created = await fetch("/api/conversations", { method: "POST" });
        if (!created.ok || cancelled) return;
        const row = (await created.json()) as { id: string };
        setList([{ id: row.id, title: "New chat", updatedAt: new Date().toISOString() }]);
        await loadConversation(row.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadConversation]);

  return (
    <div className="aetheria-chat flex min-h-0 flex-1">
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-100/80 dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => void newChat()}
            className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            New chat
          </button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          <ul className="space-y-1">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (c.id === activeId && hydrated) return;
                    void loadConversation(c.id);
                  }}
                  className={`w-full rounded-lg px-2 py-2 text-left text-sm ${
                    c.id === activeId
                      ? "bg-white font-medium shadow-sm dark:bg-zinc-800"
                      : "text-zinc-700 hover:bg-white/70 dark:text-zinc-300 dark:hover:bg-zinc-800/70"
                  }`}
                >
                  <span className="line-clamp-2">{c.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {activeId && hydrated ? (
          <ChatSession
            key={activeId}
            conversationId={activeId}
            initialMessages={initialMessages}
            onListRefresh={refreshList}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            Loading…
          </div>
        )}
      </section>
    </div>
  );
}
