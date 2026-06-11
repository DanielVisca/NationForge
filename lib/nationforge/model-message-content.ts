import type { ModelMessage } from "ai";

/**
 * xAI Responses API rejects requests where any `input` message has no serializable
 * content ("Each message must have at least one content element."). That can happen
 * when `sliceFromLastUser` includes an assistant row that only had reasoning stripped
 * for the GM UI, or otherwise converted to empty parts.
 */
function partCountsAsXaiInputContent(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const p = part as {
    type?: string;
    text?: string;
    toolCallId?: string;
  };
  switch (p.type) {
    case "text":
      return typeof p.text === "string" && p.text.trim().length > 0;
    case "image":
    case "file":
      return true;
    case "tool-call":
      return typeof p.toolCallId === "string" && p.toolCallId.length > 0;
    case "tool-result":
      return typeof p.toolCallId === "string" && p.toolCallId.length > 0;
    case "reasoning":
      return false;
    default:
      return true;
  }
}

export function modelMessageHasXaiInputContent(m: ModelMessage): boolean {
  if (m.role === "user" || m.role === "assistant") {
    const c = m.content;
    if (typeof c === "string") return c.trim().length > 0;
    if (Array.isArray(c)) return c.some(partCountsAsXaiInputContent);
    return false;
  }
  if (m.role === "tool") {
    return Array.isArray(m.content) && m.content.length > 0;
  }
  if (m.role === "system") {
    const c = (m as { content?: unknown }).content;
    if (typeof c === "string") return c.trim().length > 0;
    if (Array.isArray(c)) return c.some(partCountsAsXaiInputContent);
    return false;
  }
  return false;
}

/** Drops model rows that would serialize with no `input` content for xAI. */
export function filterModelMessagesWithXaiInputContent(
  messages: ModelMessage[],
): ModelMessage[] {
  return messages.filter(modelMessageHasXaiInputContent);
}
