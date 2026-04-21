"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const STORAGE_KEY = "nationforge-host-tokens";

export default function NewNationForgeSessionPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/nationforge/sessions", { method: "POST" });
        if (!res.ok) throw new Error(await res.text());
        const session = (await res.json()) as {
          id: string;
          seatTokens: Record<string, string>;
        };
        if (cancelled) return;
        const existing = JSON.parse(
          globalThis.localStorage.getItem(STORAGE_KEY) ?? "{}",
        ) as Record<string, Record<string, string>>;
        existing[session.id] = session.seatTokens;
        globalThis.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(existing),
        );
        router.replace(`/nationforge/${session.id}`);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to create session");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <div className="p-8 text-center text-sm text-red-600">
        {error}
      </div>
    );
  }

  return (
    <div className="p-8 text-center text-sm text-zinc-500">
      Creating session…
    </div>
  );
}
