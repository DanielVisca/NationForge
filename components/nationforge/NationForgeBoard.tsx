"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { consumeGmTextStream } from "@/lib/nationforge/consume-gm-stream";
import type { PublicGameSession } from "@/lib/nationforge/public-types";
import type { Nation } from "@/lib/nationforge/schema";

const HOST_TOKENS_KEY = "nationforge-host-tokens";
const POLL_MS = 2500;

export default function NationForgeBoard() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const searchParams = useSearchParams();
  const urlToken = searchParams.get("token");

  const [session, setSession] = useState<PublicGameSession | null>(null);
  const [hostTokens] = useState<Record<string, string> | null>(() => {
    if (typeof globalThis.window === "undefined") return null;
    try {
      const raw = globalThis.localStorage.getItem(HOST_TOKENS_KEY);
      if (!raw) return null;
      const all = JSON.parse(raw) as Record<string, Record<string, string>>;
      return all[sessionId] ?? null;
    } catch {
      return null;
    }
  });
  const [gmStreamText, setGmStreamText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [povNationId, setPovNationId] = useState("");
  const [narrative, setNarrative] = useState("");
  const [crisisChoiceId, setCrisisChoiceId] = useState<string>("");
  const [customCrisisResponse, setCustomCrisisResponse] = useState("");
  const [publicDiplomacy, setPublicDiplomacy] = useState("");
  const [secretAction, setSecretAction] = useState("");
  const [reallocNotes, setReallocNotes] = useState("");

  const load = useCallback(async () => {
    const token = urlToken ?? "";
    const res = await fetch(
      `/api/nationforge/sessions/${sessionId}${token ? `?token=${encodeURIComponent(token)}` : ""}`,
    );
    if (!res.ok) return;
    const data = (await res.json()) as PublicGameSession;
    setSession(data);
    if (!povNationId && data.nations[0]) {
      setPovNationId(data.activeNationId ?? data.nations[0].id);
    }
  }, [sessionId, urlToken, povNationId]);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => {
      startTransition(() => {
        void load();
      });
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const crisis = session?.crisis ?? null;

  const origin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  const submitTurn = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    setGmStreamText("");
    try {
      const res = await fetch("/api/nationforge/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          povNationId,
          narrative,
          crisisChoiceId: crisisChoiceId || undefined,
          customCrisisResponse: customCrisisResponse || undefined,
          publicDiplomacy: publicDiplomacy || undefined,
          secretAction: secretAction || undefined,
          reallocNotes: reallocNotes || undefined,
        }),
      });
      if (res.status === 429) {
        const j = (await res.json()) as { retryAfterMs?: number };
        throw new Error(
          `Rate limited. Retry after ~${Math.ceil((j.retryAfterMs ?? 5000) / 1000)}s`,
        );
      }
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      await consumeGmTextStream(res, (d) => {
        setGmStreamText((x) => x + d);
      });
      setCustomCrisisResponse("");
      setCrisisChoiceId("");
      setPublicDiplomacy("");
      setSecretAction("");
      setReallocNotes("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, [
    sessionId,
    povNationId,
    narrative,
    crisisChoiceId,
    customCrisisResponse,
    publicDiplomacy,
    secretAction,
    reallocNotes,
    load,
  ]);

  if (!session) {
    return <div className="p-8 text-center text-sm text-zinc-500">Loading…</div>;
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/nationforge" className="text-xs text-blue-600 underline">
            All sessions
          </Link>
          <h1 className="text-xl font-semibold">
            Room {session.roomCode}{" "}
            <span className="text-sm font-normal text-zinc-500">
              ({session.phase})
            </span>
          </h1>
        </div>
        {hostTokens ? (
          <div className="max-w-lg rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="font-semibold">Host: share LAN join</div>
            <div className="mt-1 font-mono break-all">
              {origin}/nationforge/join?code={session.roomCode}
            </div>
            <ul className="mt-2 space-y-1">
              {session.nations.map((n) => (
                <li key={n.id} className="font-mono text-[11px] break-all">
                  {n.name} token: {hostTokens[n.id] ?? "—"}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        {session.nations.map((n) => (
          <NationCard key={n.id} nation={n} />
        ))}
      </section>

      {crisis ? (
        <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Inflection
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
            {crisis.prompt}
          </p>
          <div className="mt-3 space-y-2">
            {crisis.options.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-start gap-2 text-sm"
              >
                <input
                  type="radio"
                  name="crisis"
                  className="mt-1"
                  checked={crisisChoiceId === o.id}
                  onChange={() => setCrisisChoiceId(o.id)}
                />
                <span>
                  <span className="font-mono text-xs text-zinc-500">{o.id}</span>{" "}
                  {o.label}
                </span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
        <h2 className="text-sm font-semibold">Your turn</h2>
        <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          POV nation
        </label>
        <select
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          value={povNationId}
          onChange={(e) => setPovNationId(e.target.value)}
        >
          {session.nations.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Narrative (required)
        </label>
        <textarea
          className="mt-1 min-h-[100px] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          placeholder="What happens this turn? Builds, tone, orders…"
        />
        <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Custom crisis response (instead of a radio option)
        </label>
        <textarea
          className="mt-1 min-h-[60px] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          value={customCrisisResponse}
          onChange={(e) => setCustomCrisisResponse(e.target.value)}
          placeholder="Something else…"
        />
        <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Public diplomacy (optional)
        </label>
        <textarea
          className="mt-1 min-h-[50px] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          value={publicDiplomacy}
          onChange={(e) => setPublicDiplomacy(e.target.value)}
        />
        <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Secret action (optional; GM registers as secret)
        </label>
        <textarea
          className="mt-1 min-h-[50px] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          value={secretAction}
          onChange={(e) => setSecretAction(e.target.value)}
        />
        <label className="mt-3 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Re-allocation notes (optional; GM applies via tools)
        </label>
        <textarea
          className="mt-1 min-h-[40px] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          value={reallocNotes}
          onChange={(e) => setReallocNotes(e.target.value)}
        />
        {error ? (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          onClick={() => void submitTurn()}
        >
          {busy ? "GM resolving…" : "Submit turn to GM"}
        </button>
      </section>

      {gmStreamText ? (
        <section className="rounded-xl border border-blue-200 bg-blue-50/80 p-4 text-sm text-zinc-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-zinc-100">
          <h3 className="text-xs font-semibold uppercase text-blue-800 dark:text-blue-200">
            Latest GM stream
          </h3>
          <p className="mt-2 whitespace-pre-wrap">{gmStreamText}</p>
        </section>
      ) : null}

      <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
        <h2 className="text-sm font-semibold">Public log</h2>
        <ul className="mt-2 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
          {session.turnLog.map((e) => (
            <li key={e.id}>
              <span className="text-xs text-zinc-500">
                {new Date(e.at).toLocaleString()}
              </span>{" "}
              {e.publicSummary}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
        <h2 className="text-sm font-semibold">Secrets registry</h2>
        <ul className="mt-2 space-y-2 text-xs">
          {session.secrets.map((s) => (
            <li key={s.id} className="font-mono text-zinc-600 dark:text-zinc-400">
              {s.nationId.slice(0, 8)}… {s.label}{" "}
              {s.content ? (
                <span className="block whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
                  {s.content}
                </span>
              ) : (
                <span className="text-zinc-400">(hidden)</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function NationCard({ nation }: { nation: Nation }) {
  const entries = Object.entries(nation.stats) as [string, number][];
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <h3 className="font-semibold">{nation.name}</h3>
      <p className="mt-1 text-xs text-zinc-500">Reserve: {nation.reserve}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="capitalize text-zinc-500">{k}</dt>
            <dd className="font-mono font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">
        {nation.buildNotes}
      </p>
    </div>
  );
}
