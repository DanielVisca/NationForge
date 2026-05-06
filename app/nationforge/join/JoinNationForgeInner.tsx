"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { rememberNationForgeSeat } from "@/lib/nationforge/seat-token-cache";

export default function JoinNationForgeInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [code, setCode] = useState(sp.get("code") ?? "");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const claimSeat = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/nationforge/nations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode: code.trim(),
          displayName: "",
        }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Could not start nation forge");
      }
      const data = (await res.json()) as {
        sessionId: string;
        nationId: string;
        name?: string;
        token: string;
      };
      rememberNationForgeSeat(data.sessionId, data.nationId, data.token, {
        roomCode: code.trim().toUpperCase(),
        nationName: data.name,
      });
      router.push(
        `/nationforge/${data.sessionId}?token=${encodeURIComponent(data.token)}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Join failed");
    } finally {
      setBusy(false);
    }
  }, [code, router]);

  const spectateOrRejoin = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
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
  }, [code, token, router]);

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold">Join NationForge</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Enter the 6-character room code, then open the builder — you go straight
        into the forge. You are not shown as an official seat to other players
        until you finish; your nation name is set in the forge (suggested, fully
        editable).
      </p>
      <label className="mt-6 block text-sm font-medium">Room code</label>
      <input
        className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm uppercase dark:border-zinc-600 dark:bg-zinc-900"
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
        placeholder="UUID from host — rejoin without claiming a new seat"
      />
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          disabled={busy || !code.trim()}
          className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          onClick={() => void claimSeat()}
        >
          {busy ? "…" : "Open nation builder"}
        </button>
        <button
          type="button"
          disabled={busy || !code.trim()}
          className="w-full rounded-lg border border-zinc-300 py-2 text-sm font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
          onClick={() => void spectateOrRejoin()}
        >
          {busy ? "…" : "View room (no new seat)"}
        </button>
      </div>
    </div>
  );
}
