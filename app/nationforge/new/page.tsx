"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { NATIONFORGE_HOST_TOKENS_KEY } from "@/lib/nationforge/seat-token-cache";

const STORAGE_KEY = NATIONFORGE_HOST_TOKENS_KEY;

export default function NewNationForgeSessionPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/nationforge/sessions", { method: "POST" });
        const raw = await res.text();
        if (!res.ok) {
          let msg = `Could not create session (${res.status})`;
          try {
            const j = JSON.parse(raw) as {
              error?: string;
              message?: string;
              code?: string;
            };
            const detail = [j.message, j.error].filter(Boolean).join(" — ");
            if (detail) msg = detail;
            if (j.code) msg = `${msg} [${j.code}]`;
          } catch {
            if (raw.trim()) msg = raw;
          }
          throw new Error(msg);
        }
        const session = JSON.parse(raw) as {
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
