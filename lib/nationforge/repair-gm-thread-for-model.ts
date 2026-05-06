import type { UIMessage } from "ai";

import type { GameSession } from "./schema";

function isStepStart(p: unknown): boolean {
  return (
    typeof p === "object" &&
    p !== null &&
    (p as { type?: string }).type === "step-start"
  );
}

function isTextPart(p: unknown): p is { type: "text"; text?: string } {
  return (
    typeof p === "object" &&
    p !== null &&
    (p as { type?: string }).type === "text"
  );
}

/**
 * Truncated stream tails (e.g. "**NeoGen Libert" + orphan `step-start`) break
 * `convertToModelMessages` / provider calls. Strip trailing junk from the last
 * assistant row when present.
 */
function trimTrailingBrokenAssistantParts(m: UIMessage): UIMessage | null {
  if (m.role !== "assistant") return m;
  const parts = [...(m.parts ?? [])];
  if (parts.length === 0) return null;

  let changed = false;
  while (parts.length > 0 && isStepStart(parts[parts.length - 1])) {
    parts.pop();
    changed = true;
  }

  const looksLikeTruncatedTailText = (raw: string): boolean => {
    const t = raw.trimEnd();
    if (t.length === 0) return true;
    if (t.length >= 220) return false;
    if (/[.!?…)"'\]]$/.test(t)) return false;
    if (/[#*_]{1,2}[^\s#*_]*$/.test(t)) return true;
    if (t.length < 36 && !/[.!?]$/.test(t)) return true;
    return false;
  };

  while (parts.length > 0) {
    const tail = parts[parts.length - 1]!;
    if (!isTextPart(tail)) break;
    const t = tail.text ?? "";
    if (!looksLikeTruncatedTailText(t)) break;
    parts.pop();
    changed = true;
  }

  if (parts.length === 0) return null;
  if (!changed) return m;
  return { ...m, parts };
}

/**
 * Returns a shallow-copied message list with the last assistant message repaired
 * or removed if it was empty after trimming.
 */
export function repairNationGmThreadMessages(messages: UIMessage[]): UIMessage[] {
  if (messages.length === 0) return messages;
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx]!;
  if (last.role !== "assistant") return messages;

  const fixed = trimTrailingBrokenAssistantParts(last);
  if (fixed === null) {
    return messages.slice(0, -1);
  }
  if (fixed === last) {
    return messages;
  }
  return [...messages.slice(0, -1), fixed];
}

/** Repair every seat thread (e.g. after interrupted GM streams). */
export function repairAllGmThreadsInSession(session: GameSession): GameSession {
  const by = { ...(session.gmMessagesByNationId ?? {}) };
  let changed = false;
  for (const nid of Object.keys(by)) {
    const before = by[nid]!;
    const after = repairNationGmThreadMessages(before);
    if (after !== before) {
      by[nid] = after;
      changed = true;
    }
  }
  return changed ? { ...session, gmMessagesByNationId: by } : session;
}
