"use client";

import type { UIMessage } from "ai";
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

function textFromAssistantMessage(m: UIMessage): string {
  if (m.role !== "assistant") return "";
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function lastAssistantStory(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = textFromAssistantMessage(messages[i]!);
    if (t.trim()) return t;
  }
  return "";
}

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

  const lastGmChapter = useMemo(() => {
    if (!session?.gmMessages?.length) return "";
    return lastAssistantStory(session.gmMessages);
  }, [session]);

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
      setNarrative("");
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
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/nationforge" className="text-xs text-blue-600 underline">
            All sessions
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            NationForge
          </h1>
          <p className="text-xs text-zinc-500">
            Room {session.roomCode} · round {session.roundIndex} ·{" "}
            {session.phase.replace(/_/g, " ")}
          </p>
        </div>
        {hostTokens ? (
          <details className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            <summary className="cursor-pointer font-semibold">
              LAN host · join link & tokens
            </summary>
            <div className="mt-2 font-mono break-all">
              {origin}/nationforge/join?code={session.roomCode}
            </div>
            <ul className="mt-2 space-y-1">
              {session.nations.map((n) => (
                <li key={n.id} className="font-mono text-[11px] break-all">
                  {n.name}: {hostTokens[n.id] ?? "—"}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {crisis ? (
        <section className="rounded-2xl border border-violet-200/80 bg-gradient-to-b from-violet-50/90 to-white px-5 py-5 shadow-sm dark:border-violet-900/40 dark:from-violet-950/40 dark:to-zinc-950">
          <p className="text-xs font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
            Right now
          </p>
          <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-zinc-900 dark:text-zinc-100">
            {crisis.prompt}
          </p>
        </section>
      ) : null}

      {(lastGmChapter || gmStreamText) ? (
        <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Last GM reply
          </p>
          {gmStreamText ? (
            <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-zinc-900 dark:text-zinc-100">
              {gmStreamText}
            </p>
          ) : (
            <>
              <p className="mt-3 line-clamp-6 whitespace-pre-wrap text-base leading-relaxed text-zinc-800 dark:text-zinc-200">
                {lastGmChapter}
              </p>
              {lastGmChapter.length > 400 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-blue-600 underline dark:text-blue-400">
                    Read full chapter
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-zinc-800 dark:text-zinc-200">
                    {lastGmChapter}
                  </p>
                </details>
              ) : null}
            </>
          )}
        </section>
      ) : (
        <p className="text-center text-sm text-zinc-500">
          Write your opening beat below. After each turn, more of the story
          appears here.
        </p>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-zinc-50/50 px-5 py-5 dark:border-zinc-700 dark:bg-zinc-900/40">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Whose eyes are we in?
            </label>
            <select
              className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
              value={povNationId}
              onChange={(e) => setPovNationId(e.target.value)}
            >
              {session.nations.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="mt-5 block text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Storyline — write freely
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          One open field: what happens, what people feel, what you try, how the
          world shifts. You can tuck labeled choices and diplomacy under
          &quot;More for this beat&quot; if you want the GM to lock onto a
          specific option.
        </p>
        <textarea
          className="mt-3 min-h-[min(50vh,22rem)] w-full resize-y rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base leading-relaxed text-zinc-900 shadow-inner outline-none ring-zinc-400 focus:border-zinc-500 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-500"
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          placeholder="The Steel Veil hums. The envoys wait in the rain. You speak, you move, you bluff—or you stay silent and let the city decide…"
          spellCheck
        />

        <details className="mt-5 group rounded-xl border border-zinc-200 bg-white open:shadow-sm dark:border-zinc-700 dark:bg-zinc-950">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-zinc-700 marker:text-zinc-400 dark:text-zinc-300">
            Inflection — pick a labeled option (optional)
          </summary>
          <div className="border-t border-zinc-100 px-4 pb-4 pt-3 dark:border-zinc-800">
            {crisis ? (
              <div className="space-y-2">
                {crisis.options.map((o) => (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <input
                      type="radio"
                      name="crisis"
                      className="mt-1"
                      checked={crisisChoiceId === o.id}
                      onChange={() => setCrisisChoiceId(o.id)}
                    />
                    <span>
                      <span className="font-mono text-xs text-zinc-400">
                        {o.id}
                      </span>{" "}
                      {o.label}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">No active inflection list.</p>
            )}
          </div>
        </details>

        <details className="mt-3 rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-zinc-700 marker:text-zinc-400 dark:text-zinc-300">
            More for this beat — diplomacy, something else, secrets, stats
          </summary>
          <div className="space-y-4 border-t border-zinc-100 px-4 pb-4 pt-4 dark:border-zinc-800">
            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Something else (instead of a radio option)
              </label>
              <textarea
                className="mt-1 min-h-[4rem] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                value={customCrisisResponse}
                onChange={(e) => setCustomCrisisResponse(e.target.value)}
                placeholder="A plan the listed options do not cover…"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Public diplomacy
              </label>
              <textarea
                className="mt-1 min-h-[3.5rem] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                value={publicDiplomacy}
                onChange={(e) => setPublicDiplomacy(e.target.value)}
                placeholder="What other nations hear…"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Secret action
              </label>
              <textarea
                className="mt-1 min-h-[3.5rem] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                value={secretAction}
                onChange={(e) => setSecretAction(e.target.value)}
                placeholder="What stays off the wire…"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Stat / reserve asks for the GM
              </label>
              <textarea
                className="mt-1 min-h-[3rem] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                value={reallocNotes}
                onChange={(e) => setReallocNotes(e.target.value)}
                placeholder="e.g. move 3 reserve into counter-intel…"
              />
            </div>
          </div>
        </details>

        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          className="mt-5 w-full rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white shadow disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          onClick={() => void submitTurn()}
        >
          {busy ? "GM is writing the next beat…" : "Send to GM"}
        </button>
      </section>

      <details className="rounded-xl border border-zinc-200 dark:border-zinc-700">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          World & stats
        </summary>
        <div className="grid gap-4 border-t border-zinc-100 p-4 md:grid-cols-2 dark:border-zinc-800">
          {session.nations.map((n) => (
            <NationCard key={n.id} nation={n} />
          ))}
        </div>
      </details>

      <details className="rounded-xl border border-zinc-200 dark:border-zinc-700">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Chronicle — public log
          {session.turnLog.length > 0 ? (
            <span className="ml-2 font-normal text-zinc-400">
              ({session.turnLog.length} beats)
            </span>
          ) : null}
        </summary>
        <ul className="space-y-3 border-t border-zinc-100 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
          {[...session.turnLog].reverse().map((e, idx) => (
            <li key={e.id}>
              {idx > 0 ? (
                <details>
                  <summary className="cursor-pointer text-xs text-zinc-500">
                    {new Date(e.at).toLocaleString()} —{" "}
                    <span className="line-clamp-2 text-zinc-700 dark:text-zinc-300">
                      {e.publicSummary}
                    </span>
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap pl-2 text-zinc-800 dark:text-zinc-200">
                    {e.publicSummary}
                  </p>
                </details>
              ) : (
                <>
                  <span className="text-xs text-zinc-500">
                    {new Date(e.at).toLocaleString()} · latest
                  </span>
                  <p className="mt-1 whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
                    {e.publicSummary}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-xl border border-zinc-200 dark:border-zinc-700">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Secrets you may know
        </summary>
        <ul className="space-y-3 border-t border-zinc-100 p-4 text-xs dark:border-zinc-800">
          {session.secrets.length === 0 ? (
            <li className="text-zinc-500">None yet.</li>
          ) : (
            session.secrets.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-zinc-100 p-2 dark:border-zinc-800"
              >
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {s.label}
                </span>
                {s.content ? (
                  <p className="mt-1 whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
                    {s.content}
                  </p>
                ) : (
                  <p className="mt-1 text-zinc-400">Still hidden from this seat.</p>
                )}
              </li>
            ))
          )}
        </ul>
      </details>
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
