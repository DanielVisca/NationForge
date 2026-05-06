import {
  chunkTextForTts,
  markdownishToSpeechText,
} from "@/lib/nationforge/markdown-ish-to-speech-text";

const PARA_SEP = "\n\n";

/**
 * Split `buffer` into completed Markdown paragraphs (double-newline separated)
 * and the trailing incomplete remainder.
 */
export function takeCompleteParagraphsFromBuffer(buffer: string): {
  remainder: string;
  completeRawParagraphs: string[];
} {
  if (!buffer.includes(PARA_SEP)) {
    return { remainder: buffer, completeRawParagraphs: [] };
  }
  const parts = buffer.split(PARA_SEP);
  const completeRawParagraphs = parts
    .slice(0, -1)
    .map((p) => p.trim())
    .filter(Boolean);
  const remainder = parts[parts.length - 1] ?? "";
  return { remainder, completeRawParagraphs };
}

/** Append one stream delta, then enqueue TTS for any newly completed paragraphs. */
export function appendGmStreamDeltaAndEnqueueParagraphTts(
  rawBufferRef: { current: string },
  delta: string,
  enqueue: (text: string) => void,
  ttsEnabled: boolean,
): void {
  rawBufferRef.current += delta;
  const { remainder, completeRawParagraphs } =
    takeCompleteParagraphsFromBuffer(rawBufferRef.current);
  rawBufferRef.current = remainder;
  if (!ttsEnabled) return;
  for (const raw of completeRawParagraphs) {
    const plain = markdownishToSpeechText(raw);
    if (!plain) continue;
    for (const chunk of chunkTextForTts(plain)) {
      enqueue(chunk);
    }
  }
}

/** Speak any trailing text after the stream ends (no closing `\n\n`). Clears the buffer ref. */
export function flushGmStreamTailToTts(
  rawBufferRef: { current: string },
  enqueue: (text: string) => void,
  ttsEnabled: boolean,
): void {
  const tail = rawBufferRef.current.trim();
  rawBufferRef.current = "";
  if (!ttsEnabled || !tail) return;
  const plain = markdownishToSpeechText(tail);
  if (!plain) return;
  for (const chunk of chunkTextForTts(plain)) {
    enqueue(chunk);
  }
}
