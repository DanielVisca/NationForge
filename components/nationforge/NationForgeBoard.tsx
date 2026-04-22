"use client";

import type { UIMessage } from "ai";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { consumeGmTextStream } from "@/lib/nationforge/consume-gm-stream";
import { buildOpeningBriefPlayerMessage } from "@/lib/nationforge/opening-brief-narrative";
import type { PublicGameSession } from "@/lib/nationforge/public-types";
import {
  MAX_DIPLOMACY_MESSAGE_LENGTH,
  MAX_DIPLOMACY_REPLY_LENGTH,
  MAX_DOMESTIC_SCRATCH_LENGTH,
  type DiplomaticOutreach,
  type Nation,
} from "@/lib/nationforge/schema";

import NationForgeWizard from "./NationForgeWizard";

const HOST_TOKENS_KEY = "nationforge-host-tokens";

/** Dedupes auto-opening GM beat (avoids Strict Mode double-invoke sending twice). */
let openingBeatAutoKeySent = "";
/** Prevents parallel opening-brief POSTs from the same browser. */
let openingBriefInFlight = false;

const POLL_MS = 2500;
const POLL_MS_GM_RUNNING = 650;

async function readFetchErrorBody(res: Response): Promise<string> {
  const t = await res.text();
  try {
    const j = JSON.parse(t) as { error?: string };
    if (typeof j.error === "string" && j.error.trim()) return j.error.trim();
  } catch {
    /* ignore */
  }
  return t.trim() || res.statusText;
}

function isBenignGmBusyError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("already in the queue") ||
    m.includes("opening or turn is already") ||
    m.includes("still writing") ||
    m.includes("still resolving") ||
    m.includes("still streaming") ||
    m.includes("wait for the gm") ||
    m.includes("gm is still")
  );
}

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

