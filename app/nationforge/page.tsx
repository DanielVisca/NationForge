import { listNationForgeSessionSummaries } from "@/lib/nationforge/store";

import NationForgeHomeClient from "./NationForgeHomeClient";

/** Lobby reads `.data` — must not freeze at build time. */
export const dynamic = "force-dynamic";

export default async function NationForgeIndexPage() {
  const sessions = await listNationForgeSessionSummaries().catch(() => []);

  return <NationForgeHomeClient sessions={sessions} />;
}
