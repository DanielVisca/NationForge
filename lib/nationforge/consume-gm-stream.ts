/**
 * Client-side: accumulate assistant-visible text from a `toUIMessageStreamResponse` body.
 * Returns the full concatenated text-delta string for TTS dedupe and tail handling.
 */
export async function consumeGmTextStream(
  response: Response,
  onDelta: (delta: string) => void,
): Promise<string> {
  const body = response.body;
  if (!body) throw new Error("Empty response body");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as { type?: string; delta?: string };
          if (parsed.type === "text-delta" && typeof parsed.delta === "string") {
            accumulated += parsed.delta;
            onDelta(parsed.delta);
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    }
  }

  return accumulated;
}
