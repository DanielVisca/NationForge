"use client";

import type { UIMessage } from "ai";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { flushSync } from "react-dom";
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
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
import {
  chunkTextForTts,
  markdownishToSpeechText,
} from "@/lib/nationforge/markdown-ish-to-speech-text";
import { createNationForgeTtsQueue } from "@/lib/nationforge/tts-queue";
import {
  normalizeXaiTtsVoiceId,
  XAI_TTS_VOICES,
  type XaiTtsVoiceId,
} from "@/lib/nationforge/tts-voices";
import { consumeGmTextStream } from "@/lib/nationforge/consume-gm-stream";
import { buildOpeningBriefPlayerMessage } from "@/lib/nationforge/opening-brief-narrative";
import { playerTurnChatDisplayBody } from "@/lib/nationforge/player-input";
import type {
  PublicEmergentEvent,
  PublicGameSession,
  PublicTurnLogEntry,
} from "@/lib/nationforge/public-types";
import {
  clearNationForgeSeat,
  forgetNationForgeSession,
  readHostTokensForSession,
  readLastNationForgeSeat,
  readNationForgeEnrollment,
  rememberNationForgeSeat,
} from "@/lib/nationforge/seat-token-cache";
import {
  MAX_DIPLOMACY_MESSAGE_LENGTH,
  MAX_DOMESTIC_SCRATCH_LENGTH,
  STAT_KEYS,
  type DiplomaticOutreach,
  type Nation,
  type NationStats,
  type StatImpactRecord,
  type StatKey,
} from "@/lib/nationforge/schema";

import { NationForgeChatMarkdown } from "./NationForgeChatMarkdown";
import NationForgeWizard from "./NationForgeWizard";

const NATIONFORGE_TTS_LS = "nationforge-tts-enabled";
const NATIONFORGE_TTS_VOICE_LS = "nationforge-tts-voice";

function initialTtsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(NATIONFORGE_TTS_LS) === "1";
  } catch {
    return false;
  }
}

function initialTtsVoiceId(): XaiTtsVoiceId {
  if (typeof window === "undefined") return "eve";
  try {
    const voiceRaw = localStorage.getItem(NATIONFORGE_TTS_VOICE_LS);
    return voiceRaw ? normalizeXaiTtsVoiceId(voiceRaw) : "eve";
  } catch {
    return "eve";
  }
}

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

function statLabel(key: StatKey): string {
  return key[0]!.toUpperCase() + key.slice(1);
}

