import { tool } from "ai";
import { z } from "zod";

/**
 * Example tools wired for `streamText` / xAI Responses.
 * Extend this module as your product grows.
 */
export const chatTools = {
  get_current_time: tool({
    description:
      "Return the current date and time in ISO 8601 format (UTC). Use when the user asks what time it is.",
    inputSchema: z.object({}),
    execute: async () => ({ iso: new Date().toISOString() }),
  }),
  add_numbers: tool({
    description: "Add two numbers and return the numeric sum.",
    inputSchema: z.object({
      a: z.number().describe("First addend"),
      b: z.number().describe("Second addend"),
    }),
    execute: async ({ a, b }) => ({ sum: a + b }),
  }),
};
