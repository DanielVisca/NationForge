import "server-only";

import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";

import type { Crisis, Nation, TurnLogEntry } from "./schema";
import { STAT_KEYS } from "./schema";
import {
  applyDeltasToStats,
  type StatDeltas,
  validateReallocBudget,
} from "./validation";
import { getGameSession, saveGameSession } from "./store";

const statDeltaSchema = z
  .object({
    prosperity: z.number().int().optional(),
    stability: z.number().int().optional(),
    freedom: z.number().int().optional(),
    power: z.number().int().optional(),
    happiness: z.number().int().optional(),
    innovation: z.number().int().optional(),
  })
  .strip();

export function createNationForgeTools(sessionId: string) {
  const apply_stat_deltas = tool({
    description:
      "Apply integer deltas to one nation's six Key Stats and/or reserve. Required for any numeric change. One nation per call; budget is enforced per call.",
    inputSchema: z.object({
      nationId: z.string().describe("Target nation id"),
      deltas: statDeltaSchema.describe("Per-stat deltas; omit keys with no change"),
      reserveDelta: z
        .number()
        .int()
        .default(0)
        .describe("Change to reserve (negative spends reserve)"),
    }),
    execute: async ({ nationId, deltas, reserveDelta }) => {
      const session = await getGameSession(sessionId);
      if (!session) return { ok: false as const, error: "Session not found" };

      const deltasClean = Object.fromEntries(
        Object.entries(deltas).filter(
          ([k, v]) =>
            v !== undefined && STAT_KEYS.includes(k as (typeof STAT_KEYS)[number]),
        ),
      ) as StatDeltas;

      const v = validateReallocBudget(deltasClean, reserveDelta);
      if (!v.ok) return { ok: false as const, error: v.reason };

      const idx = session.nations.findIndex((n) => n.id === nationId);
      if (idx === -1) return { ok: false as const, error: "Unknown nationId" };

      const nation = session.nations[idx];
      const newReserve = nation.reserve + reserveDelta;
      if (newReserve < 0) {
        return { ok: false as const, error: "Reserve cannot go negative" };
      }

      const newStats = applyDeltasToStats(nation.stats, deltasClean);
      const updated: Nation = {
        ...nation,
        stats: newStats,
        reserve: newReserve,
      };
      const nations = [...session.nations];
      nations[idx] = updated;
      await saveGameSession({ ...session, nations });
      return {
        ok: true as const,
        nationId,
        stats: updated.stats,
        reserve: updated.reserve,
      };
    },
  });

  const no_stat_change_this_turn = tool({
    description:
      "Call when the simulation has no numeric stat or reserve changes this turn (pure narrative / diplomacy).",
    inputSchema: z.object({
      note: z.string().optional().describe("Optional short reason for logs"),
    }),
    execute: async ({ note }) => {
      return { ok: true as const, note: note ?? "no numeric change" };
    },
  });

  const append_turn_log = tool({
    description: "Append a public turn log line; optional private note for one nation (LAN secrecy).",
    inputSchema: z.object({
      povNationId: z.string(),
      publicSummary: z.string(),
      privateByNationId: z.string().optional(),
      privateText: z.string().optional(),
    }),
    execute: async ({
      povNationId,
      publicSummary,
      privateByNationId,
      privateText,
    }) => {
      const session = await getGameSession(sessionId);
      if (!session) return { ok: false as const, error: "Session not found" };

      const entry: TurnLogEntry = {
        id: randomUUID(),
        at: new Date().toISOString(),
        povNationId,
        publicSummary,
        privateByNation:
          privateByNationId && privateText
            ? { [privateByNationId]: privateText }
            : undefined,
      };
      await saveGameSession({
        ...session,
        turnLog: [...session.turnLog, entry],
      });
      return { ok: true as const, id: entry.id };
    },
  });

  const set_inflection = tool({
    description: "Set the next crisis / inflection point players will react to.",
    inputSchema: z.object({
      prompt: z.string(),
      options: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
          }),
        )
        .min(2)
        .max(8),
      allowCustom: z.boolean().default(true),
      activeNationIds: z.array(z.string()).min(1),
    }),
    execute: async ({ prompt, options, allowCustom, activeNationIds }) => {
      const session = await getGameSession(sessionId);
      if (!session) return { ok: false as const, error: "Session not found" };

      const crisis: Crisis = {
        id: randomUUID(),
        prompt,
        options,
        allowCustom,
        activeNationIds,
      };
      await saveGameSession({
        ...session,
        crisis,
        phase: "awaiting_decision",
        roundIndex: session.roundIndex + 1,
      });
      return { ok: true as const, crisisId: crisis.id };
    },
  });

  const register_secret = tool({
    description: "Register a secret action for a nation (hidden from other nations until revealed).",
    inputSchema: z.object({
      nationId: z.string(),
      label: z.string(),
      content: z.string(),
    }),
    execute: async ({ nationId, label, content }) => {
      const session = await getGameSession(sessionId);
      if (!session) return { ok: false as const, error: "Session not found" };

      const secret = {
        id: randomUUID(),
        nationId,
        label,
        content,
        revealed: false,
      };
      await saveGameSession({
        ...session,
        secrets: [...session.secrets, secret],
      });
      return { ok: true as const, secretId: secret.id };
    },
  });

  return {
    apply_stat_deltas,
    no_stat_change_this_turn,
    append_turn_log,
    set_inflection,
    register_secret,
  };
}
