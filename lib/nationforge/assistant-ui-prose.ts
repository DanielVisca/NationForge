import type { UIMessage } from "ai";

function partType(p: unknown): string | undefined {
  if (!p || typeof p !== "object") return undefined;
  return (p as { type?: string }).type;
}

/**
 * Player-visible chronicle copy only — excludes `reasoning` parts (chain-of-thought).
 */
export function textProseFromAssistantUiMessage(m: UIMessage): string {
  if (m.role !== "assistant") return "";
  const chunks: string[] = [];
  for (const p of m.parts ?? []) {
    if (partType(p) !== "text") continue;
    const text = (p as { text?: string }).text;
    if (typeof text === "string" && text.length > 0) chunks.push(text);
  }
  return chunks.join("");
}

export function lastAssistantTextProseFromMessages(
  messages: UIMessage[],
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = textProseFromAssistantUiMessage(messages[i]!);
    if (t.trim()) return t;
  }
  return "";
}

const COMPLETED_TOOL_STATES = new Set(["output-available", "output-error"]);

function toolPartIndicatesCompletedGmBeat(p: unknown): boolean {
  const t = partType(p);
  if (typeof t !== "string" || !t.startsWith("tool-")) return false;
  const state = (p as { state?: string }).state;
  if (!state || !COMPLETED_TOOL_STATES.has(state)) return false;
  return (
    t === "tool-append_turn_log" ||
    t === "tool-apply_stat_deltas" ||
    t === "tool-no_stat_change_this_turn" ||
    t === "tool-declare_emergent_event"
  );
}

/**
 * True when this assistant row has chronicle text or finished GM tools
 * (reasoning-only transcripts still unblock intro/orphan logic).
 */
export function assistantMessageIndicatesGmDelivery(m: UIMessage): boolean {
  if (m.role !== "assistant") return false;
  if (textProseFromAssistantUiMessage(m).trim()) return true;
  for (const p of m.parts ?? []) {
    if (toolPartIndicatesCompletedGmBeat(p)) return true;
  }
  return false;
}

export function gmThreadHasAssistantDelivery(
  messages: UIMessage[] | undefined,
): boolean {
  if (!messages?.length) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (assistantMessageIndicatesGmDelivery(messages[i]!)) return true;
  }
  return false;
}
