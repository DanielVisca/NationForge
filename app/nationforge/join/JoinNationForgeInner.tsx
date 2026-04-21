"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

const HOST_TOKENS_KEY = "nationforge-host-tokens";

function mergeSeatToken(sessionId: string, nationId: string, token: string) {
  if (typeof globalThis.window === "undefined") return;
  try {
    const raw = globalThis.localStorage.getItem(HOST_TOKENS_KEY);
    const all = (raw ? JSON.parse(raw) : {}) as Record<
      string,
      Record<string, string>
    >;
    all[sessionId] = { ...(all[sessionId] ?? {}), [nationId]: token };
    globalThis.localStorage.setItem(HOST_TOKENS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export default function JoinNationForgeInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [code, setCode] = useState(sp.get("code") ?? "");
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (displayName.trim()) {
        const res = await fetch("/api/nationforge/nations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomCode: code.trim(),
            displayName: displayName.trim(),
          }),
        });
        if (!res.ok) {
          const j = (await res.json()) as { error?: string };
          throw new Error(j.error ?? "Could not join room");
        }
        const data = (await res.json()) as {
          sessionId: string;
          nationId: string;
          token: string;
        };
        mergeSeatToken(data.sessionId, data.nationId, data.token);
        router.push(
          `/nationforge/${data.sessionId}?token=${encodeURIComponent(data.token)}`,
        );
        return;
      }

      const res = await fetch(
        `/api/nationforge/join?code=${encodeURIComponent(code.trim())}`,
      );
      if (!res.ok) {
        setError("Room not found");
        return;
      }
      const { sessionId } = (await res.json()) as { sessionId: string };
      const q = token.trim() ? `?token=${encodeURIComponent(token.trim())}` : "";
      router.push(`/nationforge/${sessionId}${q}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Join failed");
    } finally {
      setBusy(false);
    }
  }, [code, displayName, token, router]);

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold">Join NationForge</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Enter the 6-character room code. Add your display name to claim a seat
        and run the 100-point nation builder (you can also join later — the
        builder runs one section at a time).
      </p>
      <label className="mt-6 block text-sm font-medium">Room code</label>
      <input
        className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm uppercase dark:border-zinc-600 dark:bg-zinc-900"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="e.g. A1B2C3"
      />
      <label className="mt-4 block text-sm font-medium">Your nation name</label>
      <input
        className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="e.g. The River Concord"
      />
      <p className="mt-2 text-xs text-zinc-500">
        Leave blank only if you already have a seat token and are reopening your
        link (legacy).
      </p>
      <label className="mt-4 block text-sm font-medium">
        Seat token (optional)
      </label>
      <input
        className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-600 dark:bg-zinc-900"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="UUID from host — only if not using name above"
      />
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <button
        type="button"
        disabled={busy || !code.trim()}
        className="mt-6 w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        onClick={() => void join()}
      >
        {busy ? "Joining…" : displayName.trim() ? "Claim seat & forge" : "Join"}
      </button>
    </div>
  );
}
