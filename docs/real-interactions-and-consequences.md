# NationForge — Real Interactions & Consequences (design + roadmap)

The game is an **async, large-scale, world-development** sandbox among friends (and maybe strangers): people play whenever they want, engagement varies, isolationism is valid — but **interactions between nations must be real**, not hallucinated. This doc captures the design and what is built vs. staged.

## Core principle: graduate by magnitude

The GM narrates one seat at a time (Civ-style per-seat threads). When a beat involves another **player** nation, the GM must split what it may improvise from what it must defer:

- **Tier 1 — improvise (provisional, reversible, no mechanical weight):** tone and courtesy, receiving envoys, "they seem cautiously interested," the **fact of silence**, observable facts/rumor about the neighbor. Keeps an async world alive even when others are offline; reconciles freely against the real answer.
- **Tier 2 — must be real (deferred to that player; never fabricated):** material transfers (resources, fuel, money, tech, aid), binding commitments (treaties, alliances, pacts, trade deals), war & peace, territory/access. Anything that changes another nation or commits it.

Example: "GeterDun apologized" = Tier 1 (fine to improvise); "…and offered fuel cells" = Tier 2 (must come from GeterDun's player).

**Coupling to the stat system:** a cross-nation *material* outcome only hits the numbers via the **other nation's own turn** (that player chooses to send the aid → it applies to them then). A GM narrating A's beat never changes another player's nation's stats/reserve.

**NPC powers** the GM invents (no human behind them) are exempt — fully GM-voiced at any tier. The rule is only about player-controlled nations (the roster / neighborPeers).

## Handling silence well

A non-response must never stall the soliciting nation:
1. **Silence scales with time, as ambiguity** — fresh dispatch → "weeks of quiet" → "the silence itself is the message." Never a fabricated decision.
2. **The soliciting nation keeps full unilateral agency** — wait, send another envoy, prepare as-if-refused, hedge, seek another partner. (Hippity Hip building "Snowpiercer" unilaterally was correct; the only flaw was the GM *also* inventing GeterDun's reply.)
3. **The real answer is canon and reconciles** — when the target's player actually responds (via the interaction ledger → pending inbound), it lands on the soliciting nation's next beat and may override any provisional Tier-1 assumption.

This spans the whole cadence range: both online → fast reply through the ledger; hours/weeks/never → graceful silence.

## Dormancy (long real-time absence) — staged

Distinct from normal async silence (which is short→medium). Gated on a **long, table-configurable wall-clock** threshold since the seat's last turn.
- **Caretaker mode:** the nation's institutions keep it alive (defend, muddle through, react) but cannot make Tier-2 commitments — those pile into a backlog. This is the magnitude rule turned inward on the absent nation.
- **The world keeps moving around them** so return feels urgent.
- **Re-entry briefing** on the first turn back: what changed, what neighbors did, what caretakers handled vs. couldn't, and the backlog of pending overtures — the "so much is happening, I need to get on this" moment.

## Fair full-consequences (ultimatums) — staged, gated on real push

Full consequences (invasion, ceding land) are allowed, but **only** earned by genuine non-response inside a fair, communicated, time-boxed window — never "you were offline so you lost."
- **System/table-set window**, never aggressor-set (no grief ultimatums). Generous; per-table cadence.
- **Deadlines attach only to coercive Tier-2 actions** (invasion, ultimatum, force-backed demand). Friendly offers just sit pending, no penalty.
- **Bounded, proportionate default on timeout** — the aggressor's *specific declared objective* (e.g. "seize the contested Throat"), not a whole nation in one tick. Conquest takes repeated windows over real time → repeated fair chances.
- **Respond in the window → real contest** (defend / negotiate / pay tribute / call an ally), resolved via power-stat-grounded conflict adjudication.

**Hard gate:** full-consequences-on-timeout stays OFF until real out-of-band notifications exist — an in-app-only "you had 48h" is unfair to anyone who didn't have the tab open.

## Notifications

- **Now: in-app.** A notification surface in the app — incoming overtures, the viewer's outstanding (awaiting-reply) overtures, later dormancy re-entry and ultimatum countdowns (display only).
- **Later: real push** when this becomes a browser/phone app. Web Push (works in-browser and as a PWA on phones — lowest-effort, reuses this Next.js codebase) first; native push if fully native. Real push is the prerequisite that lets fair full-consequences switch on.

## Status

| Piece | State |
|-------|-------|
| Interaction ledger + server-side capture + push-awareness inbound | Built (Living World) |
| Magnitude / anti-fabrication rule + handle-silence-well + outstanding-outreach hook | **This slice** |
| In-app notification center (inbound + outstanding outbound) | **This slice** |
| Passive dormancy (caretaker + re-entry briefing) | Staged |
| Ultimatum windows + in-app countdown | Staged |
| Web/native push notifications | Staged (app phase) |
| Stat-based conflict resolution + full-consequences switch-on | Staged (after push) |
