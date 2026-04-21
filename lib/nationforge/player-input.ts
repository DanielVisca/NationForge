import type { GameSession } from "./schema";

export type PlayerTurnPayload = {
  povNationId: string;
  narrative: string;
  crisisChoiceId?: string;
  customCrisisResponse?: string;
  publicDiplomacy?: string;
  secretAction?: string;
  reallocNotes?: string;
};

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
          ? "No one has claimed a seat in this room yet."
          : "Every nation still in the builder must finish the 100-point forge before the GM opens the chronicle.",
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
    return { ok: false, error: "GM is still resolving; wait for the stream to finish." };
  }

  if (session.phase === "awaiting_decision" && session.crisis) {
    if (!p.crisisChoiceId && !p.customCrisisResponse?.trim()) {
      return {
        ok: false,
        error: "Choose a crisis option id or provide a custom response (Something else).",
      };
    }
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

  return { ok: true };
}

export function formatPlayerTurnMessage(p: PlayerTurnPayload): string {
  const lines: string[] = [`POV: ${p.povNationId}`, "", p.narrative.trim()];
  if (p.crisisChoiceId) {
    lines.push("", `Crisis choice: ${p.crisisChoiceId}`);
  }
  if (p.customCrisisResponse?.trim()) {
    lines.push("", `Custom crisis response: ${p.customCrisisResponse.trim()}`);
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
