import type { NationForgeSelections } from "./nation-forge-catalog";
import {
  choiceById,
  computeSpend,
  FORGE_POINT_BUDGET,
  isForgeSelectionsComplete,
} from "./nation-forge-catalog";
import type { NationStats } from "./schema";
import { STAT_KEYS } from "./schema";
import { clampStat } from "./validation";

export type StatHints = Partial<Record<(typeof STAT_KEYS)[number], number>>;

function labelFor(stepId: Parameters<typeof choiceById>[0], id: string): string {
  return choiceById(stepId, id)?.label ?? id;
}

/** Per-choice rough stat tilts (additive before synergies). */
function hintsForSelections(s: NationForgeSelections): StatHints {
  const acc: StatHints = {};
  const add = (h: StatHints) => {
    for (const k of STAT_KEYS) {
      const v = h[k];
      if (v === undefined) continue;
      acc[k] = (acc[k] ?? 0) + v;
    }
  };

  if (s.government) {
    const g = {
      "gov-anarchy": { freedom: 12, stability: -10, power: -6 },
      "gov-tyranny": { power: 10, freedom: -12, stability: -4 },
      "gov-totalitarian": { power: 14, freedom: -18, stability: 4 },
      "gov-monarchy": { stability: 8, freedom: -2, prosperity: 2 },
      "gov-oligarchy": { prosperity: 8, freedom: -6, happiness: -4 },
      "gov-auth-republic": { power: 6, stability: 4, freedom: -6 },
      "gov-rep-democracy": { happiness: 8, stability: 6, power: -4 },
      "gov-direct-democracy": { freedom: 14, happiness: 6, stability: -8 },
      "gov-theocracy": { stability: 6, innovation: -4, happiness: 4 },
    }[s.government];
    if (g) add(g);
  }
  if (s.economy) {
    const e = {
      "econ-feudal": { stability: 6, innovation: -4, prosperity: 2 },
      "econ-capitalism": { prosperity: 12, happiness: -6, innovation: 6 },
      "econ-corporatism": { power: 8, prosperity: 6, freedom: -8 },
      "econ-regulated": { prosperity: 6, happiness: 6, stability: 4 },
      "econ-social-dem": { happiness: 10, prosperity: 4, innovation: 2 },
      "econ-socialism": { happiness: 8, prosperity: 2, innovation: -6 },
      "econ-communism": { happiness: 6, stability: 4, prosperity: -8, innovation: -8 },
    }[s.economy];
    if (e) add(e);
  }
  if (s.labor) {
    const l = {
      "labor-slavery": { prosperity: 6, freedom: -20, happiness: -16, stability: -12 },
      "labor-serfdom": { stability: 4, freedom: -10, innovation: -6 },
      "labor-collectivism": { stability: 6, happiness: 2, innovation: -4 },
      "labor-limited": { stability: 2, freedom: 2 },
      "labor-individual": { freedom: 12, innovation: 10, happiness: 6, stability: -4 },
    }[s.labor];
    if (l) add(l);
  }
  if (s.military) {
    const m = {
      "mil-0": { power: -6, prosperity: 2 },
      "mil-10": { power: 6, stability: 2 },
      "mil-20": { power: 12, stability: 4, prosperity: -2 },
      "mil-30": { power: 18, stability: 2, happiness: -4, innovation: 2 },
    }[s.military];
    if (m) add(m);
  }
  if (s.education) {
    const ed = {
      "edu-5": { innovation: 2 },
      "edu-12": { innovation: 8, prosperity: 4 },
      "edu-20": { innovation: 14, prosperity: 6 },
      "edu-25": { innovation: 18, prosperity: 4, happiness: 2 },
    }[s.education];
    if (ed) add(ed);
  }
  if (s.infrastructure) {
    const inf = {
      "infra-5": { prosperity: 4 },
      "infra-12": { prosperity: 10, innovation: 4 },
      "infra-20": { prosperity: 12, happiness: 6, innovation: 4 },
    }[s.infrastructure];
    if (inf) add(inf);
  }
  if (s.foreignPolicy) {
    const f = {
      "for-iso": { stability: 4, power: -4 },
      "for-def": { stability: 6, power: 4 },
      "for-exp": { power: 10, stability: -6, prosperity: 4 },
      "for-soft": { happiness: 6, innovation: 4, power: 2 },
    }[s.foreignPolicy];
    if (f) add(f);
  }
  if (s.demographics) {
    const d = {
      "demo-closed": { stability: 8, innovation: -2, happiness: -2 },
      "demo-controlled": { stability: 4, prosperity: 4 },
      "demo-open": { innovation: 10, happiness: 4, stability: -4 },
    }[s.demographics];
    if (d) add(d);
  }
  for (const id of s.demographicsAddons ?? []) {
    if (id === "demo-add-eugenics") add({ innovation: 10, prosperity: 4, happiness: -6 });
    if (id === "demo-add-natalist") add({ prosperity: 6, stability: -2 });
    if (id === "demo-add-antinatal") add({ prosperity: 4, happiness: 4, innovation: 2 });
  }
  if (s.cultural) {
    const c = {
      "cul-trad": { stability: 8, innovation: -4 },
      "cul-mil": { power: 8, happiness: 2, innovation: -2 },
      "cul-prog": { innovation: 8, freedom: 6, stability: -2 },
      "cul-pac": { happiness: 10, power: -6, prosperity: 2 },
      "cul-hedon": { happiness: 10, stability: -4, prosperity: 6 },
    }[s.cultural];
    if (c) add(c);
  }
  if (s.environment) {
    const env = {
      "env-0": { prosperity: 8, happiness: -4, stability: -4 },
      "env-8": { happiness: 6, prosperity: 2, innovation: 2 },
      "env-15": { happiness: 12, prosperity: -4, innovation: 4 },
    }[s.environment];
    if (env) add(env);
  }
  return acc;
}

