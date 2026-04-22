/**
 * Strip common Markdown patterns so TTS reads roughly what a player hears.
 * Best-effort only — no full Markdown parser.
 */
export function markdownishToSpeechText(source: string): string {
  let t = source.trim();
  if (!t) return "";
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/^\s*[-*]\s+/gm, "");
  t = t.replace(/\s+/g, " ");
  return t.trim();
}

const CHUNK_SOFT_MAX = 1800;

/** Split long copy into chunks the TTS API can digest; keeps sentence boundaries when possible. */
export function chunkTextForTts(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= CHUNK_SOFT_MAX) return [t];
  const out: string[] = [];
  let rest = t;
  while (rest.length > 0) {
    if (rest.length <= CHUNK_SOFT_MAX) {
      out.push(rest.trim());
      break;
    }
    let cut = rest.lastIndexOf(". ", CHUNK_SOFT_MAX);
    if (cut < CHUNK_SOFT_MAX * 0.5) {
      cut = rest.lastIndexOf("\n", CHUNK_SOFT_MAX);
    }
    if (cut < CHUNK_SOFT_MAX * 0.5) {
      cut = CHUNK_SOFT_MAX;
    }
    const piece = rest.slice(0, cut + 1).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut + 1).trim();
  }
  return out.filter(Boolean);
}
