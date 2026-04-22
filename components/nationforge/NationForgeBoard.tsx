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

import {
  assistantMessageIndicatesGmDelivery,
  gmThreadHasAssistantDelivery,
  lastAssistantTextProseFromMessages,
  textProseFromAssistantUiMessage,
} from "@/lib/nationforge/assistant-ui-prose";
import { consumeGmTextStream } from "@/lib/nationforge/consume-gm-stream";
import { buildOpeningBriefPlayerMessage } from "@/lib/nationforge/opening-brief-narrative";
import { playerTurnChatDisplayBody } from "@/lib/nationforge/player-input";
import type { PublicGameSession } from "@/lib/nationforge/public-types";
import {
  MAX_DIPLOMACY_MESSAGE_LENGTH,
  MAX_DIPLOMACY_REPLY_LENGTH,
  MAX_DOMESTIC_SCRATCH_LENGTH,
  STAT_KEYS,
  type DiplomaticOutreach,
  type Nation,
} from "@/lib/nationforge/schema";

import { NationForgeChatMarkdown } from "./NationForgeChatMarkdown";
import NationForgeWizard from "./NationForgeWizard";

function StatRibbon({ nation }: { nation: Nation }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-zinc-200/90 bg-white/80 px-2.5 py-1.5 text-[10px] tabular-nums dark:border-zinc-700 dark:bg-zinc-950/80"
      aria-label={`Stats for ${nation.name}`}
    >
      <span className="max-w-[8rem] truncate font-semibold text-zinc-800 dark:text-zinc-100">
        {nation.name}
      </span>
      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        r{nation.reserve}
      </span>
      {STAT_KEYS.map((k) => (
        <span
          key={k}
          className="rounded bg-zinc-50 px-1.5 py-0.5 capitalize text-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-300"
        >
          {k.slice(0, 3)} {nation.stats[k]}
        </span>
      ))}
    </div>
  );
}

function userMessageTextParts(m: UIMessage): string {
  return (
    m.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("") ?? ""
  );
}

const HOST_TOKENS_KEY = "nationforge-host-tokens";

