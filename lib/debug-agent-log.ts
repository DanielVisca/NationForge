import "server-only";

import { appendFile } from "node:fs/promises";

const DEBUG_LOG_PATH =
  "/Users/danielvisca/Development/Aetheria/.cursor/debug-1416db.log";

/** NDJSON line for Cursor debug mode (no secrets / no PII). */
export async function agentDebugLog(
  entry: Record<string, unknown> & { hypothesisId?: string; message: string },
): Promise<void> {
  const line =
    JSON.stringify({
      sessionId: "1416db",
      timestamp: Date.now(),
      ...entry,
    }) + "\n";
  await appendFile(DEBUG_LOG_PATH, line).catch(() => {});
}
