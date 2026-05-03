"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";

import {
  ensureNationForgePlayerProfile,
  forgetNationForgeSession,
  readNationForgeEnrollments,
  setNationForgeEnrollmentFavorite,
  touchNationForgeEnrollment,
  type NationForgeEnrollment,
  type NationForgePlayerProfile,
} from "@/lib/nationforge/seat-token-cache";
import type { NationForgeSessionSummary } from "@/lib/nationforge/session-summary";

type Props = {
  sessions: NationForgeSessionSummary[];
};

function sessionNames(s?: NationForgeSessionSummary): string {
  if (!s) return "Saved room";
  if (s.nationNames.length > 0) return s.nationNames.join(", ");
  if (s.nationsInForge > 0) {
    return `${s.nationsInForge} ${s.nationsInForge === 1 ? "seat" : "seats"} building`;
  }
  return "Empty room";
}

function phaseLabel(s?: NationForgeSessionSummary): string {
  if (!s) return "local save";
  if (!s.gameStarted) return s.nationsInForge > 0 ? "nation forge" : "lobby";
  return s.phase.replace(/_/g, " ");
}

function lastSeen(enrollment: NationForgeEnrollment): string {
  const d = new Date(enrollment.lastOpenedAt);
  if (Number.isNaN(d.valueOf())) return "saved on this browser";
  return `last opened ${d.toLocaleString()}`;
}