function signedNumber(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function DeltaBadge({ value }: { value?: number }) {
  if (value == null || value === 0 || Number.isNaN(value)) {
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
        no change
      </span>
    );
  }
  const positive = value > 0;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        positive
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
      }`}
    >
      {signedNumber(value)}
    </span>
  );
}

function formatImpactSummary(impact: StatImpactRecord): string {
  const parts: string[] = [];
  if (impact.reserveDelta != null && impact.reserveDelta !== 0) {
    parts.push(`Reserve ${signedNumber(impact.reserveDelta)}`);
  }
  for (const k of STAT_KEYS) {
    const d = impact.deltas[k];
    if (d != null && d !== 0) parts.push(`${statLabel(k)} ${signedNumber(d)}`);
  }
  return parts.length ? parts.join(" · ") : "Numbers updated this beat.";
}

function finiteStatRound(roundIndex: number | undefined): number {
  return typeof roundIndex === "number" && Number.isFinite(roundIndex)
    ? roundIndex
    : 0;
}

/** Avoid skipping poll payloads when updatedAt collides but stats/impacts moved. */
function playSnapshotForPollDedupe(s: PublicGameSession): string {
  const vid = s.viewerNationId;
  const vn = vid ? s.nations.find((n) => n.id === vid) : undefined;
  const statsKey =
    vn != null
      ? `${STAT_KEYS.map((k) => vn.stats[k]).join(",")};${vn.reserve}`
      : "";
  const impactsTail = (s.statImpacts ?? [])
    .slice(-24)
    .map((i) => `${i.id}:${i.nationId}:${finiteStatRound(i.roundIndex)}`)
    .join(";");
  const gm = s.gmMessages ?? [];
  const gmRev = gm.length
    ? `${gm.length}:${typeof gm.at(-1)?.id === "string" ? gm.at(-1)!.id : ""}`
    : "0:";
  const rosterForge = (s.nationRoster ?? [])
    .map((r) => `${r.id}:${r.forgeComplete ? 1 : 0}`)
    .join(",");
  const streaming = (s.gmStreamingNationIds ?? []).join(",");
  const life = `${s.gameStarted ? 1 : 0}|${s.phase}|${s.crisis?.id ?? ""}|${s.activeNationId ?? ""}|${rosterForge}|${streaming}`;
  return `${s.updatedAt}|${life}|${statsKey}|${impactsTail}|${gmRev}`;
}

function aggregateLatestImpact(
  impacts: StatImpactRecord[],
  nationId: string,
  sessionRoundIndex?: number,
): StatImpactRecord | null {
  const mine = impacts.filter((impact) => impact.nationId === nationId);
  if (mine.length === 0) return null;

  const thisSessionRound =
    typeof sessionRoundIndex === "number" &&
    Number.isFinite(sessionRoundIndex)
      ? mine.filter(
          (impact) => finiteStatRound(impact.roundIndex) === sessionRoundIndex,
        )
      : [];

  const maxRound = Math.max(...mine.map((i) => finiteStatRound(i.roundIndex)));
  const latestRoundMine = mine.filter(
    (impact) => finiteStatRound(impact.roundIndex) === maxRound,
  );

  const latest =
    thisSessionRound.length > 0
      ? thisSessionRound
      : latestRoundMine.length > 0
        ? latestRoundMine
        : mine;

  const deltas = Object.fromEntries(
    STAT_KEYS.map((key) => [
      key,
      latest.reduce((sum, impact) => sum + (impact.deltas[key] ?? 0), 0),
    ]).filter(([, value]) => value !== 0),
  ) as Partial<Record<StatKey, number>>;
  const reserveDelta = latest.reduce(
    (sum, impact) => sum + (impact.reserveDelta ?? 0),
    0,
  );
  const newest = latest.reduce((a, b) =>
    Date.parse(a.at) >= Date.parse(b.at) ? a : b,
  );
  const displayRound =
    thisSessionRound.length > 0
      ? finiteStatRound(sessionRoundIndex)
      : maxRound;
  return {
    id: newest.id,
    at: newest.at,
    roundIndex: displayRound,
    nationId,
    deltas,
    reserveDelta,
  };
}

/** Collapsible stat line + detail grid above the turn composer. */
function ChatComposerStatsBanner({
  nation,
  latestImpact,
}: {
  nation: Nation;
  latestImpact: StatImpactRecord | null;
}) {
  const collapsed = (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] leading-snug text-zinc-700 dark:text-zinc-200">
      <span className="shrink-0">
        <span className="font-medium text-zinc-500 dark:text-zinc-400">
          Reserve{" "}
        </span>
        <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {nation.reserve}
        </span>
      </span>
      {STAT_KEYS.map((key) => (
        <span key={key} className="shrink-0">
          <span className="font-medium text-zinc-500 dark:text-zinc-400">
            {statLabel(key)}{" "}
          </span>
          <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {nation.stats[key]}
          </span>
        </span>
      ))}
    </span>
  );

  return (
    <details
      className="nationforge-composer-stats group rounded-lg border border-zinc-200/90 bg-zinc-50/90 text-left dark:border-zinc-600 dark:bg-zinc-900/70"
      aria-label={`${nation.name} — stats snapshot (expand for deltas)`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1 [&::-webkit-details-marker]:hidden">
        <svg
          className="size-3 shrink-0 text-zinc-400 transition-transform group-open:rotate-90 dark:text-zinc-500"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden
        >
          <path d="M4 2 L9 6 L4 10 Z" />
        </svg>
        <div className="min-w-0 flex-1 leading-tight">{collapsed}</div>
        <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Stats
        </span>
      </summary>
      <div className="max-h-44 overflow-y-auto border-t border-zinc-200/80 px-2 py-2 dark:border-zinc-700/80">
        <p className="mb-2 truncate text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">
          {nation.name}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-md border border-zinc-200/80 bg-white/80 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950/60">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                Reserve
              </span>
              <DeltaBadge value={latestImpact?.reserveDelta} />
            </div>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {nation.reserve}
            </p>
          </div>
          {STAT_KEYS.map((key) => (
            <div
              key={key}
              className="rounded-md border border-zinc-200/80 bg-white/80 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950/60"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                  {statLabel(key)}
                </span>
                <DeltaBadge value={latestImpact?.deltas[key]} />
              </div>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {nation.stats[key]}
              </p>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function nationIdentityFromBuildNotes(buildNotes: string): {
  government: string | null;
  summary: string;
} {
  const trimmed = buildNotes.trim();
  if (!trimmed) {
    return {
      government: null,
      summary:
        "Finish the nation forge to lock in a public build profile the table and GM can read.",
    };
  }
  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  const govLine = lines.find((l) => /^Government:/i.test(l));
  const government = govLine
    ? govLine.replace(/^Government:\s*/i, "").trim()
    : null;
  const econLine = lines.find((l) => /^Economy:/i.test(l));
  const laborLine = lines.find((l) => /^Labor/i.test(l));
  const milLine = lines.find((l) => /^Military:/i.test(l));
  const econ = econLine?.replace(/^Economy:\s*/i, "").trim() ?? "";
  const labor = laborLine?.replace(/^Labor[^:]*:\s*/i, "").trim() ?? "";
  const military = milLine?.replace(/^Military:\s*/i, "").trim() ?? "";
  const bits = [econ, labor, military].filter(Boolean);
  const summary =
    bits.join(" · ").slice(0, 320) ||
    lines.slice(1, 5).join(" ").slice(0, 320);
  return {
    government,
    summary: summary || "Nation forge picks are in Session reference.",
  };
}

function PlayNationChatIdentity({ nation }: { nation: Nation }) {
  const { government, summary } = nationIdentityFromBuildNotes(
    nation.buildNotes ?? "",
  );
  return (
    <div className="rounded-xl border border-zinc-200/85 bg-zinc-50/95 px-4 py-3 dark:border-zinc-600 dark:bg-zinc-900/75">
      <h2 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
        {nation.name}
      </h2>
      {government ? (
        <p className="mt-1.5 text-sm text-zinc-800 dark:text-zinc-100">
          <span className="font-medium text-zinc-500 dark:text-zinc-400">
            Government:{" "}
          </span>
          <span className="font-semibold text-violet-900 dark:text-violet-200">
            {government}
          </span>
        </p>
      ) : null}
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-600 line-clamp-4 dark:text-zinc-400">
        {summary}
      </p>
    </div>
  );
}

type StatDeltaFloat = { id: string; key: StatKey | "reserve"; delta: number };

function StatMicroChip({
  label,
  short,
  value,
  floaters,
}: {
  label: string;
  short: string;
  value: number;
  floaters: StatDeltaFloat[];
}) {
  return (
    <div className="relative min-w-[3.25rem] flex-1 basis-[3.25rem] rounded-md border border-zinc-200/80 bg-white/90 px-1.5 pb-1 pt-1.5 text-center dark:border-zinc-700 dark:bg-zinc-950/55">
      {floaters.map((t) => (
        <span
          key={t.id}
          className={`nationforge-stat-delta-float pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold tabular-nums ${
            t.delta > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {signedNumber(t.delta)}
        </span>
      ))}
      <span
        className="block truncate text-[8px] font-semibold uppercase tracking-wide text-zinc-400 capitalize dark:text-zinc-500"
        title={label}
      >
        {short}
      </span>
      <span className="mt-0.5 block text-sm font-bold tabular-nums text-zinc-950 dark:text-zinc-50">
        {value}
      </span>
    </div>
  );
}

