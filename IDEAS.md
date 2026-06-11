- Brought to you by Aidan, Francis, Daniel and unhinged chatbot
- Game master can cause individual nation inflection points and inflection points that affect multiple. The goal is to make it a fun and slightly unhinged game
- Need to add their own grok api key (will it work with any openai like key?)
- add posthog for tracking
- add voice read aloud chapters!
- ~~cache your seat token locally in browser so you can relogin as you automatically (per session id)~~ (done: `seat-token-cache.ts` + board auto-restore)
- ~~sessions (lobby) have "my" ones you hold a seat in, recent, favorites, search, and non-adversarial copy~~ (done: My Games MVP dashboard; world names still future)
- ~~a single abandoned/unforged seat could soft-lock the whole room (first beat never opens)~~ (done: host **Room controls** — remove an unforged seat or **Start anyway** with forged seats; `POST /api/nationforge/sessions/[id]/host`)
lee