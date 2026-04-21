import "server-only";

import { createXai } from "@ai-sdk/xai";

const apiKey =
  process.env.XAI_API_KEY ?? process.env.GROK_API_KEY ?? undefined;

export const xai = createXai({
  apiKey,
  baseURL: process.env.XAI_BASE_URL ?? "https://api.x.ai/v1",
});

/** Default when `XAI_MODEL` unset: fast tier for lower latency (chat + NationForge GM). Override for heavier reasoning. */
export const defaultModelId =
  process.env.XAI_MODEL ?? "grok-4-1-fast-reasoning";

export function requireXaiApiKey(): string {
  if (!apiKey?.trim()) {
    throw new Error(
      "Missing XAI_API_KEY (or GROK_API_KEY). Copy .env.example to .env and set your key.",
    );
  }
  return apiKey;
}
