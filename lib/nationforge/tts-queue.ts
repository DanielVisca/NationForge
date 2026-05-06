"use client";

import { normalizeXaiTtsVoiceId } from "@/lib/nationforge/tts-voices";

const MIN_PLAYBACK_RATE = 1;
const MAX_PLAYBACK_RATE = 1.25;

function clampPlaybackRate(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, raw));
}

export type NationForgeTtsPlaybackStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused";

export type NationForgeTtsPlaybackState = {
  status: NationForgeTtsPlaybackStatus;
  pendingCount: number;
};

export type CreateNationForgeTtsQueueOptions = {
  onStateChange?: (state: NationForgeTtsPlaybackState) => void;
};

export type NationForgeTtsQueueApi = {
  enqueue: (text: string) => void;
  clear: () => void;
  dispose: () => void;
  pause: () => void;
  resume: () => void;
  getPlaybackState: () => NationForgeTtsPlaybackState;
};

/**
 * Sequential TTS playback: fetches MP3 from `/api/nationforge/tts`, plays with HTMLAudioElement.
 * New text while playing is queued; `clear` stops current audio and drops pending chunks.
 * `getVoiceId` is read on each request so the user can change voice without rebuilding the queue.
 * `getPlaybackRate` is read before each clip plays (1–1.25); pitch/timbre at &gt;1 is browser-dependent.
 */
export function createNationForgeTtsQueue(
  getVoiceId: () => string = () => "eve",
  getPlaybackRate?: () => number,
  options?: CreateNationForgeTtsQueueOptions,
): NationForgeTtsQueueApi {
  const onStateChange = options?.onStateChange;
  const pending: string[] = [];
  let draining = false;
  let disposed = false;
  const audio = new Audio();

  let pausedByUser = false;
  const pauseWaiters: Array<() => void> = [];
  let fetchingClip = false;
  let playingClip = false;
  let lastState: NationForgeTtsPlaybackState = {
    status: "idle",
    pendingCount: 0,
  };

  const releasePauseWaiters = () => {
    const copy = pauseWaiters.splice(0, pauseWaiters.length);
    for (const r of copy) r();
  };

  const waitWhilePaused = (): Promise<void> => {
    if (!pausedByUser || disposed) return Promise.resolve();
    return new Promise((resolve) => {
      pauseWaiters.push(resolve);
    });
  };

  const emitState = () => {
    const pendingCount = pending.length;
    let status: NationForgeTtsPlaybackStatus = "idle";
    const hasWork = pendingCount > 0 || fetchingClip || playingClip;
    if (pausedByUser && hasWork) {
      status = "paused";
    } else if (playingClip) {
      status = "playing";
    } else if (fetchingClip || pendingCount > 0) {
      status = "loading";
    } else {
      status = "idle";
    }
    lastState = { status, pendingCount };
    onStateChange?.(lastState);
  };

  const stopCurrent = () => {
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } catch {
      /* ignore */
    }
  };

  const playBlob = async (blob: Blob): Promise<void> => {
    await waitWhilePaused();
    if (disposed) return;
    const url = URL.createObjectURL(blob);
    await waitWhilePaused();
    if (disposed) {
      URL.revokeObjectURL(url);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        URL.revokeObjectURL(url);
        audio.removeEventListener("ended", onEnd);
        audio.removeEventListener("error", onErr);
      };
      const onEnd = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error("Audio playback failed"));
      };
      audio.addEventListener("ended", onEnd);
      audio.addEventListener("error", onErr);
      audio.src = url;
      audio.playbackRate = clampPlaybackRate(getPlaybackRate?.() ?? 1);
      void audio.play().catch(() => {
        cleanup();
        reject(new Error("Audio play() rejected"));
      });
    });
  };

  const fetchSpeak = async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!text || disposed) return;
    await waitWhilePaused();
    if (disposed) return;
    const voice_id = normalizeXaiTtsVoiceId(getVoiceId());
    fetchingClip = true;
    emitState();
    let res: Response;
    try {
      res = await fetch("/api/nationforge/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice_id, language: "en" }),
      });
    } finally {
      fetchingClip = false;
      emitState();
    }
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(err || `TTS HTTP ${res.status}`);
    }
    const blob = await res.blob();
    if (disposed) return;
    await waitWhilePaused();
    if (disposed) return;
    playingClip = true;
    emitState();
    try {
      await playBlob(blob);
    } finally {
      playingClip = false;
      emitState();
    }
  };

  const drain = async () => {
    if (draining || disposed) return;
    draining = true;
    try {
      while (pending.length > 0 && !disposed) {
        await waitWhilePaused();
        if (disposed) break;
        const chunk = pending.shift()!;
        emitState();
        try {
          await fetchSpeak(chunk);
        } catch {
          /* skip failed chunk; continue queue */
        }
        emitState();
      }
    } finally {
      draining = false;
      emitState();
      if (pending.length > 0 && !disposed) void drain();
    }
  };

  return {
    enqueue(text: string) {
      if (disposed) return;
      const t = text.trim();
      if (!t) return;
      pending.push(t);
      emitState();
      if (!draining) void drain();
    },
    clear() {
      pausedByUser = false;
      releasePauseWaiters();
      fetchingClip = false;
      playingClip = false;
      pending.length = 0;
      stopCurrent();
      emitState();
    },
    dispose() {
      disposed = true;
      pausedByUser = false;
      releasePauseWaiters();
      pending.length = 0;
      stopCurrent();
      emitState();
    },
    pause() {
      if (disposed) return;
      pausedByUser = true;
      try {
        audio.pause();
      } catch {
        /* ignore */
      }
      emitState();
    },
    resume() {
      if (disposed) return;
      pausedByUser = false;
      releasePauseWaiters();
      void audio.play().catch(() => {
        /* ignore */
      });
      emitState();
    },
    getPlaybackState() {
      return lastState;
    },
  };
}
