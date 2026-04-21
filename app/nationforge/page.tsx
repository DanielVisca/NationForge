import { headers } from "next/headers";
import Link from "next/link";

async function getSessions() {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const res = await fetch(`${proto}://${host}/api/nationforge/sessions`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    sessions: Array<{
      id: string;
      roomCode: string;
      updatedAt: string;
      phase: string;
      nationNames: string[];
    }>;
  };
  return data.sessions;
}

export default async function NationForgeIndexPage() {
  const sessions = await getSessions().catch(() => []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        NationForge
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Create a room, then each player claims a seat with their nation name.
        Everyone runs the same 100-point nation builder (one section at a time)
        before the first GM beat; new players can join later and complete the
        builder while the table continues. Stats change only via GM tool calls
        on the server.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
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
      <ul className="mt-8 space-y-2">
        {sessions.map((s) => (
          <li key={s.id}>
            <Link
              href={`/nationforge/${s.id}`}
              className="text-sm text-blue-600 underline dark:text-blue-400"
            >
              Room {s.roomCode}
              {s.nationNames.length > 0
                ? ` — ${s.nationNames.join(" vs ")}`
                : " — empty room"}{" "}
              ({s.phase})
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