/** Dedupes auto-opening GM beat (avoids Strict Mode double-invoke sending twice). */
let openingBeatAutoKeySent = "";
/** Prevents parallel opening-brief POSTs from the same browser. */
let openingBriefInFlight = false;
/** After benign errors / 429, pause auto-retry briefly (do not use openingBeatAutoKeySent for that). */
let openingBriefCooldownUntil = 0;

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
    m.includes("already queued") ||
    m.includes("send the opening twice") ||
    m.includes("opening or turn is already") ||
    m.includes("still writing") ||
    m.includes("still resolving") ||
    m.includes("still streaming") ||
    m.includes("wait for the gm") ||
    m.includes("gm is still")
  );
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
  /** Screen reader: announce each crisis id once (not on every poll). */
  const inflectionAnnouncedCrisisIdRef = useRef<string | null>(null);
  const [inflectionAriaNotice, setInflectionAriaNotice] = useState("");
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

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
    setSession((prev) => {
      if (prev && prev.id === data.id && prev.updatedAt === data.updatedAt) {
        return prev;
      }
      return data;
    });
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
  }, [load, pollMs, session?.phase]);

  const crisis = session?.crisis ?? null;

  const activeTurnSeatDisplay = useMemo(() => {
    const activeId = session?.activeNationId?.trim();
    if (!session || !activeId) {
      return { primary: "—", waitHint: "another seat" };
    }
    const inView = session.nations.find((n) => n.id === activeId);
    const name = inView?.name?.trim();
    if (name) {
      return { primary: name, waitHint: name };
    }
    return {
      primary: "Another player (finishing their nation builder)",
      waitHint: "another seat (nation forge still in progress)",
    };
  }, [session]);

  const crisisInvolvedNames = useMemo(() => {
    if (!session?.crisis?.activeNationIds?.length) return [];
    return session.crisis.activeNationIds
      .map((id) => session.nations.find((n) => n.id === id)?.name)
      .filter((name): name is string => Boolean(name));
  }, [session]);

  const lastGmChapter = useMemo(() => {
    if (!session?.gmMessages?.length) return "";
    return lastAssistantTextProseFromMessages(session.gmMessages);
  }, [session]);

  const gmBeatPersisted = useMemo(
    () => gmThreadHasAssistantDelivery(session?.gmMessages),
    [session?.gmMessages],
  );

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

  /** Seated forged players write only as their nation (single POV). */
  useEffect(() => {
    if (!session?.viewerNationId) return;
    if (!urlToken || !myNation?.forgeComplete) return;
    setPovNationId(session.viewerNationId);
  }, [session?.viewerNationId, urlToken, myNation?.forgeComplete]);

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

  /** Nation row for the wizard; default forgeProgress if the API row was incomplete. */
  const wizardNation = useMemo((): Nation | null => {
    if (!myNation || myNation.forgeComplete) return null;
    if (myNation.forgeProgress) return myNation;
    return {
      ...myNation,
      forgeProgress: {
        stepIndex: 0,
        selections: { demographicsAddons: [] },
        forgeWizardVersion: 2,
      },
    };
  }, [myNation]);

  const showWizard = Boolean(urlToken && wizardNation);

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

  /** First GM beat landed: GM chat text, live stream text, or completed GM tools. */
  const introDelivered = Boolean(
    lastGmChapter.trim().length > 0 ||
      gmStreamText.trim().length > 0 ||
      gmBeatPersisted,
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

  /** Crisis is on the table and seats may answer (not while GM is resolving). */
  const inflectionActive = Boolean(
    session?.gameStarted &&
      !waitingForTableOpen &&
      crisis &&
      introDelivered &&
      session.phase === "awaiting_decision",
  );

  useEffect(() => {
    if (!session?.crisis || !inflectionActive) {
      if (!session?.crisis) {
        inflectionAnnouncedCrisisIdRef.current = null;
        setInflectionAriaNotice("");
      }
      return;
    }
    const id = session.crisis.id;
    if (inflectionAnnouncedCrisisIdRef.current === id) return;
    inflectionAnnouncedCrisisIdRef.current = id;
    const p = session.crisis.prompt.trim();
    const clip = p.length > 160 ? `${p.slice(0, 160)}…` : p;
    setInflectionAriaNotice(`New inflection. ${clip}`);
  }, [session?.crisis, inflectionActive]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [
    session?.gmMessages?.length,
    session?.updatedAt,
    gmStreamText,
    inflectionActive,
    session?.crisis?.id,
  ]);

  const canSendTurn = useMemo(() => {
    if (!session?.gameStarted || !narrative.trim()) return false;
    if (!povNation?.forgeComplete) return false;
    if (session.phase === "gm_running") return false;
    return true;
  }, [session, narrative, povNation]);

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
        throw new Error(j.error ?? "Could not start nation forge");
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
        const wait = Math.ceil((j.retryAfterMs ?? 8000) / 1000);
        openingBriefCooldownUntil = Date.now() + (j.retryAfterMs ?? 8000);
        await load();
        setError(
          `Rate limited — wait ~${wait}s. The opening will auto-retry after that (or refresh once).`,
        );
        setGmStreamText("");
        return;
      }
      if (!res.ok) {
        const errText = await readFetchErrorBody(res);
        if (isBenignGmBusyError(errText)) {
          openingBriefCooldownUntil = Date.now() + 5000;
          await load();
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
    if (
      lastGmChapter.trim() ||
      gmStreamText.trim() ||
      gmThreadHasAssistantDelivery(session.gmMessages)
    ) {
      return;
    }
    if (session.phase === "gm_running") return;
    if (!session.viewerNationId || session.viewerNationId !== session.activeNationId) {
      return;
    }
    const dedupeKey = `${session.id}:${session.crisis.id}`;
    if (openingBeatAutoKeySent === dedupeKey) return;
    if (Date.now() < openingBriefCooldownUntil) return;
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
    session?.gmMessages,
    submitOpeningBrief,
  ]);

  if (!session) {
    return <div className="p-8 text-center text-sm text-zinc-500">Loading…</div>;
  }

  if (showWizard && wizardNation) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <Link href="/nationforge" className="text-xs text-blue-600 underline">
            All sessions
          </Link>
        </div>
        <div className="mx-auto max-w-3xl px-4 pt-5 pb-2">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Build your nation
          </h1>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            100-point forge — each pillar spends budget and locks stats for the
            table. Finish every step to join play.
          </p>
        </div>
        <NationForgeWizard
          sessionId={sessionId}
          token={urlToken!}
          nation={wizardNation}
          onDone={load}
        />
      </div>
    );
  }

  const seatPovLocked = Boolean(
    urlToken && session.viewerNationId && myNation?.forgeComplete,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
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
            Others start the nation forge with the room code (optional nickname
            until they name the nation). They appear as official table seats only
            after the builder is finished. Or use this link:
          </p>
          <div className="mt-2 font-mono break-all text-[11px]">
            {origin}/nationforge/join?code={session.roomCode}
          </div>
          {hostTokens ? (
            <ul className="mt-3 space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-700">
              <li className="font-medium text-amber-900 dark:text-amber-200">
                Seat tokens (host copy)
              </li>
              {(session.nationRoster ?? []).map((n) => (
                <li key={n.id} className="font-mono text-[10px] break-all">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {n.forgeComplete ? "At table" : "Building"} ·{" "}
                  </span>
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
            Active seat: {activeTurnSeatDisplay.primary}
          </p>
          {session.viewerNationId ? (
            <p className="mt-1 text-xs text-teal-900/90 dark:text-teal-100/85">
              {session.viewerNationId === session.activeNationId
                ? "You hold the active seat (opening beat or last POV sent to the GM)."
                : `Waiting while ${activeTurnSeatDisplay.waitHint} anchors the last beat.`}
            </p>
          ) : (
            <p className="mt-1 text-xs text-teal-900/85 dark:text-teal-100/80">
              Start the nation forge (join link) to see whether you hold this
              active seat once your nation is forged.
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
                  ? "This inflection highlights a single seat."
                  : "This inflection spans multiple seats — each nation answers from their own chat POV."}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {!urlToken ? (
        <section className="rounded-2xl border border-blue-200 bg-blue-50/80 px-5 py-5 dark:border-blue-900/50 dark:bg-blue-950/30">
          <h2 className="text-sm font-semibold text-blue-950 dark:text-blue-100">
            Join the table
          </h2>
          <p className="mt-2 text-sm text-blue-900/90 dark:text-blue-200/90">
            You are spectating without a seat token. Start the nation forge to
            run the 100-point builder — other players only see you as an official
            seat at the table after you finish and name your nation. Optional: a
            short nickname here labels your builder until then. You can join after
            others have started; your builder runs privately until you finish.
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
              {joinBusy ? "…" : "Start nation forge"}
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
          builder before the GM opens the table.
        </div>
      ) : null}

      <div className="space-y-6">
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
            The table is opening with a GM-written **First 50 Years** history,
            strengths and weaknesses, then the **first decisive event** (any year
            or flavor the GM chooses). Your stats and build below are what the
            sim locked in. You answer that first event in open prose once it
            appears in chat.
          </p>
          <div className="mt-4 ring-2 ring-amber-400/30 ring-offset-2 ring-offset-amber-50 dark:ring-amber-700/40 dark:ring-offset-zinc-950">
            <NationCard nation={myNation} isViewer />
          </div>
          {busy || session.phase === "gm_running" ? (
            <p className="mt-4 text-sm font-medium text-amber-950 dark:text-amber-100">
              {gmStreamText
                ? "Streaming your opening scene — live text appears in the chat above."
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
              The active seat is opening the session — this page will refresh
              with the GM&apos;s text shortly.
            </p>
          ) : null}
        </section>
      ) : null}

          {session.gameStarted && !waitingForTableOpen && introDelivered ? (
            <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/90">
              <h2 className="sr-only">NationForge chat</h2>
              <div
                className="max-h-[min(70vh,560px)] min-h-[260px] space-y-3 overflow-y-auto rounded-xl border border-zinc-200/80 bg-zinc-50/90 p-3 dark:border-zinc-700 dark:bg-zinc-900/50"
                role="log"
              >
                {session.gmMessages.length === 0 ? (
                  <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
                    Conversation with the GM will appear here.
                  </p>
                ) : null}
                {session.gmMessages.map((m, msgIndex) => {
                  const messageKey = `${msgIndex}-${
                    typeof m.id === "string" && m.id.trim().length > 0
                      ? m.id
                      : "no-id"
                  }`;
                  if (m.role === "user") {
                    const raw = userMessageTextParts(m);
                    const body = playerTurnChatDisplayBody(raw);
                    if (!body.trim()) return null;
                    return (
                      <div key={messageKey} className="flex justify-end">
                        <div className="max-w-[92%] rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm shadow-sm dark:border-zinc-600 dark:bg-zinc-950">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                            You
                          </p>
                          <div className="mt-1 text-zinc-900 dark:text-zinc-100">
                            <NationForgeChatMarkdown source={body} />
                          </div>
                        </div>
                      </div>
                    );
                  }
                  if (m.role === "assistant") {
                    const prose = textProseFromAssistantUiMessage(m);
                    const delivered = assistantMessageIndicatesGmDelivery(m);
                    if (!prose.trim() && !delivered) return null;
                    return (
                      <div key={messageKey} className="flex justify-start">
                        <div className="max-w-[92%] rounded-2xl border border-violet-200/90 bg-violet-50/70 px-4 py-2.5 text-sm dark:border-violet-800/50 dark:bg-violet-950/35">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
                            GM
                          </p>
                          {prose.trim() ? (
                            <div className="mt-1 text-zinc-900 dark:text-zinc-50">
                              <NationForgeChatMarkdown source={prose} />
                            </div>
                          ) : (
                            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                              Updated the table (stats, public log, or event).
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })}
                {inflectionActive && crisis ? (
                  <div className="flex justify-start">
                    <div className="max-w-[92%] rounded-2xl border border-amber-200/90 bg-amber-50/90 px-4 py-3 text-sm dark:border-amber-900/45 dark:bg-amber-950/35">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-900 dark:text-amber-200">
                        Inflection
                      </p>
                      <p className="mt-1 text-xs text-amber-950/90 dark:text-amber-100/90">
                        Describe what your nation does in the message box below —
                        any coherent action is valid.
                      </p>
                      {crisisInvolvedNames.length > 0 ? (
                        <p className="mt-2 text-[11px] font-medium text-amber-900 dark:text-amber-200">
                          Focus: {crisisInvolvedNames.join(", ")}
                        </p>
                      ) : null}
                      <div className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        <NationForgeChatMarkdown source={crisis.prompt} />
                      </div>
                    </div>
                  </div>
                ) : null}
                {gmComposing ? (
                  <div className="flex justify-start">
                    <div className="max-w-[92%] rounded-2xl border border-sky-200 bg-sky-50/90 px-4 py-3 text-sm dark:border-sky-800/60 dark:bg-sky-950/40">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-900 dark:text-sky-200">
                        GM · writing
                      </p>
                      {gmStreamText ? (
                        <div className="mt-1 text-xs leading-relaxed text-zinc-800 dark:text-zinc-200">
                          <NationForgeChatMarkdown source={gmStreamText} />
                          <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-sky-600 dark:bg-sky-400" />
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-sky-900/90 dark:text-sky-100/85">
                          Composing this beat…
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
                <div
                  className="sr-only"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {inflectionAriaNotice}
                </div>
                <div ref={transcriptEndRef} className="h-px w-full shrink-0" />
              </div>

              {showTurnComposer ? (
                <div className="space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                  {seatPovLocked && myNation ? (
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">
                      Writing as{" "}
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {myNation.name}
                      </span>
                    </p>
                  ) : (
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
                  )}
                  <div>
                    <label
                      htmlFor="nationforge-chat-message"
                      className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
                    >
                      Message
                    </label>
                    <p className="mt-1 text-xs text-zinc-500">
                      Describe what your nation does.{" "}
                      <span className="font-semibold">Markdown</span> in the
                      transcript renders for you, the GM, and inflection prompts (
                      <code className="rounded bg-zinc-200/80 px-0.5 dark:bg-zinc-700">
                        **bold**
                      </code>
                      , headings, lists, links).{" "}
                      <span className="font-semibold">Enter</span> starts a new
                      line; send with the button. Optional fields are under{" "}
                      <span className="font-semibold">More with this send</span>.
                    </p>
                    <textarea
                      id="nationforge-chat-message"
                      className="mt-2 min-h-[12rem] w-full resize-y rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base leading-relaxed text-zinc-900 shadow-inner outline-none ring-zinc-400 focus:border-zinc-500 focus:ring-2 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-500"
                      value={narrative}
                      onChange={(e) => setNarrative(e.target.value)}
                      placeholder="The envoys wait in the rain. You speak, you move, you bluff—or you stay silent…"
                      spellCheck
                      disabled={!session.gameStarted || !povNation?.forgeComplete}
                    />
                    {narrative.trim() ? (
                      <details className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50/90 dark:border-zinc-700 dark:bg-zinc-900/50">
                        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                          Preview formatted (Markdown)
                        </summary>
                        <div className="max-h-56 overflow-y-auto border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
                          <NationForgeChatMarkdown
                            source={narrative}
                            className="text-sm text-zinc-800 dark:text-zinc-200"
                          />
                        </div>
                      </details>
                    ) : null}
                  </div>
                  <details className="rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/40">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      More with this send (optional)
                    </summary>
                    <div className="space-y-4 border-t border-zinc-200 p-3 dark:border-zinc-700">
                      {urlToken && myNation?.forgeComplete ? (
                        <div>
                          <p className="text-[10px] font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                            Your seat
                          </p>
                          <div className="mt-2">
                            <StatRibbon nation={myNation} />
                          </div>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-medium text-blue-600 underline dark:text-blue-400">
                              Full nation sheet (stats &amp; forge log)
                            </summary>
                            <div className="mt-2">
                              <NationCard nation={myNation} isViewer />
                            </div>
                          </details>
                        </div>
                      ) : null}
                      <div>
                        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                          Governance notes (private, saved between sends)
                        </label>
                        <p className="mt-0.5 text-[11px] text-zinc-500">
                          Does not change stats by itself.
                        </p>
                        <textarea
                          className="mt-1 min-h-[5rem] w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-900 outline-none ring-zinc-400 focus:border-zinc-500 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500"
                          value={domesticDraft}
                          maxLength={MAX_DOMESTIC_SCRATCH_LENGTH}
                          onChange={(e) => {
                            const v = e.target.value.slice(
                              0,
                              MAX_DOMESTIC_SCRATCH_LENGTH,
                            );
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
                          placeholder="Domestic brief for the GM…"
                          spellCheck
                        />
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                          <span>
                            {domesticDraft.length}/{MAX_DOMESTIC_SCRATCH_LENGTH}
                          </span>
                          {domesticSaveState === "saving" ? (
                            <span className="text-zinc-600 dark:text-zinc-400">
                              Saving…
                            </span>
                          ) : null}
                          {domesticSaveState === "saved" ? (
                            <span className="text-emerald-700 dark:text-emerald-400">
                              Saved
                            </span>
                          ) : null}
                          {domesticSaveState === "error" && domesticSaveError ? (
                            <span className="text-red-600 dark:text-red-400">
                              {domesticSaveError}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                          Public diplomacy (with this send)
                        </label>
                        <textarea
                          className="mt-1 min-h-[3rem] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
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
                          className="mt-1 min-h-[3rem] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                          value={secretAction}
                          onChange={(e) => setSecretAction(e.target.value)}
                          placeholder="What stays off the wire…"
                          disabled={!session.gameStarted}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                          Stat / reserve asks (max 10 pts movement per nation)
                        </label>
                        <textarea
                          className="mt-1 min-h-[2.5rem] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                          value={reallocNotes}
                          onChange={(e) => setReallocNotes(e.target.value)}
                          placeholder="e.g. spend reserve on counter-intel…"
                          disabled={!session.gameStarted}
                        />
                      </div>
                    </div>
                  </details>
                  {error ? (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {error}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy || !canSendTurn}
                    className="w-full rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white shadow disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                    onClick={() => void submitTurn()}
                  >
                    {busy ? "GM is writing the next beat…" : "Send to GM"}
                  </button>
                </div>
              ) : null}
            </section>
          ) : session.gameStarted && !waitingForTableOpen ? (
            <p className="text-center text-sm text-zinc-500">
              {crisis && !introDelivered
                ? "Your opening scene appears in chat when the GM finishes."
                : "The table will open here once every seat finishes the forge."}
            </p>
          ) : null}

          <details className="rounded-xl border border-zinc-200 dark:border-zinc-700">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Session reference (log, secrets, roster, diplomacy)
            </summary>
            <div className="space-y-6 border-t border-zinc-100 p-4 dark:border-zinc-800">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Public beat log
                </h3>
                <ul className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
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
              </section>
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Secrets you may know
                </h3>
                <ul className="space-y-3 text-xs dark:border-zinc-800">
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
              </section>
              {session.gameStarted && session.emergentEvents.length > 0 ? (
                <section className="rounded-lg border border-amber-200/70 bg-amber-50/50 p-3 dark:border-amber-900/35 dark:bg-amber-950/25">
                  <h3 className="text-xs font-semibold uppercase text-amber-900 dark:text-amber-200">
                    World shocks (GM log)
                  </h3>
                  <p className="mt-1 text-xs text-amber-950/80 dark:text-amber-200/80">
                    External shocks — not tied to a single player&apos;s last move.
                  </p>
                  <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto text-xs">
                    {[...session.emergentEvents].reverse().map((ev) => (
                      <li
                        key={ev.id}
                        className="rounded-lg border border-amber-100/90 bg-white/80 px-2 py-2 dark:border-amber-900/40 dark:bg-zinc-950/60"
                      >
                        <p className="font-medium text-zinc-800 dark:text-zinc-100">
                          {ev.eventTitle}
                          {ev.severity ? (
                            <span className="ml-1 text-[10px] font-normal uppercase text-amber-800/80 dark:text-amber-300/90">
                              · {ev.severity}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {new Date(ev.at).toLocaleString()}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                          {ev.description}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {session.nationRoster.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                    Table roster ({session.nationRoster.length}{" "}
                    {session.nationRoster.length === 1 ? "seat" : "seats"})
                  </h3>
                  <ul className="space-y-2 text-sm text-zinc-800 dark:text-zinc-200">
                    {session.nationRoster.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span className="font-medium">{row.name}</span>
                        {!row.forgeComplete ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                            Forging
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            At table
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {urlToken && myNation?.forgeComplete ? (
                <section className="rounded-lg border border-indigo-200/90 bg-indigo-50/70 p-3 dark:border-indigo-900/40 dark:bg-indigo-950/35">
                  <h3 className="text-xs font-semibold uppercase text-indigo-900 dark:text-indigo-200">
                    Structured messages (optional)
                  </h3>
                  <p className="mt-1 text-xs text-indigo-950/85 dark:text-indigo-100/85">
                    Bilateral threads — only you and the other nation see a thread.
                  </p>
                  {otherNations.length > 0 ? (
                    <>
                      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
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
                            placeholder="Envoys, back-channel asks…"
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
                        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                          {diplomacyError}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-indigo-900/70 dark:text-indigo-200/70">
                        {diplomacyMessage.length}/{MAX_DIPLOMACY_MESSAGE_LENGTH} characters
                      </p>
                      {sortedDiplomacy.length > 0 ? (
                        <ul className="mt-4 space-y-4 border-t border-indigo-200/60 pt-4 dark:border-indigo-800/50">
                          {sortedDiplomacy.map((o) => {
                            const fromName =
                              session.nations.find((n) => n.id === o.fromNationId)
                                ?.name ?? o.fromNationId;
                            const toName =
                              session.nations.find((n) => n.id === o.toNationId)
                                ?.name ?? o.toNationId;
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
                                      {iAmRecipient ? "Your reply" : `${toName} replied`}{" "}
                                      · {new Date(o.reply.at).toLocaleString()}
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
                                      disabled={
                                        diplomacyBusy ||
                                        !(replyDraftById[o.id] ?? "").trim()
                                      }
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
                          No threads yet.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-indigo-900/80 dark:text-indigo-200/80">
                      When a second nation finishes the forge, bilateral threads unlock.
                    </p>
                  )}
                </section>
              ) : null}
            </div>
          </details>
      </div>
    </div>
  );
}

function NationCard({
  nation,
  isViewer,
  compact,
}: {
  nation: Nation;
  isViewer?: boolean;
  compact?: boolean;
}) {
  const entries = Object.entries(nation.stats) as [string, number][];
  return (
    <div
      className={`rounded-xl border p-4 dark:border-zinc-700 ${
        isViewer
          ? "border-teal-300/90 bg-teal-50/25 ring-2 ring-teal-400/20 dark:border-teal-800 dark:bg-teal-950/25 dark:ring-teal-500/15"
          : "border-zinc-200 bg-white dark:bg-zinc-950/40"
      } ${compact ? "!p-3" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={`font-semibold ${compact ? "text-sm" : ""}`}>
          {nation.name}
        </h3>
        {!nation.forgeComplete ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Forging
          </span>
        ) : isViewer ? (
          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-medium uppercase text-teal-900 dark:bg-teal-950 dark:text-teal-200">
            You
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-zinc-500">Reserve: {nation.reserve}</p>
      <dl
        className={`mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs ${compact ? "text-[11px]" : ""}`}
      >
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="capitalize text-zinc-500">{k}</dt>
            <dd className="font-mono font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {nation.buildNotes ? (
        <>
          <p
            className={`mb-1 mt-2 font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500 ${compact ? "text-[9px]" : "text-[10px]"}`}
          >
            {isViewer ? "Your forge log (public to table)" : "Public nation profile"}
          </p>
          <p
            className={`whitespace-pre-wrap text-zinc-600 dark:text-zinc-400 ${compact ? "line-clamp-4 text-[11px] leading-snug" : "text-xs"}`}
          >
            {nation.buildNotes}
          </p>
        </>
      ) : null}
    </div>
  );
}