export default function NationForgeBoard() {
  const params = useParams();
  const router = useRouter();
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

  const [joinName, setJoinName] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [domesticDraft, setDomesticDraft] = useState("");
  const [domesticSaveState, setDomesticSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [domesticSaveError, setDomesticSaveError] = useState<string | null>(null);
  const domesticDirtyRef = useRef(false);
  const domesticDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [diplomacyToId, setDiplomacyToId] = useState("");
  const [diplomacyMessage, setDiplomacyMessage] = useState("");
  const [diplomacyBusy, setDiplomacyBusy] = useState(false);
  const [diplomacyError, setDiplomacyError] = useState<string | null>(null);
  const [replyDraftById, setReplyDraftById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const token = urlToken ?? "";
    const res = await fetch(
      `/api/nationforge/sessions/${sessionId}${token ? `?token=${encodeURIComponent(token)}` : ""}`,
    );
    if (!res.ok) return;
    const data = (await res.json()) as PublicGameSession;
    setSession(data);
    setPovNationId((prev) => {
      if (data.viewerNationId) return data.viewerNationId;
      if (prev) return prev;
      if (data.nations[0]) return data.activeNationId ?? data.nations[0]!.id;
      return prev;
    });
  }, [sessionId, urlToken]);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  const pollMs =
    session?.phase === "gm_running" ? POLL_MS_GM_RUNNING : POLL_MS;

  useEffect(() => {
    const t = setInterval(() => {
      startTransition(() => {
        void load();
      });
    }, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  const crisis = session?.crisis ?? null;

  const chronicleSeatNation = useMemo(() => {
    if (!session?.activeNationId) return undefined;
    return session.nations.find((n) => n.id === session.activeNationId);
  }, [session]);

  const crisisInvolvedNames = useMemo(() => {
    if (!session?.crisis?.activeNationIds?.length) return [];
    return session.crisis.activeNationIds
      .map((id) => session.nations.find((n) => n.id === id)?.name)
      .filter((name): name is string => Boolean(name));
  }, [session]);

  const lastGmChapter = useMemo(() => {
    if (!session?.gmMessages?.length) return "";
    return lastAssistantStory(session.gmMessages);
  }, [session]);

  const origin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  const myNation = useMemo(() => {
    if (!session?.viewerNationId) return undefined;
    return session.nations.find((n) => n.id === session.viewerNationId);
  }, [session]);

  const otherNations = useMemo(() => {
    if (!session?.viewerNationId) return [];
    return session.nations.filter((n) => n.id !== session.viewerNationId);
  }, [session]);

  const sortedDiplomacy = useMemo(() => {
    const list = session?.diplomaticOutreach ?? [];
    return [...list].sort(
      (a, b) => Date.parse(b.at) - Date.parse(a.at),
    ) as DiplomaticOutreach[];
  }, [session?.diplomaticOutreach]);

  useEffect(() => {
    if (!otherNations.length) return;
    if (!diplomacyToId || !otherNations.some((n) => n.id === diplomacyToId)) {
      setDiplomacyToId(otherNations[0]!.id);
    }
  }, [otherNations, diplomacyToId]);

  useEffect(() => {
    domesticDirtyRef.current = false;
  }, [urlToken, session?.viewerNationId]);

  useEffect(() => {
    if (!myNation) return;
    if (!domesticDirtyRef.current) {
      setDomesticDraft(myNation.domesticScratch ?? "");
    }
  }, [myNation?.domesticScratch, myNation?.id]);

  useEffect(() => {
    return () => {
      if (domesticDebounceRef.current) {
        clearTimeout(domesticDebounceRef.current);
        domesticDebounceRef.current = null;
      }
    };
  }, []);

  const showWizard = Boolean(
    urlToken && myNation && !myNation.forgeComplete && myNation.forgeProgress,
  );

  const povNation = useMemo(
    () => session?.nations.find((n) => n.id === povNationId),
    [session, povNationId],
  );

  const waitingForTableOpen = Boolean(
    session &&
      urlToken &&
      myNation?.forgeComplete &&
      !session.gameStarted &&
      session.nations.length > 0,
  );

  /** First GM prose exists (or we are mid-stream). */
  const introDelivered = Boolean(
    lastGmChapter.trim().length > 0 || gmStreamText.trim().length > 0,
  );

  const showTurnComposer = Boolean(
    session &&
      session.gameStarted &&
      !waitingForTableOpen &&
      introDelivered,
  );

  const isOpeningBeatSeat = Boolean(
    session &&
      urlToken &&
      session.viewerNationId &&
      session.viewerNationId === session.activeNationId,
  );

  const gmComposing = Boolean(
    session?.gameStarted &&
      (session.phase === "gm_running" || busy || gmStreamText.length > 0),
  );

  const canSendTurn = useMemo(() => {
    if (!session?.gameStarted || !narrative.trim()) return false;
    if (!povNation?.forgeComplete) return false;
    if (session.phase === "gm_running") return false;
    if (session.phase === "awaiting_decision" && session.crisis) {
      if (!crisisChoiceId && !customCrisisResponse.trim()) return false;
      if (crisisChoiceId && customCrisisResponse.trim()) return false;
    }
    return true;
  }, [
    session,
    narrative,
    povNation,
    crisisChoiceId,
    customCrisisResponse,
  ]);

  const claimSeat = useCallback(async () => {
    if (!session) return;
    setJoinBusy(true);
    setJoinError(null);
    try {
      const res = await fetch("/api/nationforge/nations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode: session.roomCode,
          displayName: joinName.trim(),
        }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Could not claim seat");
      }
      const data = (await res.json()) as {
        sessionId: string;
        nationId: string;
        token: string;
      };
      mergeSeatToken(data.sessionId, data.nationId, data.token);
      router.replace(
        `/nationforge/${data.sessionId}?token=${encodeURIComponent(data.token)}`,
      );
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : "Failed");
    } finally {
      setJoinBusy(false);
    }
  }, [session, joinName, router]);

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
        const errText = await readFetchErrorBody(res);
        if (isBenignGmBusyError(errText)) {
          await load();
          setGmStreamText("");
          return;
        }
        throw new Error(errText);
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
      setGmStreamText("");
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

  const saveDomesticScratch = useCallback(
    async (value: string) => {
      if (!sessionId || !urlToken) return;
      const trimmed = value.trim();
      if (trimmed.length > MAX_DOMESTIC_SCRATCH_LENGTH) return;
      setDomesticSaveState("saving");
      setDomesticSaveError(null);
      try {
        const res = await fetch(
          `/api/nationforge/sessions/${sessionId}/domestic?token=${encodeURIComponent(urlToken)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domesticScratch: value }),
          },
        );
        if (res.status === 429) {
          const j = (await res.json()) as { retryAfterMs?: number };
          throw new Error(
            `Rate limited. Retry after ~${Math.ceil((j.retryAfterMs ?? 5000) / 1000)}s`,
          );
        }
        if (!res.ok) {
          const errText = await readFetchErrorBody(res);
          throw new Error(errText);
        }
        const fresh = (await res.json()) as PublicGameSession;
        setSession(fresh);
        const me = fresh.nations.find((n) => n.id === fresh.viewerNationId);
        setDomesticDraft(me?.domesticScratch ?? trimmed);
        domesticDirtyRef.current = false;
        setDomesticSaveState("saved");
      } catch (e) {
        setDomesticSaveState("error");
        setDomesticSaveError(e instanceof Error ? e.message : "Save failed");
      }
    },
    [sessionId, urlToken],
  );

  const scheduleDomesticSave = useCallback(
    (value: string) => {
      if (!urlToken || !myNation?.forgeComplete) return;
      if (domesticDebounceRef.current) {
        clearTimeout(domesticDebounceRef.current);
      }
      domesticDebounceRef.current = setTimeout(() => {
        domesticDebounceRef.current = null;
        void saveDomesticScratch(value);
      }, 450);
    },
    [saveDomesticScratch, urlToken, myNation?.forgeComplete],
  );

  const sendDiplomacy = useCallback(async () => {
    if (!sessionId || !urlToken || !diplomacyToId.trim()) return;
    const msg = diplomacyMessage.trim();
    if (!msg) {
      setDiplomacyError("Write a message before sending.");
      return;
    }
    setDiplomacyBusy(true);
    setDiplomacyError(null);
    try {
      const res = await fetch(
        `/api/nationforge/sessions/${sessionId}/diplomacy?token=${encodeURIComponent(urlToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toNationId: diplomacyToId, message: msg }),
        },
      );
      if (res.status === 429) {
        const j = (await res.json()) as { retryAfterMs?: number };
        throw new Error(
          `Rate limited. Retry after ~${Math.ceil((j.retryAfterMs ?? 5000) / 1000)}s`,
        );
      }
      if (!res.ok) {
        throw new Error(await readFetchErrorBody(res));
      }
      const fresh = (await res.json()) as PublicGameSession;
      setSession(fresh);
      setDiplomacyMessage("");
    } catch (e) {
      setDiplomacyError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setDiplomacyBusy(false);
    }
  }, [sessionId, urlToken, diplomacyToId, diplomacyMessage]);

  const sendDiplomacyReply = useCallback(
    async (outreachId: string, text: string) => {
      if (!sessionId || !urlToken) return;
      const trimmed = text.trim();
      if (!trimmed) {
        setDiplomacyError("Reply cannot be empty.");
        return;
      }
      setDiplomacyBusy(true);
      setDiplomacyError(null);
      try {
        const res = await fetch(
          `/api/nationforge/sessions/${sessionId}/diplomacy/${encodeURIComponent(outreachId)}/reply?token=${encodeURIComponent(urlToken)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: trimmed }),
          },
        );
        if (res.status === 429) {
          const j = (await res.json()) as { retryAfterMs?: number };
          throw new Error(
            `Rate limited. Retry after ~${Math.ceil((j.retryAfterMs ?? 5000) / 1000)}s`,
          );
        }
        if (!res.ok) {
          throw new Error(await readFetchErrorBody(res));
        }
        const fresh = (await res.json()) as PublicGameSession;
        setSession(fresh);
        setReplyDraftById((prev) => {
          const next = { ...prev };
          delete next[outreachId];
          return next;
        });
      } catch (e) {
        setDiplomacyError(e instanceof Error ? e.message : "Reply failed");
      } finally {
        setDiplomacyBusy(false);
      }
    },
    [sessionId, urlToken],
  );

  const submitOpeningBrief = useCallback(async () => {
    if (!sessionId || !session?.crisis) return;
    if (openingBriefInFlight) return;
    const opener = session.nations.find((n) => n.id === session.activeNationId);
    if (!opener?.forgeComplete) return;
    const dedupeKey = `${session.id}:${session.crisis.id}`;
    openingBriefInFlight = true;
    setBusy(true);
    setError(null);
    setGmStreamText("");
    try {
      const res = await fetch("/api/nationforge/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          povNationId: session.activeNationId,
          narrative: buildOpeningBriefPlayerMessage(opener),
          orientationRequest: true,
        }),
      });
      if (res.status === 429) {
        const j = (await res.json()) as { retryAfterMs?: number };
        throw new Error(
          `Rate limited. Retry after ~${Math.ceil((j.retryAfterMs ?? 5000) / 1000)}s`,
        );
      }
      if (!res.ok) {
        const errText = await readFetchErrorBody(res);
        if (isBenignGmBusyError(errText)) {
          await load();
          openingBeatAutoKeySent = dedupeKey;
          setGmStreamText("");
          return;
        }
        throw new Error(errText);
      }
      await consumeGmTextStream(res, (d) => {
        setGmStreamText((x) => x + d);
      });
      await load();
      setGmStreamText("");
      openingBeatAutoKeySent = dedupeKey;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      openingBriefInFlight = false;
      setBusy(false);
    }
  }, [sessionId, session, load]);

  useEffect(() => {
    if (!session || !urlToken || !myNation?.forgeComplete) return;
    if (waitingForTableOpen) return;
    if (!session.gameStarted || !session.crisis) return;
    if (lastGmChapter.trim() || gmStreamText.trim()) return;
    if (session.phase === "gm_running") return;
    if (!session.viewerNationId || session.viewerNationId !== session.activeNationId) {
      return;
    }
    const dedupeKey = `${session.id}:${session.crisis.id}`;
    if (openingBeatAutoKeySent === dedupeKey) return;
    void (async () => {
      await Promise.resolve();
      await submitOpeningBrief();
    })();
  }, [
    session,
    urlToken,
    myNation?.forgeComplete,
    waitingForTableOpen,
    lastGmChapter,
    gmStreamText,
    submitOpeningBrief,
  ]);

  if (!session) {
    return <div className="p-8 text-center text-sm text-zinc-500">Loading…</div>;
  }

  if (showWizard && myNation?.forgeProgress) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <Link href="/nationforge" className="text-xs text-blue-600 underline">
            All sessions
          </Link>
        </div>
        <NationForgeWizard
          sessionId={sessionId}
          token={urlToken!}
          nation={myNation}
          onDone={load}
        />
      </div>
    );
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
            {session.gameStarted ? "" : " · lobby / nation forge"}
          </p>
        </div>
        <details className="max-w-md rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
          <summary className="cursor-pointer font-semibold">Share & join</summary>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Others join with the room code (optional seat nickname; the nation
            name is set after the 100-point builder). Or use this link:
          </p>
          <div className="mt-2 font-mono break-all text-[11px]">
            {origin}/nationforge/join?code={session.roomCode}
          </div>
          {hostTokens ? (
            <ul className="mt-3 space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-700">
              <li className="font-medium text-amber-900 dark:text-amber-200">
                Seat tokens (host copy)
              </li>
              {session.nations.map((n) => (
                <li key={n.id} className="font-mono text-[10px] break-all">
                  {n.name}: {hostTokens[n.id] ?? "—"}
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      </div>

      {session.gameStarted && !waitingForTableOpen ? (
        <div className="rounded-xl border border-teal-200 bg-teal-50/90 px-4 py-3 text-sm text-teal-950 shadow-sm dark:border-teal-900/45 dark:bg-teal-950/35 dark:text-teal-50">
          <p className="font-semibold">
            Chronicle seat:{" "}
            {chronicleSeatNation?.name?.trim() ||
              session.activeNationId ||
              "—"}
          </p>
          {session.viewerNationId ? (
            <p className="mt-1 text-xs text-teal-900/90 dark:text-teal-100/85">
              {session.viewerNationId === session.activeNationId
                ? "You hold the chronicle seat (opening beat or last POV sent to the GM)."
                : `Waiting while ${chronicleSeatNation?.name?.trim() || "another seat"} anchors the last beat.`}
            </p>
          ) : (
            <p className="mt-1 text-xs text-teal-900/85 dark:text-teal-100/80">
              Claim a seat to see whether you hold this chronicle seat.
            </p>
          )}
          {session.phase === "awaiting_decision" &&
          session.crisis &&
          crisisInvolvedNames.length > 0 ? (
            <>
              <p className="mt-2 text-xs font-medium text-teal-900 dark:text-teal-100/90">
                Crisis involves: {crisisInvolvedNames.join(", ")}
              </p>
              <p className="mt-1 text-[11px] text-teal-800/90 dark:text-teal-200/80">
                {session.crisis.activeNationIds.length <= 1
                  ? "This inflection highlights a single seat; bilateral diplomacy below runs between two nations anytime."
                  : "This inflection spans multiple seats; you still develop your nation continuously and negotiate one-to-one on the side."}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {gmComposing ? (
        <div className="w-full rounded-xl border border-sky-200 bg-gradient-to-r from-sky-50 to-white px-4 py-3 text-sm shadow-sm dark:border-sky-900/50 dark:from-sky-950/50 dark:to-zinc-950">
          <p className="font-semibold text-sky-950 dark:text-sky-100">
            Worldbuilding in progress
          </p>
          <p className="mt-1 text-xs text-sky-900/90 dark:text-sky-200/90">
            Grok is drafting this beat.{" "}
            {gmStreamText
              ? "Live tokens show in the box below on this browser."
              : session.phase === "gm_running"
                ? "This page polls faster while the GM runs; the full reply appears when the beat completes."
                : "Connecting to the GM stream…"}
          </p>
          {gmStreamText ? (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-sky-200/80 bg-white/90 p-3 font-mono text-xs leading-relaxed text-zinc-800 dark:border-sky-900/40 dark:bg-zinc-950 dark:text-zinc-200">
              {gmStreamText}
              <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-sky-600 dark:bg-sky-400" />
            </div>
          ) : null}
        </div>
      ) : null}

      {!urlToken ? (
        <section className="rounded-2xl border border-blue-200 bg-blue-50/80 px-5 py-5 dark:border-blue-900/50 dark:bg-blue-950/30">
          <h2 className="text-sm font-semibold text-blue-950 dark:text-blue-100">
            Claim your seat
          </h2>
          <p className="mt-2 text-sm text-blue-900/90 dark:text-blue-200/90">
            You are spectating without a seat token. Claim a seat to run the
            100-point builder — you will name your nation at the end of the
            wizard (with an AI suggestion you can edit). Optional: a short
            nickname here labels your seat until then. You can join after others
            have started; your builder runs privately until you finish.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <input
              className="min-w-[12rem] flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm dark:border-blue-900 dark:bg-zinc-950"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              placeholder="Optional seat nickname"
            />
            <button
              type="button"
              disabled={joinBusy}
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-blue-200 dark:text-blue-950"
              onClick={() => void claimSeat()}
            >
              {joinBusy ? "…" : "Claim seat"}
            </button>
          </div>
          {joinError ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{joinError}</p>
          ) : null}
        </section>
      ) : null}

      {waitingForTableOpen ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          Your nation is forged. Waiting for everyone else to finish their
          builder before the GM opens the chronicle.
        </div>
      ) : null}

      {urlToken && myNation?.forgeComplete ? (
        <section className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-4 dark:border-zinc-700 dark:bg-zinc-900/50">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Governance and society
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Steer domestic policy, civic projects, and national mood between GM
            beats. The GM reads this as continuity for your nation; it does not
            change stats by itself. Other seats do not see your notes—only their
            own.
          </p>
          <textarea
            className="mt-3 min-h-[6rem] w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-900 outline-none ring-zinc-400 focus:border-zinc-500 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500"
            value={domesticDraft}
            maxLength={MAX_DOMESTIC_SCRATCH_LENGTH}
            onChange={(e) => {
              const v = e.target.value.slice(0, MAX_DOMESTIC_SCRATCH_LENGTH);
              domesticDirtyRef.current = true;
              setDomesticDraft(v);
              setDomesticSaveState("idle");
              scheduleDomesticSave(v);
            }}
            onBlur={() => {
              if (domesticDebounceRef.current) {
                clearTimeout(domesticDebounceRef.current);
                domesticDebounceRef.current = null;
              }
              void saveDomesticScratch(domesticDraft);
            }}
            placeholder="What you are building, regulating, or reacting to at home — the GM treats this as your running brief…"
            spellCheck
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-500">
            <span>
              {domesticDraft.length}/{MAX_DOMESTIC_SCRATCH_LENGTH}
            </span>
            {domesticSaveState === "saving" ? (
              <span className="text-zinc-600 dark:text-zinc-400">Saving…</span>
            ) : null}
            {domesticSaveState === "saved" ? (
              <span className="text-emerald-700 dark:text-emerald-400">Saved</span>
            ) : null}
            {domesticSaveState === "error" && domesticSaveError ? (
              <span className="text-red-600 dark:text-red-400">{domesticSaveError}</span>
            ) : null}
          </div>
        </section>
      ) : null}

      {urlToken && myNation?.forgeComplete && otherNations.length > 0 ? (
        <section className="rounded-xl border border-indigo-200/90 bg-indigo-50/70 px-4 py-4 dark:border-indigo-900/40 dark:bg-indigo-950/35">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-900 dark:text-indigo-200">
            Diplomatic outreach
          </p>
          <p className="mt-1 text-xs text-indigo-950/85 dark:text-indigo-100/85">
            Open a bilateral channel to another nation: they see only threads
            they are part of and may reply once—or leave you on read. The GM
            sees recent exchanges to weave into the world.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-[10rem] flex-1">
              <label className="text-xs font-medium text-indigo-900 dark:text-indigo-200">
                To
              </label>
              <select
                className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-indigo-800 dark:bg-zinc-950 dark:text-zinc-100"
                value={diplomacyToId || otherNations[0]!.id}
                onChange={(e) => setDiplomacyToId(e.target.value)}
              >
                {otherNations.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 flex-[2]">
              <label className="text-xs font-medium text-indigo-900 dark:text-indigo-200">
                Message
              </label>
              <textarea
                className="mt-1 min-h-[4.5rem] w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-indigo-800 dark:bg-zinc-950 dark:text-zinc-100"
                value={diplomacyMessage}
                maxLength={MAX_DIPLOMACY_MESSAGE_LENGTH}
                onChange={(e) =>
                  setDiplomacyMessage(
                    e.target.value.slice(0, MAX_DIPLOMACY_MESSAGE_LENGTH),
                  )
                }
                placeholder="Envoys, back-channel asks, public communiqués, trial balloons…"
                spellCheck
              />
            </div>
            <button
              type="button"
              disabled={diplomacyBusy || !diplomacyMessage.trim()}
              className="shrink-0 rounded-lg bg-indigo-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-indigo-200 dark:text-indigo-950"
              onClick={() => void sendDiplomacy()}
            >
              {diplomacyBusy ? "…" : "Send"}
            </button>
          </div>
          {diplomacyError ? (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{diplomacyError}</p>
          ) : null}
          <p className="mt-1 text-[11px] text-indigo-900/70 dark:text-indigo-200/70">
            {diplomacyMessage.length}/{MAX_DIPLOMACY_MESSAGE_LENGTH} characters
          </p>

          {sortedDiplomacy.length > 0 ? (
            <ul className="mt-5 space-y-4 border-t border-indigo-200/60 pt-4 dark:border-indigo-800/50">
              {sortedDiplomacy.map((o) => {
                const fromName =
                  session.nations.find((n) => n.id === o.fromNationId)?.name ??
                  o.fromNationId;
                const toName =
                  session.nations.find((n) => n.id === o.toNationId)?.name ??
                  o.toNationId;
                const vid = session.viewerNationId;
                const iAmSender = vid === o.fromNationId;
                const iAmRecipient = vid === o.toNationId;
                return (
                  <li
                    key={o.id}
                    className="rounded-lg border border-indigo-100 bg-white/90 p-3 text-sm dark:border-indigo-900/50 dark:bg-zinc-950/80"
                  >
                    <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                      {new Date(o.at).toLocaleString()} ·{" "}
                      {iAmSender
                        ? `You → ${toName}`
                        : iAmRecipient
                          ? `${fromName} → you`
                          : `${fromName} → ${toName}`}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                      {o.message}
                    </p>
                    {o.reply ? (
                      <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50/80 px-3 py-2 text-xs dark:border-indigo-900/40 dark:bg-indigo-950/50">
                        <p className="font-medium text-indigo-900 dark:text-indigo-200">
                          {iAmRecipient ? "Your reply" : `${toName} replied`} ·{" "}
                          {new Date(o.reply.at).toLocaleString()}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                          {o.reply.text}
                        </p>
                      </div>
                    ) : iAmRecipient ? (
                      <div className="mt-3 space-y-2">
                        <textarea
                          className="min-h-[3.5rem] w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs dark:border-indigo-800 dark:bg-zinc-950"
                          placeholder="Optional reply (one per thread)…"
                          maxLength={MAX_DIPLOMACY_REPLY_LENGTH}
                          value={replyDraftById[o.id] ?? ""}
                          onChange={(e) =>
                            setReplyDraftById((prev) => ({
                              ...prev,
                              [o.id]: e.target.value.slice(
                                0,
                                MAX_DIPLOMACY_REPLY_LENGTH,
                              ),
                            }))
                          }
                          spellCheck
                        />
                        <button
                          type="button"
                          disabled={diplomacyBusy || !(replyDraftById[o.id] ?? "").trim()}
                          className="rounded-lg bg-indigo-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-indigo-300 dark:text-indigo-950"
                          onClick={() =>
                            void sendDiplomacyReply(
                              o.id,
                              replyDraftById[o.id] ?? "",
                            )
                          }
                        >
                          Send reply
                        </button>
                      </div>
                    ) : iAmSender ? (
                      <p className="mt-2 text-xs italic text-zinc-500 dark:text-zinc-400">
                        Awaiting their response (they may ignore this).
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 border-t border-indigo-200/60 pt-3 text-xs text-indigo-900/70 dark:border-indigo-800/50 dark:text-indigo-200/70">
              No threads yet — your sent and received outreach will appear here.
            </p>
          )}
        </section>
      ) : null}

      {session.gameStarted &&
      !waitingForTableOpen &&
      crisis &&
      !introDelivered &&
      urlToken &&
      myNation?.forgeComplete ? (
        <section className="rounded-2xl border border-amber-200/90 bg-gradient-to-b from-amber-50/95 to-white px-5 py-6 shadow-sm dark:border-amber-900/40 dark:from-amber-950/40 dark:to-zinc-950">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-900 dark:text-amber-200">
            You&apos;re in
          </p>
          <h2 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            {myNation.name}
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            The table is opening with a GM-written orientation to your forged
            nation — your stats and build below are what the sim locked in. The
            Year-1 crisis shows up right after this beat so you can answer it in
            plain language.
          </p>
          <div className="mt-4 ring-2 ring-amber-400/30 ring-offset-2 ring-offset-amber-50 dark:ring-amber-700/40 dark:ring-offset-zinc-950">
            <NationCard nation={myNation} />
          </div>
          {busy || session.phase === "gm_running" ? (
            <p className="mt-4 text-sm font-medium text-amber-950 dark:text-amber-100">
              {gmStreamText
                ? "Streaming your opening scene — scroll the blue banner above for live text."
                : "GM is drafting your opening scene…"}
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          {isOpeningBeatSeat && error ? (
            <button
              type="button"
              disabled={busy || session.phase === "gm_running"}
              className="mt-4 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-950 enabled:hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-zinc-950 dark:text-amber-100 dark:enabled:hover:bg-amber-950/40"
              onClick={() => {
                openingBeatAutoKeySent = "";
                void submitOpeningBrief();
              }}
            >
              Try opening again
            </button>
          ) : null}
          {!isOpeningBeatSeat ? (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              The active seat is opening the chronicle — this page will refresh
              with the GM&apos;s text shortly.
            </p>
          ) : null}
        </section>
      ) : null}

      {crisis && introDelivered ? (
        <section className="rounded-2xl border border-violet-200/80 bg-gradient-to-b from-violet-50/90 to-white px-5 py-5 shadow-sm dark:border-violet-900/40 dark:from-violet-950/40 dark:to-zinc-950">
          <p className="text-xs font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
            Year one — your move
          </p>
          <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-zinc-900 dark:text-zinc-100">
            {crisis.prompt}
          </p>
        </section>
      ) : null}

      {lastGmChapter ||
      gmStreamText ||
      (session.gameStarted && session.phase === "gm_running") ? (
        <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {gmStreamText || session.phase === "gm_running"
              ? "GM reply (live or latest)"
              : "Last GM reply"}
          </p>
          {gmStreamText ? (
            <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-zinc-900 dark:text-zinc-100">
              {gmStreamText}
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-zinc-500 align-bottom dark:bg-zinc-400" />
            </p>
          ) : lastGmChapter ? (
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
          ) : (
            <div className="mt-4 space-y-2" aria-busy="true">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Composing this beat — streamed text shows here on the browser
                that sent the turn; everyone else sees the paragraph when it
                lands.
              </p>
              <div className="space-y-2 rounded-lg border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/80">
                <div className="h-3 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                <div className="h-3 w-[92%] animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                <div className="h-3 w-[80%] animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
              </div>
            </div>
          )}
        </section>
      ) : (
        <p className="text-center text-sm text-zinc-500">
          {session.gameStarted && !waitingForTableOpen && crisis && !introDelivered
            ? "Your opening scene streams above when the GM finishes."
            : session.gameStarted
              ? "Write your beat below after the opening. Each send adds to the chronicle."
              : "Once every claimed nation finishes the 100-point forge, the chronicle opens here."}
        </p>
      )}

      {showTurnComposer ? (
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
              disabled={!session.nations.length}
            >
              {session.nations.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                  {!n.forgeComplete ? " (still forging)" : ""}
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
          className="mt-3 min-h-[min(50vh,22rem)] w-full resize-y rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base leading-relaxed text-zinc-900 shadow-inner outline-none ring-zinc-400 focus:border-zinc-500 focus:ring-2 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-500"
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          placeholder="The Steel Veil hums. The envoys wait in the rain. You speak, you move, you bluff—or you stay silent and let the city decide…"
          spellCheck
          disabled={!session.gameStarted || !povNation?.forgeComplete}
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
                      disabled={!session.gameStarted}
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
                disabled={!session.gameStarted}
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
                disabled={!session.gameStarted}
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
                disabled={!session.gameStarted}
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
                disabled={!session.gameStarted}
              />
            </div>
          </div>
        </details>

        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
        <button
          type="button"
          disabled={busy || !canSendTurn}
          className="mt-5 w-full rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white shadow disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          onClick={() => void submitTurn()}
        >
          {busy ? "GM is writing the next beat…" : "Send to GM"}
        </button>
      </section>
      ) : null}

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{nation.name}</h3>
        {!nation.forgeComplete ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Forging
          </span>
        ) : null}
      </div>
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
