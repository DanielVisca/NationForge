"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import {
  choicesOrderedForBudget,
  computeSpend,
  FORGE_POINT_BUDGET,
  FORGE_STEP_IDS,
  type ForgeStepId,
  type NationForgeSelections,
} from "@/lib/nationforge/nation-forge-catalog";
import { computeSynergies, resolveForgeToNation } from "@/lib/nationforge/nation-forge-resolve";
import type { Nation } from "@/lib/nationforge/schema";

const STEP_HEADLINE: Record<ForgeStepId, string> = {
  government: "Government form",
  economy: "Economic model",
  labor: "Labor & rights",
  military: "Military & security",
  education: "Education & human capital",
  infrastructure: "Infrastructure & resources",
  foreignPolicy: "Foreign policy stance",
  demographics: "Demographics & population",
  demographicsAddons: "Demographics add-ons (optional)",
  cultural: "Cultural orientation",
  environment: "Environment & sustainability",
  confirm: "Review & forge",
};

type Props = {
  sessionId: string;
  token: string;
  nation: Nation;
  onDone: () => Promise<void>;
};

export default function NationForgeWizard({
  sessionId,
  token,
  nation,
  onDone,
}: Props) {
  const router = useRouter();
  const progress = nation.forgeProgress;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stepId = useMemo(() => {
    if (!progress) return undefined;
    return FORGE_STEP_IDS[progress.stepIndex];
  }, [progress]);

  const spent = useMemo(
    () => computeSpend(progress?.selections ?? {}),
    [progress?.selections],
  );
  const pointsLeft = FORGE_POINT_BUDGET - spent;

  const postForge = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch(`/api/nationforge/sessions/${sessionId}/forge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, ...body }),
        });
        const j = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        await onDone();
        if (body.type === "finalize") {
          router.replace(`/nationforge/${sessionId}?token=${encodeURIComponent(token)}`);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Request failed");
      } finally {
        setBusy(false);
      }
    },
    [sessionId, token, onDone, router],
  );

  if (!progress || !stepId) {
    return null;
  }

  const preview =
    stepId === "confirm"
      ? resolveForgeToNation(progress.selections)
      : null;

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <p className="text-xs font-medium uppercase tracking-wide text-amber-800 dark:text-amber-200">
        NationForge · 100-point builder
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {nation.name}
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        One section at a time. You always see{" "}
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
          points remaining
        </span>
        ; later sections stay hidden until you reach them. Every pillar also
        has an{" "}
        <span className="font-semibold text-zinc-800 dark:text-zinc-200">
          underfunded (0 pt)
        </span>{" "}
        choice: bank points into reserve, but your nation pays for it in-world
        with weaker stats — or use it when you cannot afford anything else.
      </p>

      <div className="mt-6 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-5 py-4 dark:border-amber-900/40 dark:bg-amber-950/30">
        <p className="text-xs text-amber-950 dark:text-amber-100">Points remaining</p>
        <p className="mt-1 text-4xl font-bold tabular-nums text-amber-950 dark:text-amber-50">
          {pointsLeft}
        </p>
        <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/90">
          Budget {FORGE_POINT_BUDGET} · Spent so far {spent}
        </p>
      </div>

      <div className="mt-8">
        <p className="text-xs text-zinc-500">
          Step {progress.stepIndex + 1} of {FORGE_STEP_IDS.length}
        </p>
        <h3 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {STEP_HEADLINE[stepId]}
        </h3>
      </div>

      {err ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">{err}</p>
      ) : null}

      {stepId === "confirm" && preview && "stats" in preview ? (
        <div className="mt-6 space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
          <p className="whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-4 text-xs dark:border-zinc-700 dark:bg-zinc-950">
            {preview.buildNotes}
          </p>
          <p>
            <span className="font-medium">Reserve</span> after forge:{" "}
            {preview.reserve} (helps stability & crises).
          </p>
          {preview.synergyLines.length > 0 ? (
            <div>
              <p className="font-medium text-zinc-900 dark:text-zinc-100">
                Synergies (transparent)
              </p>
              <ul className="mt-2 list-inside list-disc text-xs">
                {preview.synergyLines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <button
            type="button"
            disabled={busy}
            className="w-full rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            onClick={() => void postForge({ type: "finalize" })}
          >
            {busy ? "Forging…" : "Forge my nation"}
          </button>
        </div>
      ) : null}

      {stepId === "confirm" && preview && !("stats" in preview) ? (
        <p className="mt-4 text-sm text-red-600">{preview.error}</p>
      ) : null}

      {stepId !== "confirm" && stepId !== "demographicsAddons" ? (
        <ul className="mt-6 space-y-2">
          {choicesOrderedForBudget(stepId, pointsLeft).map((c) => {
            const affordable = c.cost <= pointsLeft;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={busy || !affordable}
                  title={
                    affordable
                      ? undefined
                      : `Need ${c.cost - pointsLeft} more points (go Back or pick a cheaper / 0 pt option).`
                  }
                  className="flex w-full flex-col items-start rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm transition hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-500"
                  onClick={() => void postForge({ type: "pick", choiceId: c.id })}
                >
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {c.label}{" "}
                    <span className="font-mono text-zinc-500">· {c.cost} pts</span>
                  </span>
                  {c.blurb ? (
                    <span className="mt-1 text-xs text-zinc-500">{c.blurb}</span>
                  ) : null}
                  {!affordable ? (
                    <span className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                      Not affordable with current budget
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {stepId === "demographicsAddons" && progress ? (
        <DemographicsAddonsPanel
          key={`addons-${progress.stepIndex}-${(progress.selections.demographicsAddons ?? []).join(",")}`}
          initialIds={progress.selections.demographicsAddons ?? []}
          selections={progress.selections}
          busy={busy}
          postForge={postForge}
        />
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || progress.stepIndex === 0}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-200"
          onClick={() => void postForge({ type: "back" })}
        >
          Back
        </button>
      </div>

      {stepId === "confirm" && preview && "stats" in preview ? (
        <dl className="mt-6 grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 p-4 text-xs dark:border-zinc-700">
          {Object.entries(preview.stats).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="capitalize text-zinc-500">{k}</dt>
              <dd className="font-mono font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {stepId === "confirm" && preview && "stats" in preview
        ? computeSynergies(progress.selections).length > 0 && (
            <p className="mt-4 text-xs text-zinc-500">
              Synergy modifiers are folded into the Key Stats above.
            </p>
          )
        : null}
    </div>
  );
}

function DemographicsAddonsPanel({
  initialIds,
  selections,
  busy,
  postForge,
}: {
  initialIds: string[];
  selections: NationForgeSelections;
  busy: boolean;
  postForge: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string[]>(() => [...initialIds]);

  const spendWithDraft = (ids: string[]) =>
    computeSpend({ ...selections, demographicsAddons: ids });

  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs text-zinc-500">
        Toggle any combination that fits your remaining budget. Unknown future
        steps stay hidden — if you overspend early, you may need to go back.
      </p>
      {choicesOrderedForBudget(
        "demographicsAddons",
        FORGE_POINT_BUDGET - spendWithDraft(draft),
      ).map((c) => {
        const on = draft.includes(c.id);
        const nextIfToggle = on
          ? draft.filter((x) => x !== c.id)
          : [...draft, c.id];
        const over = spendWithDraft(nextIfToggle) > FORGE_POINT_BUDGET;
        const disableToggle = !on && over;
        return (
          <label
            key={c.id}
            className={`flex items-start gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-950 ${disableToggle ? "opacity-40" : ""}`}
          >
            <input
              type="checkbox"
              className="mt-1"
              disabled={busy || disableToggle}
              checked={on}
              onChange={() => {
                setDraft((prev) =>
                  on ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                );
              }}
            />
            <span className="text-sm">
              <span className="font-medium">{c.label}</span>{" "}
              <span className="font-mono text-zinc-500">+{c.cost}</span>
            </span>
          </label>
        );
      })}
      <button
        type="button"
        disabled={busy}
        className="w-full rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        onClick={() => void postForge({ type: "setAddons", ids: draft })}
      >
        Continue
      </button>
    </div>
  );
}
