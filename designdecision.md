## Grok chat (Aetheria)

- **API key name**: Use `XAI_API_KEY` in `.env` to match [xAI](https://docs.x.ai/developers/quickstart) and Vercel AI SDK examples. The code also accepts `GROK_API_KEY` as a fallback for existing setups.

- **Responses API + history**: The UI persists full transcripts under `.data/conversations.json` for durable history and reloads. For each new *user* turn after the first reply, the server passes xAI’s `previous_response_id` (stored per conversation as `lastResponseId`) so Grok can continue the server-side chain without resending the entire transcript. Regeneration requests omit `previous_response_id` so the model sees a fresh full `input` for that interaction.

- **Vercel AI SDK**: We use `streamText` with `@ai-sdk/xai` `xai.responses(model)` so streaming, multi-step tool execution, and xAI-specific options stay aligned with current provider support.
