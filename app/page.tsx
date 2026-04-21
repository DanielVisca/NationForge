import Link from "next/link";

import { GrokChat } from "@/components/GrokChat";

export default function Home() {
  return (
    <div className="flex h-[100dvh] flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="shrink-0 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Aetheria · Grok
          </h1>
          <Link
            href="/nationforge"
            className="text-xs font-medium text-blue-600 underline dark:text-blue-400"
          >
            NationForge
          </Link>
        </div>
        <p className="text-xs text-zinc-500">
          Responses API, server-side chain id, local transcript in{" "}
          <code className="rounded bg-zinc-200/80 px-1 dark:bg-zinc-800">.data/</code>
        </p>
      </header>
      <GrokChat />
    </div>
  );
}
