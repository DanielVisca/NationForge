## Grok chat (Aetheria)

- **API key name**: Use `XAI_API_KEY` in `.env` to match [xAI](https://docs.x.ai/developers/quickstart) and Vercel AI SDK examples. The code also accepts `GROK_API_KEY` as a fallback for existing setups.

- **Responses API + history**: The UI persists full transcripts under `.data/conversations.json` for durable history and reloads. For each new *user* turn after the first reply, the server passes xAI’s `previous_response_id` (stored per conversation as `lastResponseId`) so Grok can continue the server-side chain without resending the entire transcript. Regeneration requests omit `previous_response_id` so the model sees a fresh full `input` for that interaction.

- **Vercel AI SDK**: We use `streamText` with `@ai-sdk/xai` `xai.responses(model)` so streaming, multi-step tool execution, and xAI-specific options stay aligned with current provider support.

## NationForge (game)

- **Authoritative state**: Sessions live in `.data/nationforge-sessions.json` with nations, crisis, turn log, Grok thread ids, and secrets. The UI polls `GET /api/nationforge/sessions/[id]` for LAN-style sync (MVP).
- **Stats and math**: The GM must change the six Key Stats and reserve only through the `apply_stat_deltas` tool (per-nation, L1 movement cap per invocation). Narrative stays in streamed text; the board reads numbers from the saved session after each turn.
- **Join model**: `roomCode` for discovery; per-nation `seatTokens` returned once on `POST /api/nationforge/sessions` and stored client-side by the host. Optional `?token=` on the session URL filters secret visibility for non-host clients.
- **Rate limits**: `POST /api/nationforge/turn` is rate-limited per IP + session to reduce accidental abuse when exposed online.
