# Aetheria

Aetheria is a Next.js app that hosts **Grok**-powered chat and **NationForge**, a living political grand-strategy sandbox at the table.

## NationForge — game vision

NationForge is an **open-ended** political grand-strategy sandbox set in Aetheria. Players control nations and can take them in any direction. The Game Master (Grok) resolves player actions fairly, then introduces **emergent** events — including occasional random or semi-random consequences that no player (or the GM in advance) fully dictates.

Examples of emergence:

- A surprise new nation or faction suddenly appears on the map.
- A non-player nation declares war, collapses, or offers an unexpected alliance.
- Natural disasters, pandemics, technological singularities, cultural movements, or economic shocks arise organically.
- Hidden player secrets are discovered at unpredictable moments.
- Butterfly-effect consequences from earlier choices snowball in surprising ways.

The GM uses **controlled randomness** (via internal reasoning or tools such as `declare_emergent_event`) to keep the world alive and unpredictable, but **never** railroads toward a preset story.

---

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `XAI_API_KEY` | Yes (for Grok / NationForge AI) | xAI API key ([console](https://console.x.ai/)). |
| `DATABASE_URL` | No | When set, NationForge session state is stored in **Neon Postgres** instead of `.data/nationforge-sessions.json`. Add the same variable in the [Vercel](https://vercel.com/docs/projects/environment-variables) project for production. |

Optional: `XAI_MODEL`, `XAI_TTS_VOICE_ID` (see `.env.example`).

---

## Getting Started (Next.js)

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you save.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy this Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
