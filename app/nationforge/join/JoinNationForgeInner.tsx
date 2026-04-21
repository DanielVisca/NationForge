"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

export default function JoinNationForgeInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [code, setCode] = useState(sp.get("code") ?? "");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const join = useCallback(async () => {
    setError(null);
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
  }, [code, token, router]);

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold">Join NationForge</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Enter the 6-character room code from the host. Optional: paste your
        nation&apos;s seat token to see your private intel.
      </p>
      <label className="mt-6 block text-sm font-medium">Room code</label>
      <input
        className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="e.g. A1B2C3"
      />
      <label className="mt-4 block text-sm font-medium">
        Seat token (optional)
      </label>
      <input
        className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-600 dark:bg-zinc-900"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="UUID from host"
      />
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <button
        type="button"
        className="mt-6 w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        onClick={() => void join()}
      >
        Join
      </button>
    </div>
  );
}