function PlayAnimatedStatStrip({ nation }: { nation: Nation }) {
  const [floats, setFloats] = useState<StatDeltaFloat[]>([]);
  const prevSnapRef = useRef<string | null>(null);

  const snap = `${nation.reserve}|${STAT_KEYS.map((k) => nation.stats[k]).join("|")}`;

  useEffect(() => {
    const prev = prevSnapRef.current;
    prevSnapRef.current = snap;
    if (prev === null) return;
    if (prev === snap) return;

    const parseSnap = (s: string) => {
      const parts = s.split("|").map(Number);
      const reserve = parts[0] ?? 0;
      const stats = Object.fromEntries(
        STAT_KEYS.map((k, i) => [k, parts[i + 1] ?? 0]),
      ) as NationStats;
      return { reserve, stats };
    };

    const p = parseSnap(prev);
    const n = parseSnap(snap);
    const next: StatDeltaFloat[] = [];
    if (p.reserve !== n.reserve) {
      next.push({
        id: `reserve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        key: "reserve",
        delta: n.reserve - p.reserve,
      });
    }
    for (const k of STAT_KEYS) {
      if (p.stats[k] !== n.stats[k]) {
        next.push({
          id: `${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          key: k,
          delta: n.stats[k] - p.stats[k],
        });
      }
    }
    if (next.length === 0) return;

    setFloats((f) => [...f, ...next]);
    const timers = next.map((tok) =>
      setTimeout(() => {
        setFloats((f) => f.filter((x) => x.id !== tok.id));
      }, 2000),
    );
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [snap]);

  const floatsFor = (key: StatKey | "reserve") =>
    floats.filter((f) => f.key === key);

  return (
    <div
      className="flex flex-wrap gap-1.5"
      aria-label="Reserve and key stats — totals update when the GM applies changes"
    >
      <StatMicroChip
        label="Reserve"
        short="res"
        value={nation.reserve}
        floaters={floatsFor("reserve")}
      />
      {STAT_KEYS.map((k) => (
        <StatMicroChip
          key={k}
          label={statLabel(k)}
          short={k.slice(0, 3)}
          value={nation.stats[k]}
          floaters={floatsFor(k)}
        />
      ))}
    </div>
  );
}

type TimelineItem = {
  id: string;
  at: number;
  eyebrow: string;
  title: string;
  body: string;
  privateText?: string;
};

function clipTimelineText(text: string, max = 170): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

function NationForgeTimeline({
  turnLog,
  emergentEvents,
  roundIndex,
}: {
  turnLog: PublicTurnLogEntry[];
  emergentEvents: PublicEmergentEvent[];
  roundIndex: number;
}) {
  const items = useMemo<TimelineItem[]>(() => {
    const beats: TimelineItem[] = turnLog.map((entry) => ({
      id: `turn-${entry.id}`,
      at: Date.parse(entry.at),
      eyebrow: new Date(entry.at).toLocaleDateString(),
      title: "Public beat",
      body: entry.publicSummary,
      privateText: entry.privateText,
    }));
    const shocks: TimelineItem[] = emergentEvents.map((event) => ({
      id: `event-${event.id}`,
      at: Date.parse(event.at),
      eyebrow: event.severity ? event.severity : "World event",
      title: event.eventTitle,
      body: event.description,
    }));
    return [...beats, ...shocks]
      .sort((a, b) => a.at - b.at)
      .slice(-6);
  }, [turnLog, emergentEvents]);

  const latest = items[items.length - 1] ?? null;

  return (
    <details className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900/90">
      <summary className="cursor-pointer list-none px-4 py-3 marker:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Timeline
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {latest
                ? `${latest.title}: ${clipTimelineText(latest.body, 110)}`
                : "No public events logged yet."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
              Round {roundIndex}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
              expand
            </span>
          </div>
        </div>
      </summary>
      {items.length > 0 ? (
        <ol className="mx-4 mb-4 space-y-3 border-l border-zinc-200 pl-4 dark:border-zinc-700">
          {items.map((item) => (
            <li key={item.id} className="relative">
              <span
                className="absolute -left-[1.35rem] top-1 size-2.5 rounded-full border-2 border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
                aria-hidden="true"
              />
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                {item.eyebrow}
              </p>
              <p className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {item.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                {clipTimelineText(item.body)}
              </p>
              {item.privateText ? (
                <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-950 dark:border-amber-900/45 dark:bg-amber-950/35 dark:text-amber-100">
                  Private to you: {clipTimelineText(item.privateText, 140)}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </details>
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

export default function NationForgeBoard() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;
  const searchParams = useSearchParams();
  const nextSearchToken = searchParams.get("token");
  /** Next `useSearchParams` can lag `router.replace` and the address bar; fall back to `location.search`. */
  const resolvedUrlToken = useMemo(() => {
    if (nextSearchToken) return nextSearchToken;
    if (typeof window === "undefined") return null;
    const fromBar = new URLSearchParams(window.location.search).get("token");
    return fromBar && fromBar.trim().length > 0 ? fromBar : null;
  }, [nextSearchToken]);
  /** `router.replace(?token=)` can lag behind `useSearchParams` in the same tab; hold token until URL catches up. */
  const [seatTokenBridge, setSeatTokenBridge] = useState<string | null>(null);
  const seatToken = resolvedUrlToken ?? seatTokenBridge;

  useEffect(() => {
    if (resolvedUrlToken) {
      startTransition(() => {
        setSeatTokenBridge(null);
      });
    }
  }, [resolvedUrlToken]);

  const prevSessionIdRef = useRef<string | null>(null);
  const autoRestoreReplaceRef = useRef(false);
  useLayoutEffect(() => {
    const prev = prevSessionIdRef.current;
    if (prev !== null && prev !== sessionId) {
      autoRestoreReplaceRef.current = false;
      flushSync(() => setSeatTokenBridge(null));
    }
    prevSessionIdRef.current = sessionId;

    if (resolvedUrlToken) return;

    const seat = readLastNationForgeSeat(sessionId);
    if (!seat?.token) return;

    flushSync(() => setSeatTokenBridge(seat.token));
    if (!autoRestoreReplaceRef.current) {
      autoRestoreReplaceRef.current = true;
      router.replace(
        `/nationforge/${sessionId}?token=${encodeURIComponent(seat.token)}`,
      );
    }
  }, [sessionId, resolvedUrlToken, router]);

  const [session, setSession] = useState<PublicGameSession | null>(null);
  const sessionRef = useRef<PublicGameSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const [sessionNotFound, setSessionNotFound] = useState(false);
  const [sessionBootstrapError, setSessionBootstrapError] = useState<
    string | null
  >(null);
  const [hostTokens] = useState<Record<string, string> | null>(() =>
    readHostTokensForSession(sessionId),
  );
  const [savedSeat, setSavedSeat] = useState<{
    nationId: string;
    nationName?: string;
  } | null>(() => {
    const e = readNationForgeEnrollment(sessionId);
    return e ? { nationId: e.nationId, nationName: e.nationName } : null;
  });
  const [gmStreamText, setGmStreamText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [povNationId, setPovNationId] = useState("");
  const [narrative, setNarrative] = useState("");

  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [ttsEnabled, setTtsEnabled] = useState(initialTtsEnabled);
  const [ttsVoiceId, setTtsVoiceId] =
    useState<XaiTtsVoiceId>(initialTtsVoiceId);
  const ttsVoiceIdRef = useRef<XaiTtsVoiceId>("eve");
  const ttsQueueRef = useRef<ReturnType<typeof createNationForgeTtsQueue> | null>(
    null,
  );
  const ttsPrimedRef = useRef(false);
  const ttsSeenKeysRef = useRef<Set<string>>(new Set());
  const ttsSessionBoundRef = useRef<string | null>(null);
  const getTtsQueue = useCallback(() => {
    if (!ttsQueueRef.current) {
      ttsQueueRef.current = createNationForgeTtsQueue(
        () => ttsVoiceIdRef.current,
      );
    }
    return ttsQueueRef.current;
  }, []);

  useEffect(() => {
    ttsVoiceIdRef.current = ttsVoiceId;
  }, [ttsVoiceId]);

  const [domesticDraft, setDomesticDraft] = useState("");
  const [domesticSaveState, setDomesticSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [domesticSaveError, setDomesticSaveError] = useState<string | null>(null);
  const domesticDirtyRef = useRef(false);
  const domesticDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const [diplomacyToId, setDiplomacyToId] = useState("");
  const [diplomacyMessage, setDiplomacyMessage] = useState("");
  const [diplomacyBusy, setDiplomacyBusy] = useState(false);
  const [diplomacyError, setDiplomacyError] = useState<string | null>(null);
  const [replyDraftById, setReplyDraftById] = useState<Record<string, string>>({});

  const peerJoinForgedInitializedRef = useRef(false);
  const peerJoinPrevForgedRef = useRef<Set<string>>(new Set());
  const [peerJoinNotice, setPeerJoinNotice] = useState<{ name: string } | null>(
    null,
  );

  useEffect(() => {
    peerJoinForgedInitializedRef.current = false;
    peerJoinPrevForgedRef.current = new Set();
    setPeerJoinNotice(null);
    setSessionNotFound(false);
    setSessionBootstrapError(null);
  }, [sessionId]);

  const lastSeenStatImpactIdRef = useRef<string | null | undefined>(undefined);
  const [statPanelPulse, setStatPanelPulse] = useState(false);
  const [impactBannerImpact, setImpactBannerImpact] =
    useState<StatImpactRecord | null>(null);
  const impactBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const token = seatToken ?? "";
    let res: Response;
    try {
      res = await fetch(
        `/api/nationforge/sessions/${sessionId}${token ? `?token=${encodeURIComponent(token)}` : ""}`,
        { cache: "no-store" },
      );
    } catch {
      if (sessionRef.current == null) {
        setSessionBootstrapError("Could not reach the server.");
      }
      return;
    }
    if (res.status === 404) {
      clearNationForgeSeat(sessionId);
      setSeatTokenBridge(null);
      setSession(null);
      setSessionNotFound(true);
      setSessionBootstrapError(null);
      return;
    }
    if (!res.ok) {
      if (sessionRef.current == null) {
        setSessionBootstrapError(
          `Session request failed (HTTP ${res.status}).`,
        );
      }
      return;
    }
    let data: PublicGameSession;
    try {
      data = (await res.json()) as PublicGameSession;
    } catch {
      if (sessionRef.current == null) {
        setSessionBootstrapError("Invalid response from server.");
      }
      return;
    }
    setSessionNotFound(false);
    setSessionBootstrapError(null);
    if (token.trim() && data.viewerNationId == null) {
      clearNationForgeSeat(sessionId);
      setSavedSeat(null);
      setSeatTokenBridge(null);
      if (resolvedUrlToken) {
        router.replace(`/nationforge/${sessionId}`);
      }
    }
    if (token.trim() && data.viewerNationId) {
      const viewerNation = data.nations.find((n) => n.id === data.viewerNationId);
      rememberNationForgeSeat(sessionId, data.viewerNationId, token, {
        roomCode: data.roomCode,
        nationName: viewerNation?.name,
      });
      setSavedSeat({
        nationId: data.viewerNationId,
        nationName: viewerNation?.name,
      });
    }
    setSession((prev) => {
      const prevSnap = prev ? playSnapshotForPollDedupe(prev) : null;
      const nextSnap = playSnapshotForPollDedupe(data);
      if (
        prev &&
        prev.id === data.id &&
        prevSnap === nextSnap
      ) {
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
  }, [sessionId, seatToken, resolvedUrlToken, router]);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  const anyGmStreaming = useMemo(
    () => (session?.gmStreamingNationIds?.length ?? 0) > 0,
    [session?.gmStreamingNationIds],
  );

  const viewerGmStreaming = useMemo(() => {
    const vid = session?.viewerNationId;
    if (!vid) return false;
    return Boolean(session.gmStreamingNationIds?.includes(vid));
  }, [session?.viewerNationId, session?.gmStreamingNationIds]);

  const pollMs = anyGmStreaming ? POLL_MS_GM_RUNNING : POLL_MS;

  useEffect(() => {
    if (!session?.gameStarted || !session.viewerNationId) return;
    const forged = new Set(
      session.nationRoster.filter((r) => r.forgeComplete).map((r) => r.id),
    );
    const prev = peerJoinPrevForgedRef.current;
    if (peerJoinForgedInitializedRef.current) {
      for (const id of forged) {
        if (!prev.has(id) && id !== session.viewerNationId) {
          const name =
            session.nations.find((n) => n.id === id)?.name ??
            session.nationRoster.find((r) => r.id === id)?.name ??
            "Another nation";
          setPeerJoinNotice({ name });
          break;
        }
      }
    } else {
      peerJoinForgedInitializedRef.current = true;
    }
    peerJoinPrevForgedRef.current = forged;
  }, [session]);

  useEffect(() => {
    const t = setInterval(() => {
      startTransition(() => {
        void load();
      });
    }, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

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

  const myLatestStatImpact = useMemo(() => {
    if (!session || !myNation) return null;
    return aggregateLatestImpact(
      session.statImpacts,
      myNation.id,
      session.roundIndex,
    );
  }, [session, myNation]);

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

  const unreadDiplomacyCount = useMemo(() => {
    if (!session?.viewerNationId || !sortedDiplomacy.length) return 0;
    const vid = session.viewerNationId;
    return sortedDiplomacy.filter((o) => {
      if (vid !== o.toNationId) return false;
      const draft = (replyDraftById[o.id] ?? "").trim();
      if (draft) return false;
      const last = o.messages.at(-1);
      if (!last) return false;
      return last.fromNationId !== vid;
    }).length;
  }, [sortedDiplomacy, session?.viewerNationId, replyDraftById]);

  useEffect(() => {
    if (!otherNations.length) return;
    if (!diplomacyToId || !otherNations.some((n) => n.id === diplomacyToId)) {
      startTransition(() => {
        setDiplomacyToId(otherNations[0]!.id);
      });
    }
  }, [otherNations, diplomacyToId]);

  /** Seated forged players write only as their nation (single POV). */
  useEffect(() => {
    const viewerNationId = session?.viewerNationId;
    if (!viewerNationId) return;
    if (!seatToken || !myNation?.forgeComplete) return;
    startTransition(() => {
      setPovNationId(viewerNationId);
    });
  }, [session?.viewerNationId, seatToken, myNation?.forgeComplete]);

  useEffect(() => {
    domesticDirtyRef.current = false;
  }, [seatToken, session?.viewerNationId]);

  useEffect(() => {
    if (!myNation) return;
    if (!domesticDirtyRef.current) {
      startTransition(() => {
        setDomesticDraft(myNation.domesticScratch ?? "");
      });
    }
  }, [myNation]);

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

  const showWizard = Boolean(seatToken && wizardNation);

  const povNation = useMemo(
    () => session?.nations.find((n) => n.id === povNationId),
    [session, povNationId],
  );

  const waitingForTableOpen = Boolean(
    session &&
      seatToken &&
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
      introDelivered &&
      seatToken &&
      session.viewerNationId &&
      myNation?.forgeComplete,
  );

  const usePlayGrid = Boolean(
    session?.gameStarted && introDelivered && myNation?.forgeComplete,
  );

  /** Forged viewer in the opening card: retry / copy applies to this seat’s thread. */
  const isViewerForgedOpeningSeat = Boolean(
    session &&
      seatToken &&
      session.viewerNationId &&
      myNation?.forgeComplete,
  );

  const gmComposing = Boolean(
    session?.gameStarted &&
      (viewerGmStreaming || busy || gmStreamText.length > 0),
  );

  useLayoutEffect(() => {
    lastSeenStatImpactIdRef.current = undefined;
  }, [sessionId]);

  useEffect(() => {
    return () => {
      if (impactBannerTimerRef.current) {
        clearTimeout(impactBannerTimerRef.current);
        impactBannerTimerRef.current = null;
      }
      if (statPulseTimerRef.current) {
        clearTimeout(statPulseTimerRef.current);
        statPulseTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!session?.gameStarted || !myNation?.forgeComplete) return;
    const impact = myLatestStatImpact;
    const id = impact?.id ?? null;
    if (lastSeenStatImpactIdRef.current === undefined) {
      lastSeenStatImpactIdRef.current = id;
      return;
    }
    if (id !== null && id !== lastSeenStatImpactIdRef.current) {
      lastSeenStatImpactIdRef.current = id;
      setStatPanelPulse(true);
      setImpactBannerImpact(impact);
      if (statPulseTimerRef.current) clearTimeout(statPulseTimerRef.current);
      statPulseTimerRef.current = setTimeout(() => {
        setStatPanelPulse(false);
        statPulseTimerRef.current = null;
      }, 2200);
      if (impactBannerTimerRef.current) clearTimeout(impactBannerTimerRef.current);
      impactBannerTimerRef.current = setTimeout(() => {
        setImpactBannerImpact(null);
        impactBannerTimerRef.current = null;
      }, 12000);
    }
  }, [
    session?.gameStarted,
    myNation?.forgeComplete,
    myLatestStatImpact?.id,
    myLatestStatImpact,
  ]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [
    session?.gmMessages?.length,
    session?.updatedAt,
    gmStreamText,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(NATIONFORGE_TTS_LS, ttsEnabled ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [ttsEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(NATIONFORGE_TTS_VOICE_LS, ttsVoiceId);
    } catch {
      /* ignore */
    }
  }, [ttsVoiceId]);

  useEffect(() => {
    return () => {
      ttsQueueRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!ttsEnabled) {
      ttsPrimedRef.current = false;
      ttsSessionBoundRef.current = null;
      ttsSeenKeysRef.current = new Set();
      ttsQueueRef.current?.clear();
      return;
    }
    if (ttsSessionBoundRef.current !== sessionId) {
      ttsSessionBoundRef.current = sessionId;
      ttsPrimedRef.current = false;
      ttsSeenKeysRef.current = new Set();
      ttsQueueRef.current?.clear();
    }
    if (!session) return;

    if (!ttsPrimedRef.current) {
      const nextSeen = new Set<string>();
      session.gmMessages.forEach((m, i) => {
        if (m.role !== "assistant") return;
        if (!textProseFromAssistantUiMessage(m).trim()) return;
        const id = typeof m.id === "string" && m.id ? m.id : `i-${i}`;
        nextSeen.add(`gm:${id}`);
      });
      ttsSeenKeysRef.current = nextSeen;
      ttsPrimedRef.current = true;
      return;
    }

    const q = getTtsQueue();
    session.gmMessages.forEach((m, i) => {
      if (m.role !== "assistant") return;
      const prose = textProseFromAssistantUiMessage(m).trim();
      if (!prose) return;
      const id = typeof m.id === "string" && m.id ? m.id : `i-${i}`;
      const key = `gm:${id}`;
      if (ttsSeenKeysRef.current.has(key)) return;
      ttsSeenKeysRef.current.add(key);
      const plain = markdownishToSpeechText(prose);
      const gmChunks = chunkTextForTts(plain);
      for (const chunk of gmChunks) {
        q.enqueue(chunk);
      }
    });

  }, [
    ttsEnabled,
    sessionId,
    session,
    session?.updatedAt,
    getTtsQueue,
  ]);

  const canSendTurn = useMemo(() => {
    if (!session?.gameStarted || !narrative.trim()) return false;
    if (!povNation?.forgeComplete) return false;
    if (viewerGmStreaming) return false;
    return true;
  }, [session, narrative, povNation, viewerGmStreaming]);

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
        roomCode: session.roomCode,
        nationName: data.name,
      });
      setSavedSeat({ nationId: data.nationId, nationName: data.name });
      setSeatTokenBridge(data.token);
      router.replace(
        `/nationforge/${data.sessionId}?token=${encodeURIComponent(data.token)}`,
      );
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : "Failed");
    } finally {
      setJoinBusy(false);
    }
  }, [session, router]);

  const submitTurn = useCallback(async () => {
    if (!sessionId) return;
    if (!seatToken) {
      setError("Join with your seat token before sending moves.");
      return;
    }
    setBusy(true);
    setError(null);
    setGmStreamText("");
    try {
      const res = await fetch("/api/nationforge/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          token: seatToken,
          povNationId,
          narrative,
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
      await load();
      setGmStreamText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, [
    sessionId,
    seatToken,
    povNationId,
    narrative,
    load,
  ]);

  const saveDomesticScratch = useCallback(
    async (value: string) => {
      if (!sessionId || !seatToken) return;
      const trimmed = value.trim();
      if (trimmed.length > MAX_DOMESTIC_SCRATCH_LENGTH) return;
      setDomesticSaveState("saving");
      setDomesticSaveError(null);
      try {
        const res = await fetch(
          `/api/nationforge/sessions/${sessionId}/domestic?token=${encodeURIComponent(seatToken)}`,
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
    [sessionId, seatToken],
  );

  const scheduleDomesticSave = useCallback(
    (value: string) => {
      if (!seatToken || !myNation?.forgeComplete) return;
      if (domesticDebounceRef.current) {
        clearTimeout(domesticDebounceRef.current);
      }
      domesticDebounceRef.current = setTimeout(() => {
        domesticDebounceRef.current = null;
        void saveDomesticScratch(value);
      }, 450);
    },
    [saveDomesticScratch, seatToken, myNation?.forgeComplete],
  );

  const sendDiplomacy = useCallback(async () => {
    if (!sessionId || !seatToken || !diplomacyToId.trim()) return;
    const msg = diplomacyMessage.trim();
    if (!msg) {
      setDiplomacyError("Write a message before sending.");
      return;
    }
    setDiplomacyBusy(true);
    setDiplomacyError(null);
    try {
      const res = await fetch(
        `/api/nationforge/sessions/${sessionId}/diplomacy?token=${encodeURIComponent(seatToken)}`,
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
  }, [sessionId, seatToken, diplomacyToId, diplomacyMessage]);

  const sendDiplomacyReply = useCallback(
    async (outreachId: string, text: string) => {
      if (!sessionId || !seatToken) return;
      const trimmed = text.trim();
      if (!trimmed) {
        setDiplomacyError("Reply cannot be empty.");
        return;
      }
      setDiplomacyBusy(true);
      setDiplomacyError(null);
      try {
        const res = await fetch(
          `/api/nationforge/sessions/${sessionId}/diplomacy/${encodeURIComponent(outreachId)}/reply?token=${encodeURIComponent(seatToken)}`,
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
    [sessionId, seatToken],
  );

  const submitOpeningBrief = useCallback(async () => {
    if (!sessionId || !session?.crisis || !seatToken) return;
    if (openingBriefInFlight) return;
    const viewerId = session.viewerNationId;
    if (!viewerId) return;
    const opener = session.nations.find((n) => n.id === viewerId);
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
          token: seatToken,
          povNationId: viewerId,
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
  }, [sessionId, seatToken, session, load]);

  useEffect(() => {
    if (!session || !seatToken || !myNation?.forgeComplete) return;
    if (waitingForTableOpen) return;
    if (!session.gameStarted || !session.crisis) return;
    if (
      lastGmChapter.trim() ||
      gmStreamText.trim() ||
      gmThreadHasAssistantDelivery(session.gmMessages)
    ) {
      return;
    }
    if (viewerGmStreaming) return;
    const dedupeKey = `${session.id}:${session.crisis.id}`;
    if (openingBeatAutoKeySent === dedupeKey) return;
    if (Date.now() < openingBriefCooldownUntil) return;
    void (async () => {
      await Promise.resolve();
      await submitOpeningBrief();
    })();
  }, [
    session,
    seatToken,
    myNation?.forgeComplete,
    waitingForTableOpen,
    lastGmChapter,
    gmStreamText,
    session?.gmMessages,
    viewerGmStreaming,
    submitOpeningBrief,
  ]);

  if (sessionNotFound) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
        <p>This session no longer exists or the link is invalid.</p>
        <Link
          href="/nationforge"
          className="mt-4 inline-block text-blue-600 underline dark:text-blue-400"
        >
          All sessions
        </Link>
      </div>
    );
  }

  if (sessionBootstrapError && !session) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-sm text-zinc-600 dark:text-zinc-400">
        <p className="text-red-600 dark:text-red-400">{sessionBootstrapError}</p>
        <button
          type="button"
          className="mt-4 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
          onClick={() => {
            setSessionBootstrapError(null);
            void load();
          }}
        >
          Retry
        </button>
        <div className="mt-4">
          <Link
            href="/nationforge"
            className="text-blue-600 underline dark:text-blue-400"
          >
            All sessions
          </Link>
        </div>
      </div>
    );
  }

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
          token={seatToken!}
          nation={wizardNation}
          onDone={load}
        />
      </div>
    );
  }

  const seatPovLocked = Boolean(
    seatToken && session.viewerNationId && myNation?.forgeComplete,
  );

  const statPulseWrapClass = statPanelPulse
    ? "rounded-2xl ring-4 ring-teal-400/90 ring-offset-2 ring-offset-zinc-50 transition-shadow duration-300 dark:ring-offset-zinc-950"
    : "rounded-2xl transition-shadow duration-300";

  return (
    <div
      className={`mx-auto px-4 py-8 ${
        usePlayGrid ? "max-w-6xl space-y-4" : "max-w-3xl space-y-6"
      }`}
    >
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
            Others join with the room code and go straight into the builder; the
            nation name is set in the forge (suggested, editable). They count as
            official table seats only after the builder is finished. Or use this
            link:
          </p>
          <div className="mt-2 font-mono break-all text-[11px]">
            {origin}/nationforge/join?code={session.roomCode}
          </div>
          {savedSeat ? (
            <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-2 text-[11px] text-teal-950 dark:border-teal-900/50 dark:bg-teal-950/30 dark:text-teal-100">
              <p className="font-medium">
                Saved on this browser
                {savedSeat.nationName ? ` as ${savedSeat.nationName}` : ""}
              </p>
              <button
                type="button"
                className="mt-1 text-teal-800 underline dark:text-teal-200"
                onClick={() => {
                  forgetNationForgeSession(sessionId);
                  setSavedSeat(null);
                  setSeatTokenBridge(null);
                  router.replace(`/nationforge/${sessionId}`);
                }}
              >
                Forget this seat on this browser
              </button>
            </div>
          ) : null}
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
                Current beat involves: {crisisInvolvedNames.join(", ")}
              </p>
              <p className="mt-1 text-[11px] text-teal-800/90 dark:text-teal-200/80">
                {session.crisis.activeNationIds.length <= 1
                  ? "The latest GM message highlights a single seat."
                  : "The latest GM message spans multiple seats — each nation answers from their own chat POV."}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {!seatToken ? (
        <section className="rounded-2xl border border-blue-200 bg-blue-50/80 px-5 py-5 dark:border-blue-900/50 dark:bg-blue-950/30">
          <h2 className="text-sm font-semibold text-blue-950 dark:text-blue-100">
            Join the table
          </h2>
          <p className="mt-2 text-sm text-blue-900/90 dark:text-blue-200/90">
            You are spectating without a seat token. Open the nation builder to
            run the 100-point forge — other players only see you as an official
            seat after you finish; your polity&apos;s name is chosen in the forge
            (with a suggestion you can overwrite). You can join after others have
            started; your builder runs privately until you finish.
          </p>
          <div className="mt-4">
            <button
              type="button"
              disabled={joinBusy}
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-blue-200 dark:text-blue-950"
              onClick={() => void claimSeat()}
            >
              {joinBusy ? "…" : "Open nation builder"}
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

      {(() => {
        const timelineEl =
          session.gameStarted && !waitingForTableOpen && introDelivered ? (
            <NationForgeTimeline
              turnLog={session.turnLog}
              emergentEvents={session.emergentEvents}
              roundIndex={session.roundIndex}
            />
          ) : null;

        const playStackInner = (
          <div
            className={
              usePlayGrid
                ? "flex min-h-0 flex-1 flex-col space-y-6"
                : "space-y-6"
            }
          >
          {session.gameStarted &&
      !waitingForTableOpen &&
      crisis &&
      !introDelivered &&
      seatToken &&
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
          {busy || viewerGmStreaming || gmStreamText.length > 0 ? (
            <p className="mt-4 text-sm font-medium text-amber-950 dark:text-amber-100">
              {gmStreamText
                ? "Streaming your opening scene — live text appears in the chat above."
                : "GM is drafting your opening scene…"}
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          {isViewerForgedOpeningSeat && error ? (
            <button
              type="button"
              disabled={busy || viewerGmStreaming}
              className="mt-4 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-950 enabled:hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-zinc-950 dark:text-amber-100 dark:enabled:hover:bg-amber-950/40"
              onClick={() => {
                openingBeatAutoKeySent = "";
                void submitOpeningBrief();
              }}
            >
              Try opening again
            </button>
          ) : null}
        </section>
      ) : null}

          {session.gameStarted && !waitingForTableOpen && introDelivered ? (
            <section
              className={`aetheria-chat flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/90 ${
                usePlayGrid
                  ? "min-h-0 flex-1 flex-col xl:h-full xl:min-h-0"
                  : "max-h-[min(78dvh,720px)] min-h-0 flex-col"
              }`}
            >
              <h2 className="sr-only">NationForge chat</h2>
              {peerJoinNotice ? (
                <div
                  className="rounded-lg border border-sky-200 bg-sky-50/95 px-3 py-2 text-sm text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/35 dark:text-sky-100"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p>
                      <span className="font-medium">{peerJoinNotice.name}</span>{" "}
                      finished the forge and joins the table. Check{" "}
                      <span className="font-medium">Session reference</span> for
                      their public profile and briefing.
                    </p>
                    <button
                      type="button"
                      className="shrink-0 text-xs font-medium text-sky-800 underline dark:text-sky-200"
                      onClick={() => setPeerJoinNotice(null)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="nationforge-chat-ribbon space-y-2">
                {seatPovLocked && myNation ? (
                  <div className={`${statPulseWrapClass} space-y-2`}>
                    <PlayNationChatIdentity nation={myNation} />
                    <PlayAnimatedStatStrip nation={myNation} />
                  </div>
                ) : (
                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/90 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/60">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                        Spectating public table
                      </p>
                      <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                        You can read public GM history, public timeline events, and
                        known nation summaries. Join with a seat token to see one
                        nation&apos;s private state and send moves.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="nationforge-chat-tts flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200/80 bg-zinc-50/90 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/60">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-700 dark:text-zinc-200">
                  <input
                    type="checkbox"
                    className="size-3.5 rounded border-zinc-400 text-violet-600 focus:ring-violet-500 dark:border-zinc-600"
                    checked={ttsEnabled}
                    onChange={(e) => {
                      const on = e.target.checked;
                      if (on) ttsPrimedRef.current = false;
                      setTtsEnabled(on);
                    }}
                  />
                  <span>
                    Dictate GM &amp; inflection{" "}
                    <span className="text-zinc-500 dark:text-zinc-400">
                      (xAI TTS)
                    </span>
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                  <label htmlFor="nationforge-tts-voice" className="sr-only">
                    TTS voice
                  </label>
                  <span className="hidden sm:inline text-zinc-500 dark:text-zinc-400">
                    Voice
                  </span>
                  <select
                    id="nationforge-tts-voice"
                    value={ttsVoiceId}
                    onChange={(e) =>
                      setTtsVoiceId(normalizeXaiTtsVoiceId(e.target.value))
                    }
                    className="max-w-[9rem] rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                  >
                    {XAI_TTS_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                {ttsEnabled ? (
                  <span className="w-full text-[10px] text-zinc-500 sm:w-auto dark:text-zinc-400">
                    New lines queue if speech is still playing.
                  </span>
                ) : null}
              </div>
              {impactBannerImpact ? (
                <div
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className="nationforge-chat-impact rounded-lg border border-teal-400/80 bg-teal-50 px-3 py-2 dark:border-teal-700 dark:bg-teal-950/50"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-teal-900 dark:text-teal-100">
                        Stats updated this beat
                      </p>
                      <p className="mt-1 text-xs text-zinc-800 dark:text-zinc-200">
                        {formatImpactSummary(impactBannerImpact)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 text-xs font-medium text-teal-800 underline dark:text-teal-200"
                      onClick={() => {
                        if (impactBannerTimerRef.current) {
                          clearTimeout(impactBannerTimerRef.current);
                          impactBannerTimerRef.current = null;
                        }
                        setImpactBannerImpact(null);
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : null}
              <div
                className={`flex-1 space-y-3 overflow-y-auto rounded-xl border border-zinc-200/80 bg-zinc-50/90 p-3 dark:border-zinc-700 dark:bg-zinc-900/50 ${
                  usePlayGrid ? "min-h-0" : "min-h-[260px]"
                }`}
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
                        <div
                          data-chat-role="user"
                          className="max-w-[92%] rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm shadow-sm dark:border-zinc-600 dark:bg-zinc-950"
                        >
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
                        <div
                          data-chat-role="gm"
                          className="max-w-[92%] rounded-2xl border border-violet-200/90 bg-violet-50/70 px-4 py-2.5 text-sm dark:border-violet-800/50 dark:bg-violet-950/35"
                        >
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
                {gmComposing ? (
                  <div className="flex justify-start">
                    <div
                      data-chat-role="gm-stream"
                      className="max-w-[92%] rounded-2xl border border-sky-200 bg-sky-50/90 px-4 py-3 text-sm dark:border-sky-800/60 dark:bg-sky-950/40"
                    >
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
                <div ref={transcriptEndRef} className="h-px w-full shrink-0" />
              </div>

              {showTurnComposer ? (
                <div className="sticky bottom-0 space-y-3 border-t border-zinc-200 bg-white/95 pt-3 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
                  {myNation ? (
                    <ChatComposerStatsBanner
                      nation={myNation}
                      latestImpact={myLatestStatImpact}
                    />
                  ) : null}
                  <div>
                    <label
                      htmlFor="nationforge-chat-message"
                      className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
                    >
                      Message
                    </label>
                    <p className="mt-1 text-xs text-zinc-500">
                      Tell the GM what your nation does. Include diplomacy,
                      covert moves, reforms, or reserve/stat intent naturally in
                      the message.
                    </p>
                    <textarea
                      id="nationforge-chat-message"
                      className="mt-2 min-h-[8rem] w-full resize-y rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base leading-relaxed text-zinc-900 shadow-inner outline-none ring-zinc-400 focus:border-zinc-500 focus:ring-2 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-500"
                      value={narrative}
                      onChange={(e) => setNarrative(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (e.key !== "Enter" || e.shiftKey) return;
                        e.preventDefault();
                        if (!busy && canSendTurn) {
                          void submitTurn();
                        }
                      }}
                      placeholder="The envoys wait in the rain. You speak, you move, you bluff—or you stay silent…"
                      spellCheck
                      disabled={
                        !session.gameStarted ||
                        !povNation?.forgeComplete ||
                        viewerGmStreaming
                      }
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
                    {busy || viewerGmStreaming
                      ? "GM is writing the next beat…"
                      : "Send to GM"}
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
              Session reference &amp; global affairs
            </summary>
            <p className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Global affairs: public beats, shocks, roster, diplomacy, and other
              seats&apos; profiles — separate from your nation&apos;s private GM
              chat transcript.
            </p>
            <div className="space-y-6 border-t border-zinc-100 p-4 dark:border-zinc-800">
              {seatToken && myNation?.forgeComplete ? (
                <section className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                        Private nation notebook
                      </h3>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Persistent context the GM sees for your nation. It is not
                        sent as a turn and does not change stats by itself.
                      </p>
                    </div>
                    <StatRibbon nation={myNation} />
                  </div>
                  <textarea
                    className="mt-3 min-h-[7rem] w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-900 outline-none ring-zinc-400 focus:border-zinc-500 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500"
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
                    placeholder="Private operating notes, long-running institutions, social contracts, internal priorities..."
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
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-blue-600 underline dark:text-blue-400">
                      Full nation sheet (stats &amp; forge log)
                    </summary>
                    <div className="mt-2">
                      <NationCard nation={myNation} isViewer />
                    </div>
                  </details>
                </section>
              ) : null}
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
                          {e.privateText ? (
                            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-950 dark:border-amber-900/45 dark:bg-amber-950/35 dark:text-amber-100">
                              Private to you: {e.privateText}
                            </p>
                          ) : null}
                        </details>
                      ) : (
                        <>
                          <span className="text-xs text-zinc-500">
                            {new Date(e.at).toLocaleString()} · latest
                          </span>
                          <p className="mt-1 whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
                            {e.publicSummary}
                          </p>
                          {e.privateText ? (
                            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-950 dark:border-amber-900/45 dark:bg-amber-950/35 dark:text-amber-100">
                              Private to you: {e.privateText}
                            </p>
                          ) : null}
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
              {session.gameStarted &&
              session.viewerNationId &&
              session.nations.some(
                (n) => n.forgeComplete && n.id !== session.viewerNationId,
              ) ? (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                    Other forged seats (global view)
                  </h3>
                  <div className="space-y-3">
                    {session.nations
                      .filter(
                        (n) =>
                          n.forgeComplete && n.id !== session.viewerNationId,
                      )
                      .map((n) => (
                        <NationCard key={n.id} nation={n} compact />
                      ))}
                  </div>
                </section>
              ) : null}
              {seatToken && myNation?.forgeComplete ? (
                <section className="rounded-lg border border-indigo-200/90 bg-indigo-50/70 p-3 dark:border-indigo-900/40 dark:bg-indigo-950/35">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase text-indigo-900 dark:text-indigo-200">
                      Structured messages (optional)
                    </h3>
                    {unreadDiplomacyCount > 0 && (
                      <span className="rounded-full bg-red-500 px-1.5 py-px text-[10px] font-bold text-white">
                        {unreadDiplomacyCount}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-indigo-950/85 dark:text-indigo-100/85">
                    Bilateral threads — only you and the other nation see a thread. New messages are highlighted.
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
                        <ul className="mt-4 space-y-6 border-t border-indigo-200/60 pt-4 dark:border-indigo-800/50">
                          {sortedDiplomacy.map((o) => {
                            const fromName =
                              session.nations.find((n) => n.id === o.fromNationId)
                                ?.name ?? o.fromNationId;
                            const toName =
                              session.nations.find((n) => n.id === o.toNationId)
                                ?.name ?? o.toNationId;
                            const vid = session.viewerNationId;
                            const iAmParticipant = vid === o.fromNationId || vid === o.toNationId;
                            return (
                              <li
                                key={o.id}
                                className="rounded-lg border border-indigo-100 bg-white/90 p-4 text-sm dark:border-indigo-900/50 dark:bg-zinc-950/80"
                              >
                                <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                                  Thread with {fromName} ↔ {toName}
                                </p>
                                <div className="mt-3 space-y-4">
                                  {o.messages.map((msg) => {
                                    const isFromMe = vid === msg.fromNationId;
                                    const senderName = isFromMe ? "You" : (session.nations.find((n) => n.id === msg.fromNationId)?.name ?? msg.fromNationId);
                                    return (
                                      <div key={msg.id} className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${isFromMe ? 'bg-indigo-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
                                          <p className="text-[10px] opacity-75">{senderName} · {new Date(msg.at).toLocaleString()}</p>
                                          <p className="whitespace-pre-wrap text-sm mt-1">{msg.text}</p>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                {iAmParticipant && (
                                  <div className="mt-4 space-y-2">
                                    <textarea
                                      className="min-h-[3.5rem] w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs dark:border-indigo-800 dark:bg-zinc-950"
                                      placeholder="Continue the conversation..."
                                      maxLength={MAX_DIPLOMACY_MESSAGE_LENGTH}
                                      value={replyDraftById[o.id] ?? ""}
                                      onChange={(e) =>
                                        setReplyDraftById((prev) => ({
                                          ...prev,
                                          [o.id]: e.target.value.slice(
                                            0,
                                            MAX_DIPLOMACY_MESSAGE_LENGTH,
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
                                      className="rounded-lg bg-indigo-800 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-indigo-300 dark:text-indigo-950"
                                      onClick={() =>
                                        void sendDiplomacyReply(
                                          o.id,
                                          replyDraftById[o.id] ?? "",
                                        )
                                      }
                                    >
                                      Send message
                                    </button>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="mt-4 border-t border-indigo-200/60 pt-3 text-xs text-indigo-900/70 dark:border-indigo-800/50 dark:text-indigo-200/70">
                          No threads yet. Use the form above to start a bilateral conversation with another nation.
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
        );

        if (usePlayGrid) {
          return (
            <div className="xl:grid xl:grid-cols-[minmax(220px,260px)_minmax(0,1fr)] xl:gap-4 xl:items-stretch xl:min-h-[calc(100dvh-11rem)] xl:max-h-[calc(100dvh-11rem)]">
              <aside className="flex min-h-0 max-h-full flex-col gap-4 overflow-y-auto">
                {timelineEl}
              </aside>
              <main className="flex min-h-0 min-w-0 max-h-full flex-col overflow-y-auto">
                {playStackInner}
              </main>
            </div>
          );
        }

        return (
          <>
            {timelineEl}
            {playStackInner}
          </>
        );
      })()}
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
      {nation.forgeBriefingMarkdown?.trim() ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-indigo-600 dark:text-indigo-400">
            Forge briefing (Markdown)
          </summary>
          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-zinc-200/80 bg-white/90 p-2 dark:border-zinc-700 dark:bg-zinc-950/80">
            <NationForgeChatMarkdown source={nation.forgeBriefingMarkdown} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
