## Grok chat (Aetheria)

- **API key name**: Use `XAI_API_KEY` in `.env` to match [xAI](https://docs.x.ai/developers/quickstart) and Vercel AI SDK examples. The code also accepts `GROK_API_KEY` as a fallback for existing setups.

- **Responses API + history**: The UI persists full transcripts under `.data/conversations.json` for durable history and reloads. For each new *user* turn after the first reply, the server passes xAI’s `previous_response_id` (stored per conversation as `lastResponseId`) so Grok can continue the server-side chain without resending the entire transcript. Regeneration requests omit `previous_response_id` so the model sees a fresh full `input` for that interaction.

- **Vercel AI SDK**: We use `streamText` with `@ai-sdk/xai` `xai.responses(model)` so streaming, multi-step tool execution, and xAI-specific options stay aligned with current provider support.

## NationForge (game)

- **Authoritative state**: Sessions live in `.data/nationforge-sessions.json` with nations, crisis, turn log, Grok thread ids, and secrets. The UI polls `GET /api/nationforge/sessions/[id]` for LAN-style sync (MVP).
- **Stats and math**: The GM must change the six Key Stats and reserve only through the `apply_stat_deltas` tool (per-nation, L1 movement cap per invocation). Narrative stays in streamed text; the board reads numbers from the saved session after each turn.
- **Join model**: `roomCode` for discovery; `POST /api/nationforge/nations` with `{ roomCode, displayName }` adds a nation and returns a per-seat `token`. Optional `?token=` on the session URL scopes secrets to that seat. New sessions start in `lobby` with zero nations; the first crisis appears only after `gameStarted` flips when every nation in the room has completed the forge once.
- **100-point nation builder**: Options and costs live in `lib/nationforge/nation-forge-catalog.ts`; spend and caps are enforced server-side in `POST .../sessions/[id]/forge`. Synergies and Key Stats mapping live in `nation-forge-resolve.ts` so the GM prompt and UI stay aligned with authoritative numbers. Mid-session joiners stay in `forgeComplete: false` until they finish the same stepped flow; `validatePlayerTurn` blocks their turns until then.
- **Budget dead-ends**: Every exclusive pillar includes an explicit **0 pt “underfunded / improvised”** choice so players can bank reserve or recover when earlier spends leave too little for priced tiers; those picks apply negative stat tilts in the resolver. The wizard sorts affordable options first and disables picks that exceed remaining points.
- **Rate limits**: `POST /api/nationforge/turn` is rate-limited per IP + session to reduce accidental abuse when exposed online.
