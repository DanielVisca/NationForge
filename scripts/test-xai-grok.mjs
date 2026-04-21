/**
 * Smoke-test xAI Grok the same way the app does (AI SDK + responses API).
 * Run from repo root: node --env-file=.env scripts/test-xai-grok.mjs
 */
import { createXai } from "@ai-sdk/xai";
import { generateText } from "ai";

const apiKey = process.env.XAI_API_KEY ?? process.env.GROK_API_KEY;
const baseURL = process.env.XAI_BASE_URL ?? "https://api.x.ai/v1";
const modelId = process.env.XAI_MODEL ?? "grok-4.20-0309-reasoning";

if (!apiKey?.trim()) {
  console.error("Missing XAI_API_KEY (or GROK_API_KEY) in environment.");
  console.error("Try: node --env-file=.env scripts/test-xai-grok.mjs");
  process.exit(1);
}

const xai = createXai({ apiKey, baseURL });

console.log("baseURL:", baseURL);
console.log("model:", modelId);

try {
  const { text, usage, finishReason } = await generateText({
    model: xai.responses(modelId),
    prompt: "Reply with exactly one word: pong",
    maxOutputTokens: 32,
  });
  console.log("finishReason:", finishReason);
  console.log("usage:", usage);
  console.log("text:", JSON.stringify(text));
  console.log("\nGrok API: OK");
} catch (e) {
  console.error("\nGrok API: FAILED");
  console.error(e instanceof Error ? e.message : e);
  if (e?.cause) console.error("cause:", e.cause);
  process.exit(1);
}
