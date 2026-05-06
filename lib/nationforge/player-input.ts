import type { UIMessage } from "ai";

import { gmThreadHasAssistantDelivery } from "./assistant-ui-prose";
import { getNationGmMessages, withNationGmMessages } from "./gm-threads";
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
  if (!session.crisis) return session;
  const streaming = session.gmStreamingNationIds ?? [];
  let next = session;
  let changed = false;
  for (const n of session.nations) {
    if (streaming.includes(n.id)) continue;
    if (sessionHasGmStoryForNation(next, n.id)) continue;
    const msgs = getNationGmMessages(next, n.id);
    if (msgs.length === 0) continue;
    const last = msgs[msgs.length - 1]!;
    if (last.role !== "user") continue;
    const t = textFromUserMessage(last);
    if (!t.includes(OPENING_ORIENTATION_MARKER)) continue;
    next = withNationGmMessages(next, n.id, msgs.slice(0, -1));
    changed = true;
  }
  return changed ? next : session;
}

const STALE_GM_RUNNING_MS = 3 * 60 * 1000;

/** If GM streams never finished (no onFinish), roll back queued user rows and clear streaming ids. */
export function recoverStaleGmRunningPhase(session: GameSession): GameSession {
  const streaming = session.gmStreamingNationIds ?? [];
  if (streaming.length === 0) {
    if (session.phase !== "gm_running") return session;
    const ageLegacy = Date.now() - Date.parse(session.updatedAt);
    if (ageLegacy < STALE_GM_RUNNING_MS) return session;
    const nid = session.activeNationId?.trim();
    if (!nid) {
      return {
        ...session,
        phase: session.crisis ? "awaiting_decision" : "player_input",
        gmStreamingNationIds: [],
      };
    }
    const msgs = [...getNationGmMessages(session, nid)];
    const last = msgs[msgs.length - 1];
    if (last?.role === "user") {
      msgs.pop();
    }
    return {
      ...withNationGmMessages(session, nid, msgs),
      phase: session.crisis ? "awaiting_decision" : "player_input",
      gmStreamingNationIds: [],
    };
  }

  const age = Date.now() - Date.parse(session.updatedAt);
  if (age < STALE_GM_RUNNING_MS) return session;

  let next: GameSession = session;
  for (const nid of streaming) {
    const msgs = [...getNationGmMessages(next, nid)];
    const last = msgs[msgs.length - 1];
    if (last?.role === "user") {
      msgs.pop();
    }
    next = withNationGmMessages(next, nid, msgs);
  }
  return {
    ...next,
    gmStreamingNationIds: [],
    phase: next.crisis ? "awaiting_decision" : "player_input",
  };
}

/** True once this seat’s thread has GM-visible prose or a completed GM tool call. */
export function sessionHasGmStoryForNation(
  session: GameSession,
  nationId: string,
): boolean {
  return gmThreadHasAssistantDelivery(getNationGmMessages(session, nationId));
}

/** True if any forged seat has landed GM story (legacy / global checks). */
export function sessionHasGmStory(session: GameSession): boolean {
  return session.nations.some(
    (n) => n.forgeComplete && sessionHasGmStoryForNation(session, n.id),
  );
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

  const streaming = session.gmStreamingNationIds ?? [];
  if (streaming.includes(p.povNationId)) {
    return {
      ok: false,
      error:
        "The GM is still writing this seat's last turn (streaming). Wait until it finishes — the page will update automatically.",
    };
  }

  if (session.phase === "awaiting_decision" && session.crisis) {
    if (p.orientationRequest) {
      if (sessionHasGmStoryForNation(session, p.povNationId)) {
        return {
          ok: false,
          error:
            "The opening beat already ran — send your move in the chat field (and optional crisis fields if your client sends them).",
        };
      }
      if (getNationGmMessages(session, p.povNationId).some((m) => m.role === "user")) {
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
  const involved = session?.crisis?.activeNationIds ?? [];
  const crisisWireForThisPov =
    involved.length === 0 || involved.includes(p.povNationId);
  if (
    session?.phase === "awaiting_decision" &&
    session.crisis &&
    !p.orientationRequest &&
    !hasExplicitCrisis &&
    crisisWireForThisPov
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
    lines.push("", `Future stat / reserve reallocation ask: ${p.reallocNotes.trim()}`);
  }
  return lines.join("\n");
}

/**
 * Text to show in the **You** chat bubble: player narrative only. The wire
 * format from {@link formatPlayerTurnMessage} also appends GM-only lines
 * (crisis id/prompt, diplomacy, etc.) — those stay in the seat’s GM thread for the model
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
    "\n\nFuture stat / reserve reallocation ask:",
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