export type SynergyLine = { label: string; hints: StatHints };

export function computeSynergies(s: NationForgeSelections): SynergyLine[] {
  const out: SynergyLine[] = [];
  if (s.economy === "econ-capitalism" && s.labor === "labor-individual") {
    out.push({
      label: "Open markets + free labor: prosperity surge.",
      hints: { prosperity: 10, innovation: 4, stability: -3 },
    });
  }
  if (s.economy === "econ-corporatism") {
    const authGov = new Set([
      "gov-tyranny",
      "gov-totalitarian",
      "gov-oligarchy",
      "gov-auth-republic",
      "gov-theocracy",
    ]);
    if (s.government && authGov.has(s.government)) {
      out.push({
        label: "Corporatism + authoritarian cohesion: coordinated industrial policy.",
        hints: { power: 8, prosperity: 4, freedom: -4 },
      });
    }
  }
  if (s.economy === "econ-communism" && s.labor === "labor-collectivism") {
    out.push({
      label: "Planned equality + collectivist norms: stability from shared sacrifice.",
      hints: { stability: 8, happiness: 4, innovation: -6 },
    });
  }
  if (s.demographics === "demo-open" && s.cultural === "cul-prog") {
    out.push({
      label: "Open society + cosmopolitan culture: creative ferment.",
      hints: { innovation: 8, happiness: 6 },
    });
  }
  if (s.foreignPolicy === "for-soft" && s.education === "edu-20") {
    out.push({
      label: "Soft power + elite education: diplomatic and scientific reach.",
      hints: { innovation: 4, happiness: 4, power: 4 },
    });
  }
  if (s.military === "mil-30" && s.cultural === "cul-mil") {
    out.push({
      label: "Superpower posture + warrior culture: deterrence premium.",
      hints: { power: 6, stability: 4 },
    });
  }
  return out;
}

function baseStats(): NationStats {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, 48])) as NationStats;
}

export function resolveForgeToNation(s: NationForgeSelections): {
  stats: NationStats;
  reserve: number;
  buildNotes: string;
  synergyLines: string[];
  spend: number;
} | { ok: false; error: string } {
  if (!isForgeSelectionsComplete(s)) {
    return { ok: false, error: "Nation build is incomplete." };
  }
  const spend = computeSpend(s);
  if (spend > FORGE_POINT_BUDGET) {
    return { ok: false, error: `Spend ${spend} exceeds ${FORGE_POINT_BUDGET} points.` };
  }
  const reserve = FORGE_POINT_BUDGET - spend;
  const stats = { ...baseStats() };
  const hints = hintsForSelections(s);
  const synergies = computeSynergies(s);
  const synergyLines = synergies.map((x) => x.label);
  for (const k of STAT_KEYS) {
    let v = stats[k] + (hints[k] ?? 0);
    for (const syn of synergies) {
      v += syn.hints[k] ?? 0;
    }
    stats[k] = clampStat(v);
  }
  /** Reserve nudges stability (rule text). */
  stats.stability = clampStat(stats.stability + Math.floor(reserve / 4));

  const lines: string[] = [
    "NationForge 100-point build (authoritative picks):",
    `Government: ${labelFor("government", s.government!)}`,
    `Economy: ${labelFor("economy", s.economy!)}`,
    `Labor & rights: ${labelFor("labor", s.labor!)}`,
    `Military: ${labelFor("military", s.military!)}`,
    `Education: ${labelFor("education", s.education!)}`,
    `Infrastructure: ${labelFor("infrastructure", s.infrastructure!)}`,
    `Foreign policy: ${labelFor("foreignPolicy", s.foreignPolicy!)}`,
    `Demographics: ${labelFor("demographics", s.demographics!)}`,
    `Demographics add-ons: ${(s.demographicsAddons ?? []).map((id) => labelFor("demographicsAddons", id)).join(", ") || "none"}`,
    `Culture: ${labelFor("cultural", s.cultural!)}`,
    `Environment: ${labelFor("environment", s.environment!)}`,
    `Spend: ${spend} pts · Reserve: ${reserve} (feeds stability via NationForge rules)`,
  ];
  if (synergyLines.length) {
    lines.push("Synergies applied:", ...synergyLines.map((l) => `· ${l}`));
  }
  const buildNotes = lines.join("\n");
  return { stats, reserve, buildNotes, synergyLines, spend };
}
