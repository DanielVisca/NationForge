import "server-only";

import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";

import type { Crisis, EmergentEventRecord, Nation, TurnLogEntry } from "./schema";
import { MAX_EMERGENT_EVENTS_STORED, STAT_KEYS } from "./schema";
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
    description:
      "Set the single next table event / inflection (one call per resolution). Use a vivid prompt players read in the UI; the event can be random, positive, negative, mixed, quiet, or explosive: boom, crisis, rebellion, discovery, scandal, diplomacy, disaster, opportunity, etc. Prefer a few internal options with stable string ids and allowCustom true for bookkeeping — players answer in open prose and are not shown option labels.",
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

  const severitySchema = z.enum(["minor", "moderate", "major", "world-shaking"]);

  const declare_emergent_event = tool({
    description:
      "Introduce a random or semi-random emergent world event (boom, crisis, rebellion, new faction, disaster, discovery, coup, scandal, migration, etc.). Use when a random beat should be logged for future context. Does not change stats; use apply_stat_deltas if numbers move.",
    inputSchema: z.object({
      eventTitle: z.string().describe("Short headline for logs and UI"),
      description: z.string().describe("What happened in the fiction"),
      affectedNationIds: z
        .array(z.string())
        .min(1)
        .describe("Player nation ids touched by this beat; unknown ids are dropped"),
      severity: severitySchema
        .optional()
        .describe("Scale of the shock"),
      privateNotes: z
        .string()
        .optional()
        .describe("GM-only reasoning or hidden effects — never shown to players"),
    }),
    execute: async ({
      eventTitle,
      description,
      affectedNationIds,
      severity,
      privateNotes,
    }) => {
      const session = await getGameSession(sessionId);
      if (!session) return { ok: false as const, error: "Session not found" };

      const validIds = new Set(session.nations.map((n) => n.id));
      const dropped = affectedNationIds.filter((id) => !validIds.has(id));
      const filtered = affectedNationIds.filter((id) => validIds.has(id));
      if (filtered.length === 0) {
        return {
          ok: false as const,
          error:
            "No valid nation ids in affectedNationIds after filtering — check ids match table seats.",
          droppedUnknownNationIds: dropped,
        };
      }

      const record: EmergentEventRecord = {
        id: randomUUID(),
        at: new Date().toISOString(),
        eventTitle,
        description,
        affectedNationIds: filtered,
        severity,
        privateNotes: privateNotes?.trim() || undefined,
      };
      const emergentEvents = [...session.emergentEvents, record].slice(
        -MAX_EMERGENT_EVENTS_STORED,
      );
      await saveGameSession({ ...session, emergentEvents });
      return {
        ok: true as const,
        id: record.id,
        droppedUnknownNationIds: dropped.length ? dropped : undefined,
      };
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
    declare_emergent_event,
    register_secret,
  };
}
