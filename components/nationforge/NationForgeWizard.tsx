"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  budgetForCurrentStep,
  choiceById,
  choicesOrderedForBudget,
  computeSpend,
  computeSpendExcludingStep,
  currentSingleChoiceOnStep,
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
  naming: "Name your nation",
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

  const selections = useMemo(
    (): NationForgeSelections => progress?.selections ?? {},
    [progress],
  );

  const spentTotal = useMemo(() => computeSpend(selections), [selections]);

  const spentEarlier = useMemo(() => {
    if (!stepId || stepId === "confirm" || stepId === "naming") {
      return spentTotal;
    }
    return computeSpendExcludingStep(selections, stepId);
  }, [selections, stepId, spentTotal]);

  const budgetHere = useMemo(() => {
    if (!stepId) return FORGE_POINT_BUDGET;
    return budgetForCurrentStep(selections, stepId);
  }, [selections, stepId]);

  const currentPickId = useMemo(() => {
    if (
      !stepId ||
      stepId === "confirm" ||
      stepId === "naming" ||
      stepId === "demographicsAddons"
    ) {
      return undefined;
    }
    return currentSingleChoiceOnStep(stepId, selections);
  }, [stepId, selections]);

  const pointsLeft = FORGE_POINT_BUDGET - spentTotal;

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
        {stepId === "naming" ? STEP_HEADLINE.naming : nation.name}
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        One section at a time for your build;{" "}
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
          naming comes last
        </span>{" "}
        with an AI-suggested name you can overwrite. Every pillar also has an{" "}
        <span className="font-semibold text-zinc-800 dark:text-zinc-200">
          underfunded (0 pt)
        </span>{" "}
        choice: bank points into reserve, but your nation pays for it in-world
        with weaker stats — or use it when you cannot afford anything else.
      </p>

      <div className="mt-6 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-5 py-4 dark:border-amber-900/40 dark:bg-amber-950/30">
        {stepId === "confirm" ? (
          <>
            <p className="text-xs text-amber-950 dark:text-amber-100">
              Points remaining after full build
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-amber-950 dark:text-amber-50">
              {pointsLeft}
            </p>
            <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/90">
              Budget {FORGE_POINT_BUDGET} · Total spend {spentTotal}
            </p>
          </>
        ) : stepId === "naming" ? (
          <>
            <p className="text-xs text-amber-950 dark:text-amber-100">
              Build locked in — reserve after spend
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-amber-950 dark:text-amber-50">
              {pointsLeft}
            </p>
            <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/90">
              Total spend {spentTotal} · Next you name the polity, then review &
              forge
            </p>
          </>
        ) : stepId === "demographicsAddons" ? (
          <>
            <p className="text-xs text-amber-950 dark:text-amber-100">
              Room for optional add-ons
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-amber-950 dark:text-amber-50">
              {budgetForCurrentStep(selections, "demographicsAddons")}
            </p>
            <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/90">
              Budget {FORGE_POINT_BUDGET} · Locked before add-ons ·{" "}
              {computeSpendExcludingStep(selections, "demographicsAddons")} pts
            </p>
          </>
        ) : (
          <>
            <p className="text-xs text-amber-950 dark:text-amber-100">
              Points for this pillar (changing pick refunds its cost)
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-amber-950 dark:text-amber-50">
              {budgetHere}
            </p>
            <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/90">
              Budget {FORGE_POINT_BUDGET} · Locked in earlier pillars ·{" "}
              {spentEarlier} pts
            </p>
            {currentPickId ? (
              <p className="mt-2 text-xs font-medium text-amber-950 dark:text-amber-100">
                Current pick: {choiceById(stepId, currentPickId)?.label ?? currentPickId}{" "}
                <span className="font-mono font-normal text-amber-900/90">
                  · {choiceById(stepId, currentPickId)?.cost ?? 0} pts
                </span>
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-8">
        <p className="text-xs text-zinc-500">
          Step {progress.stepIndex + 1} of {FORGE_STEP_IDS.length}
        </p>
        <h3 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {STEP_HEADLINE[stepId]}
        </h3>
        {stepId === "naming" ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            We suggest a name from your build — edit freely, or refresh for
            another option before you review and forge.
          </p>
        ) : null}
        {currentPickId &&
        stepId !== "confirm" &&
        stepId !== "naming" &&
        stepId !== "demographicsAddons" ? (
          <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-200">
            Highlighted option below is your saved choice — pick another to replace
            it, or use Back to undo later pillars.
          </p>
        ) : null}
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

      {stepId !== "confirm" &&
      stepId !== "naming" &&
      stepId !== "demographicsAddons" ? (
        <ul className="mt-6 space-y-2">
          {choicesOrderedForBudget(stepId, budgetHere).map((c) => {
            const affordable = c.cost <= budgetHere;
            const isCurrent = c.id === currentPickId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={busy || !affordable}
                  title={
                    affordable
                      ? undefined
                      : `Need ${c.cost - budgetHere} more points on this pillar (go Back or pick a cheaper / 0 pt option).`
                  }
                  className={`flex w-full flex-col items-start rounded-xl border px-4 py-3 text-left text-sm transition hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:border-zinc-500 ${
                    isCurrent
                      ? "border-emerald-500 bg-emerald-50/90 ring-2 ring-emerald-400/60 dark:border-emerald-600 dark:bg-emerald-950/40 dark:ring-emerald-700/50"
                      : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
                  }`}
                  onClick={() => void postForge({ type: "pick", choiceId: c.id })}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    {isCurrent ? (
                      <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-emerald-500 dark:text-emerald-950">
                        Saved
                      </span>
                    ) : null}
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {c.label}{" "}
                      <span className="font-mono text-zinc-500">· {c.cost} pts</span>
                    </span>
                  </span>
                  {c.blurb ? (
                    <span className="mt-1 text-xs text-zinc-500">{c.blurb}</span>
                  ) : null}
                  {!affordable ? (
                    <span className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                      Not affordable for this pillar
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {stepId === "naming" && progress ? (
        <NamingStepSection
          sessionId={sessionId}
          token={token}
          suggested={progress.suggestedNationName}
          provisionalLabel={nation.name}
          onRefresh={onDone}
          postForge={postForge}
          busy={busy}
        />
      ) : null}

      {stepId === "demographicsAddons" && progress ? (
        <DemographicsAddonsPanel
          key={`addons-${progress.stepIndex}-${(progress.selections.demographicsAddons ?? []).join(",")}`}
          initialIds={progress.selections.demographicsAddons ?? []}
          selections={progress.selections}
          maxAddonSpend={budgetForCurrentStep(selections, "demographicsAddons")}
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

function NamingStepSection({
  sessionId,
  token,
  suggested,
  provisionalLabel,
  onRefresh,
  postForge,
  busy,
}: {
  sessionId: string;
  token: string;
  suggested?: string;
  provisionalLabel: string;
  onRefresh: () => Promise<void>;
  postForge: (body: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const userEdited = useRef(false);

  const requestSuggestion = useCallback(
    async (force: boolean) => {
      if (force) userEdited.current = false;
      setSuggestionBusy(true);
      setLocalErr(null);
      try {
        const res = await fetch(`/api/nationforge/sessions/${sessionId}/forge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            type: "loadNameSuggestion",
            ...(force ? { force: true } : {}),
          }),
        });
        const j = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        await onRefresh();
      } catch (e) {
        setLocalErr(e instanceof Error ? e.message : "Suggestion failed");
      } finally {
        setSuggestionBusy(false);
      }
    },
    [sessionId, token, onRefresh],
  );

  useEffect(() => {
    if (suggested) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await requestSuggestion(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [suggested, requestSuggestion]);

  useEffect(() => {
    if (suggested && !userEdited.current) {
      setDraft(suggested);
    }
  }, [suggested]);

  const trimmed = draft.trim();
  const canContinue =
    trimmed.length >= 1 && trimmed.length <= 80 && !busy && !suggestionBusy;

  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs text-zinc-500">
        Provisional seat label on the table:{" "}
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          {provisionalLabel}
        </span>
      </p>
      <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Nation name
        <input
          className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          value={draft}
          onChange={(e) => {
            userEdited.current = true;
            setDraft(e.target.value);
          }}
          placeholder={
            suggestionBusy && !suggested
              ? "Generating suggestion…"
              : "Your polity’s name"
          }
          maxLength={80}
          disabled={busy || suggestionBusy}
          autoComplete="off"
        />
      </label>
      {localErr ? (
        <p className="text-sm text-red-600 dark:text-red-400">{localErr}</p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={busy || suggestionBusy}
          className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
          onClick={() => void requestSuggestion(true)}
        >
          {suggestionBusy ? "…" : "Refresh suggestion"}
        </button>
        <button
          type="button"
          disabled={!canContinue}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          onClick={() => void postForge({ type: "submitNationName", name: trimmed })}
        >
          Continue to review
        </button>
      </div>
    </div>
  );
}

function DemographicsAddonsPanel({
  initialIds,
  selections,
  maxAddonSpend,
  busy,
  postForge,
}: {
  initialIds: string[];
  selections: NationForgeSelections;
  maxAddonSpend: number;
  busy: boolean;
  postForge: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string[]>(() => [...initialIds]);

  const spendWithDraft = (ids: string[]) =>
    computeSpend({ ...selections, demographicsAddons: ids });

  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        You can spend up to{" "}
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
          {maxAddonSpend} pts
        </span>{" "}
        on add-ons (empty is fine). Remaining with this draft:{" "}
        <span className="font-mono">
          {FORGE_POINT_BUDGET - spendWithDraft(draft)}
        </span>
      </p>
      <p className="text-xs text-zinc-500">
        Toggle any combination that fits. If you went Back, later pillars were
        cleared so your budget matches this screen.
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
