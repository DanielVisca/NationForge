import type { UIMessage } from "ai";

import { gmThreadHasAssistantDelivery } from "./assistant-ui-prose";
import type { GameSession } from "./schema";

export type PlayerTurnPayload = {
  povNationId: string;
  narrative: string;
  /** First table beat only: ask GM for nation orientation; skips crisis pick until a GM reply exists. */
  orientationRequest?: boolean;
  crisisChoiceId?: string;
  customCrisisResponse?: string;
  publicDiplomacy?: string;
  secretAction?: string;
  reallocNotes?: string;
};

function textFromUserMessage(m: UIMessage): string {
  if (m.role !== "user") return "";
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

const OPENING_ORIENTATION_MARKER =
  "(orientationRequest: first opening beat — crisis choice deferred)";

/**
 * If the last GM-thread message is an opening-brief user turn but no assistant
 * prose ever landed, drop it so the client can resend (e.g. stream died).
 */
export function stripOrphanOpeningUserMessage(session: GameSession): GameSession {
  if (session.phase !== "awaiting_decision" || !session.crisis) return session;
  if (sessionHasGmStory(session)) return session;
  const msgs = session.gmMessages;
  if (msgs.length === 0) return session;
  const last = msgs[msgs.length - 1]!;
  if (last.role !== "user") return session;
  const t = textFromUserMessage(last);
  if (!t.includes(OPENING_ORIENTATION_MARKER)) return session;
  return { ...session, gmMessages: msgs.slice(0, -1) };
}

const STALE_GM_RUNNING_MS = 3 * 60 * 1000;

/** If gm_running never finished (no onFinish), roll back so the table can retry. */
export function recoverStaleGmRunningPhase(session: GameSession): GameSession {
  if (session.phase !== "gm_running") return session;
  const age = Date.now() - Date.parse(session.updatedAt);
  if (age < STALE_GM_RUNNING_MS) return session;
  const msgs = [...session.gmMessages];
  const last = msgs[msgs.length - 1];
  if (last?.role === "user") {
    msgs.pop();
  }
  return {
    ...session,
    gmMessages: msgs,
    phase: session.crisis ? "awaiting_decision" : "player_input",
  };
}

/** True once any assistant message has GM-visible prose or a completed GM tool call. */
export function sessionHasGmStory(session: GameSession): boolean {
  return gmThreadHasAssistantDelivery(session.gmMessages);
}

export function validatePlayerTurn(
  session: GameSession,
  p: PlayerTurnPayload,
): { ok: true } | { ok: false; error: string } {
  if (!p.narrative?.trim()) {
    return { ok: false, error: "Narrative is required (describe your move)." };
  }

  if (!session.gameStarted) {
    return {
      ok: false,
      error:
        session.nations.length === 0
          ? "No forged nations in this room yet."
          : "Every nation still in the builder must finish the 100-point forge before the GM opens the table.",
    };
  }

  if (!session.nations.some((n) => n.id === p.povNationId)) {
    return { ok: false, error: "Unknown povNationId" };
  }

  const povNation = session.nations.find((n) => n.id === p.povNationId);
  if (povNation && !povNation.forgeComplete) {
    return {
      ok: false,
      error:
        "Finish your nation builder (one section at a time) before taking turns.",
    };
  }

  if (session.phase === "gm_running") {
    return {
      ok: false,
      error:
        "The GM is still writing this beat (streaming). Wait until it finishes — the page will update automatically.",
    };
  }

  if (session.phase === "awaiting_decision" && session.crisis) {
    if (p.orientationRequest) {
      if (sessionHasGmStory(session)) {
        return {
          ok: false,
          error:
            "The opening beat already ran — send your move in the chat field (and optional crisis fields if your client sends them).",
        };
      }
      if (session.gmMessages.some((m) => m.role === "user")) {
        return {
          ok: false,
          error:
            "A turn is already queued and the GM is working on it. Give it a few seconds — if nothing moves, refresh. (You do not need to send the opening twice.)",
        };
      }
    } else {
      /** Prose-only crisis answers: narrative alone is enough (optional explicit pick below). */
      if (p.crisisChoiceId) {
        const ok = session.crisis.options.some((o) => o.id === p.crisisChoiceId);
        if (!ok) {
          return { ok: false, error: "crisisChoiceId does not match any option." };
        }
      }
      if (p.crisisChoiceId && p.customCrisisResponse?.trim()) {
        return {
          ok: false,
          error: "Choose either a crisis option or a custom response, not both.",
        };
      }
    }
  }

  return { ok: true };
}

const CRISIS_CONTEXT_CLIP = 400;

export function formatPlayerTurnMessage(
  p: PlayerTurnPayload,
  session?: Pick<GameSession, "phase" | "crisis"> | null,
): string {
  const lines: string[] = [`POV: ${p.povNationId}`, "", p.narrative.trim()];
  if (p.orientationRequest) {
    lines.push("", "(orientationRequest: first opening beat — crisis choice deferred)");
  }
  if (p.crisisChoiceId) {
    lines.push("", `Crisis choice: ${p.crisisChoiceId}`);
  }
  if (p.customCrisisResponse?.trim()) {
    lines.push("", `Custom crisis response: ${p.customCrisisResponse.trim()}`);
  }
  const hasExplicitCrisis =
    Boolean(p.crisisChoiceId?.trim()) || Boolean(p.customCrisisResponse?.trim());
  if (
    session?.phase === "awaiting_decision" &&
    session.crisis &&
    !p.orientationRequest &&
    !hasExplicitCrisis
  ) {
    const c = session.crisis;
    const prompt = c.prompt.trim();
    const promptClip =
      prompt.length > CRISIS_CONTEXT_CLIP
        ? `${prompt.slice(0, CRISIS_CONTEXT_CLIP)}…`
        : prompt;
    lines.push(
      "",
      `Active crisis (player answered in prose above): crisisId=${c.id}`,
      `Crisis prompt (context for GM): ${promptClip}`,
    );
  }
  if (p.publicDiplomacy?.trim()) {
    lines.push("", `Public diplomacy: ${p.publicDiplomacy.trim()}`);
  }
  if (p.secretAction?.trim()) {
    lines.push("", `Secret action: ${p.secretAction.trim()}`);
  }
  if (p.reallocNotes?.trim()) {
    lines.push("", `Re-allocation notes: ${p.reallocNotes.trim()}`);
  }
  return lines.join("\n");
}

/**
 * Text to show in the **You** chat bubble: player narrative only. The wire
 * format from {@link formatPlayerTurnMessage} also appends GM-only lines
 * (crisis id/prompt, diplomacy, etc.) — those stay in `gmMessages` for the model
 * but must not be shown as if the player typed them.
 */
export function playerTurnChatDisplayBody(formattedTurnText: string): string {
  let t = formattedTurnText.trim().replace(/^POV:\s*[^\n]+\n\n/, "").trim();
  const appendStarts = [
    `\n\n${OPENING_ORIENTATION_MARKER}`,
    "\n\nCrisis choice:",
    "\n\nCustom crisis response:",
    "\n\nActive crisis (player answered in prose above):",
    "\n\nPublic diplomacy:",
    "\n\nSecret action:",
    "\n\nRe-allocation notes:",
  ];
  let cut = Infinity;
  for (const prefix of appendStarts) {
    const i = t.indexOf(prefix);
    if (i !== -1 && i < cut) cut = i;
  }
  if (cut < Infinity) t = t.slice(0, cut).trim();
  return t || formattedTurnText.trim();
}
