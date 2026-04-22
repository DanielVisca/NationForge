/** xAI Grok TTS `voice_id` values (lowercase) and display names. */
export const XAI_TTS_VOICE_IDS = ["eve", "ara", "leo", "rex", "sal"] as const;

export type XaiTtsVoiceId = (typeof XAI_TTS_VOICE_IDS)[number];

export const XAI_TTS_VOICES: readonly { id: XaiTtsVoiceId; label: string }[] = [
  { id: "eve", label: "Eve" },
  { id: "ara", label: "Ara" },
  { id: "leo", label: "Leo" },
  { id: "rex", label: "Rex" },
  { id: "sal", label: "Sal" },
] as const;

export function normalizeXaiTtsVoiceId(
  raw: string | undefined | null,
): XaiTtsVoiceId {
  const s = (raw ?? "").trim().toLowerCase();
  return (XAI_TTS_VOICE_IDS as readonly string[]).includes(s)
    ? (s as XaiTtsVoiceId)
    : "eve";
}