function matchesSearch(
  q: string,
  s: NationForgeSessionSummary | undefined,
  enrollment?: NationForgeEnrollment,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    s?.roomCode,
    s?.phase,
    s?.activeNationName,
    ...(s?.nationNames ?? []),
    ...(s?.nationRoster.map((n) => n.name) ?? []),
    enrollment?.nationName,
    enrollment?.label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function resumeHref(sessionId: string, token: string): string {
  return `/nationforge/${sessionId}?token=${encodeURIComponent(token)}`;
}

export default function NationForgeHomeClient({ sessions }: Props) {
  const [profile, setProfile] = useState<NationForgePlayerProfile | null>(null);
  const [enrollments, setEnrollments] = useState<
    Record<string, NationForgeEnrollment>
  >({});
  const [query, setQuery] = useState("");

  const refreshLocal = () => {
    setProfile(ensureNationForgePlayerProfile());
    setEnrollments(readNationForgeEnrollments());
  };

  useEffect(() => {
    startTransition(() => {
      refreshLocal();
    });
  }, []);

  const sessionsById = useMemo(
    () => new Map(sessions.map((s) => [s.id, s])),
    [sessions],
  );

  const myGames = useMemo(() => {
    return Object.values(enrollments)
      .map((enrollment) => ({
        enrollment,
        session: sessionsById.get(enrollment.sessionId),
      }))
      .filter(({ enrollment, session }) => matchesSearch(query, session, enrollment))
      .sort((a, b) => {
        if (a.enrollment.favorite !== b.enrollment.favorite) {
          return a.enrollment.favorite ? -1 : 1;
        }
        return (
          Date.parse(b.enrollment.lastOpenedAt) -
          Date.parse(a.enrollment.lastOpenedAt)
        );
      });
  }, [enrollments, query, sessionsById]);

  const recentRooms = useMemo(() => {
    return sessions
      .filter((s) => matchesSearch(query, s, enrollments[s.id]))
      .slice(0, 30);
  }, [enrollments, query, sessions]);

  const toggleFavorite = (sessionId: string, next: boolean) => {
    setNationForgeEnrollmentFavorite(sessionId, next);
    refreshLocal();
  };

  const forget = (sessionId: string) => {
    forgetNationForgeSession(sessionId);
    refreshLocal();
  };

  const touch = (
    sessionId: string,
    session: NationForgeSessionSummary | undefined,
    enrollment: NationForgeEnrollment,
  ) => {
    touchNationForgeEnrollment(sessionId, {
      roomCode: session?.roomCode,
      nationName:
        session?.nationRoster.find((n) => n.id === enrollment.nationId)?.name ??
        enrollment.nationName,
    });
    refreshLocal();
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            NationForge
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Create a room, join by code, or resume a saved seat from this browser.
            Tokens stay local, so this is a lightweight campaign hub rather than
            an account system.
          </p>
          {profile ? (
            <p className="mt-2 text-[11px] text-zinc-400">
              Browser profile {profile.playerId.slice(0, 8)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/nationforge/new"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            New session
          </Link>
          <Link
            href="/nationforge/join"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-100"
          >
            Join by room code
          </Link>
        </div>
      </div>

      <label className="mt-8 block text-sm font-medium text-zinc-700 dark:text-zinc-200">
        Search rooms
      </label>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Room code, nation, phase..."
        className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
      />

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            My games
          </h2>
          <span className="text-xs text-zinc-400">
            {myGames.length} saved {myGames.length === 1 ? "seat" : "seats"}
          </span>
        </div>
        {myGames.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No saved seats on this browser yet. Join a room or open the nation
            builder to make it appear here.
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {myGames.map(({ enrollment, session }) => {
              const nationName =
                session?.nationRoster.find((n) => n.id === enrollment.nationId)
                  ?.name ??
                enrollment.nationName ??
                "Your seat";
              return (
                <li
                  key={enrollment.sessionId}
                  className="rounded-2xl border border-teal-200 bg-teal-50/70 p-4 dark:border-teal-900/50 dark:bg-teal-950/25"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-teal-800 dark:text-teal-200">
                        {enrollment.favorite ? "Favorite" : "Saved on this browser"}
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-50">
                        Room {session?.roomCode ?? enrollment.roomCode ?? "unknown"}
                      </h3>
                      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">
                        Playing as <span className="font-medium">{nationName}</span>
                        {" · "}
                        {sessionNames(session)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {phaseLabel(session)}
                        {session ? ` · round ${session.roundIndex}` : ""}
                        {" · "}
                        {lastSeen(enrollment)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={resumeHref(enrollment.sessionId, enrollment.token)}
                        onClick={() =>
                          touch(enrollment.sessionId, session, enrollment)
                        }
                        className="rounded-lg bg-teal-900 px-3 py-2 text-xs font-medium text-white dark:bg-teal-200 dark:text-teal-950"
                      >
                        Resume
                      </Link>
                      <button
                        type="button"
                        onClick={() =>
                          toggleFavorite(
                            enrollment.sessionId,
                            !enrollment.favorite,
                          )
                        }
                        className="rounded-lg border border-teal-300 px-3 py-2 text-xs font-medium text-teal-950 dark:border-teal-800 dark:text-teal-100"
                      >
                        {enrollment.favorite ? "Unfavorite" : "Favorite"}
                      </button>
                      <button
                        type="button"
                        onClick={() => forget(enrollment.sessionId)}
                        className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                      >
                        Forget
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Recent rooms
        </h2>
        <ul className="mt-3 space-y-2">
          {recentRooms.map((s) => {
            const enrollment = enrollments[s.id];
            return (
              <li
                key={s.id}
                className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950/60"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link
                      href={
                        enrollment
                          ? resumeHref(s.id, enrollment.token)
                          : `/nationforge/${s.id}`
                      }
                      onClick={() =>
                        enrollment ? touch(s.id, s, enrollment) : undefined
                      }
                      className="text-sm font-medium text-blue-700 underline dark:text-blue-300"
                    >
                      Room {s.roomCode}
                    </Link>
                    <p className="mt-1 text-xs text-zinc-500">
                      {sessionNames(s)} · {phaseLabel(s)} · round {s.roundIndex}
                      {s.activeNationName ? ` · active: ${s.activeNationName}` : ""}
                    </p>
                  </div>
                  {enrollment ? (
                    <span className="rounded-full bg-teal-100 px-2 py-1 text-[10px] font-medium uppercase text-teal-900 dark:bg-teal-950 dark:text-teal-100">
                      You&apos;re in this
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
