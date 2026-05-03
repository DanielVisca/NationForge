import "server-only";

import { randomUUID } from "node:crypto";

import { generateText } from "ai";
import { z } from "zod";

import { defaultModelId, xai } from "@/lib/xai";

import type { GameSecret, GameSession, Nation } from "./schema";
import type { PlayerTurnPayload } from "./player-input";

const EMPTY_PUBLIC_FALLBACK =
  "The nation acts through channels it does not publicly disclose.";

const confidentialItemSchema = z.object({
  label: z.string().min(1).max(120),
  content: z.string().min(1).max(2000),
});

const classificationSchema = z.object({
  publicNarrative: z.string().max(4000),
  confidentialItems: z.array(confidentialItemSchema).max(5),
});

type ConfidentialClassification = z.infer<typeof classificationSchema>;

function normalizePublicNarrative(text: string): string {
  const trimmed = text.trim();
  return trimmed || EMPTY_PUBLIC_FALLBACK;
}

function explicitSecretForPayload(
  payload: PlayerTurnPayload,
  nation: Nation,
): GameSecret[] {
  const content = payload.secretAction?.trim();
  if (!content) return [];
  return [
    {
      id: randomUUID(),
      nationId: payload.povNationId,
      label: `${nation.name}: private turn action`,
      content,
      revealed: false,
    },
  ];
}

async function classifyNarrative(
  payload: PlayerTurnPayload,
  session: GameSession,
  nation: Nation,
): Promise<ConfidentialClassification> {
  const narrative = payload.narrative.trim();
  const publicDiplomacy = payload.publicDiplomacy?.trim() || "(legacy field not sent)";
  const nationNames = session.nations.map((n) => n.name).join(", ");

  const result = await generateText({
    model: xai.responses(defaultModelId),
    maxOutputTokens: 900,
    prompt: `You are a privacy filter for a multiplayer political roleplay game.

Return JSON only, with this shape:
{
  "publicNarrative": "string",
  "confidentialItems": [{ "label": "string", "content": "string" }]
}

Classify the player's MAIN MESSAGE for ${nation.name}.

Rules:
- Preserve the public-facing meaning in publicNarrative.
- Extract only clearly confidential, covert, private, secret, hidden, off-record, espionage, blackmail, deception, internal-only, or undisclosed planning.
- If a sentence mixes public and private content, keep the visible/public portion and move only the hidden part to confidentialItems.
- Do not classify normal public policy, speeches, laws, trade, diplomacy, war declarations, or visible mobilization as confidential.
- Do not invent facts.
- If nothing is confidential, confidentialItems must be [] and publicNarrative should closely match the original message.
- If everything material is confidential, publicNarrative should be a bland public-safe placeholder.

Other player nation names: ${nationNames}
Legacy explicit public diplomacy field for this send: ${publicDiplomacy}

MAIN MESSAGE:
${narrative}`,
  });

  const text = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "");
  return classificationSchema.parse(JSON.parse(text));
}

export async function preparePlayerTurnForPersistence(
  payload: PlayerTurnPayload,
  session: GameSession,
): Promise<{
  publicPayload: PlayerTurnPayload;
  secrets: GameSecret[];
}> {
  const nation = session.nations.find((n) => n.id === payload.povNationId);
  if (!nation) {
    return {
      publicPayload: {
        ...payload,
        narrative: normalizePublicNarrative(payload.narrative),
        secretAction: undefined,
      },
      secrets: [],
    };
  }

  const explicitSecrets = explicitSecretForPayload(payload, nation);

  try {
    const classification = await classifyNarrative(payload, session, nation);
    const classifiedSecrets = classification.confidentialItems.map((item) => ({
      id: randomUUID(),
      nationId: payload.povNationId,
      label: `${nation.name}: ${item.label.trim()}`,
      content: item.content.trim(),
      revealed: false,
    }));

    return {
      publicPayload: {
        ...payload,
        narrative: normalizePublicNarrative(classification.publicNarrative),
        secretAction: undefined,
      },
      secrets: [...explicitSecrets, ...classifiedSecrets],
    };
  } catch {
    return {
      publicPayload: {
        ...payload,
        narrative: normalizePublicNarrative(payload.narrative),
        secretAction: undefined,
      },
      secrets: explicitSecrets,
    };
  }
}
