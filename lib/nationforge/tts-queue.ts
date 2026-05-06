"use client";

import { normalizeXaiTtsVoiceId } from "@/lib/nationforge/tts-voices";

const MIN_PLAYBACK_RATE = 1;
const MAX_PLAYBACK_RATE = 1.25;

function clampPlaybackRate(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, raw));
}

type TtsQueueApi = {
  enqueue: (text: string) => void;
  clear: () => void;
  dispose: () => void;
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
): TtsQueueApi {
  const pending: string[] = [];
  let draining = false;
  let disposed = false;
  const audio = new Audio();

  const stopCurrent = () => {
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } catch {
      /* ignore */
    }
  };

  const playBlob = (blob: Blob): Promise<void> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const onEnd = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error("Audio playback failed"));
      };
      const cleanup = () => {
        URL.revokeObjectURL(url);
        audio.removeEventListener("ended", onEnd);
        audio.removeEventListener("error", onErr);
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

  const fetchSpeak = async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!text || disposed) return;
    const voice_id = normalizeXaiTtsVoiceId(getVoiceId());
    const res = await fetch("/api/nationforge/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice_id, language: "en" }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(err || `TTS HTTP ${res.status}`);
    }
    const blob = await res.blob();
    if (disposed) return;
    await playBlob(blob);
  };

  const drain = async () => {
    if (draining || disposed) return;
    draining = true;
    try {
      while (pending.length > 0 && !disposed) {
        const chunk = pending.shift()!;
        try {
          await fetchSpeak(chunk);
        } catch {
          /* skip failed chunk; continue queue */
        }
      }
    } finally {
      draining = false;
      if (pending.length > 0 && !disposed) void drain();
    }
  };

  return {
    enqueue(text: string) {
      if (disposed) return;
      const t = text.trim();
      if (!t) return;
      pending.push(t);
      if (!draining) void drain();
    },
    clear() {
      pending.length = 0;
      stopCurrent();
    },
    dispose() {
      disposed = true;
      pending.length = 0;
      stopCurrent();
    },
  };
}
