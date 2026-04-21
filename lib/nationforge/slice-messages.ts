import type { ModelMessage } from "ai";

/** For xAI previous_response_id: only send from last user message onward. */
export function sliceFromLastUser(messages: ModelMessage[]): ModelMessage[] {
  let i = messages.length - 1;
  while (i >= 0 && messages[i].role !== "user") {
    i -= 1;
  }
  if (i < 0) {
    return messages;
  }
  return messages.slice(i);
}
