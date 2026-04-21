/**
 * NationForge 100-point nation builder — option ids, costs, and step order.
 * Server is authoritative: clients display choices; spend and caps are enforced here.
 */

export const FORGE_POINT_BUDGET = 100;

export const FORGE_STEP_IDS = [
  "government",
  "economy",
  "labor",
  "military",
  "education",
  "infrastructure",
  "foreignPolicy",
  "demographics",
  "demographicsAddons",
  "cultural",
  "environment",
  "confirm",
] as const;

export type ForgeStepId = (typeof FORGE_STEP_IDS)[number];

export type ForgeChoice = {
  id: string;
  label: string;
  cost: number;
  blurb?: string;
};

export type NationForgeSelections = {
  government?: string;
  economy?: string;
  labor?: string;
  military?: string;
  education?: string;
  infrastructure?: string;
  foreignPolicy?: string;
  demographics?: string;
  demographicsAddons?: string[];
  cultural?: string;
  environment?: string;
};

const GOVERNMENT: ForgeChoice[] = [
  { id: "gov-anarchy", label: "Anarchy", cost: 5, blurb: "Max freedom, chaos risk." },
  { id: "gov-tyranny", label: "Tyranny / Dictatorship", cost: 8, blurb: "Fast decisions, unrest risk." },
  { id: "gov-totalitarian", label: "Totalitarian state", cost: 10, blurb: "Total control, low freedom." },
  { id: "gov-monarchy", label: "Monarchy", cost: 12, blurb: "Tradition, moderate freedom." },
  { id: "gov-oligarchy", label: "Oligarchy", cost: 15, blurb: "Elite rule, wealth tilt." },
  { id: "gov-auth-republic", label: "Authoritarian republic", cost: 16, blurb: "Control + elections." },
  { id: "gov-rep-democracy", label: "Representative democracy", cost: 20, blurb: "Legitimacy, slower bureaucracy." },
  { id: "gov-direct-democracy", label: "Direct democracy", cost: 25, blurb: "Participation, gridlock risk." },
  { id: "gov-theocracy", label: "Theocracy", cost: 18, blurb: "Cohesion if aligned; else divisive." },
];

const ECONOMY: ForgeChoice[] = [
  { id: "econ-feudal", label: "Feudal / mercantilism", cost: 8, blurb: "Stable, slower growth." },
  { id: "econ-capitalism", label: "Pure capitalism", cost: 12, blurb: "Fast growth, inequality." },
  { id: "econ-corporatism", label: "Corporatism", cost: 14, blurb: "State + business alignment." },
  { id: "econ-regulated", label: "Regulated capitalism", cost: 18, blurb: "Growth + safety nets." },
  { id: "econ-social-dem", label: "Social democracy / mixed", cost: 20, blurb: "Welfare, moderate growth." },
  { id: "econ-socialism", label: "Socialism", cost: 22, blurb: "Equality focus, slower innovation." },
  { id: "econ-communism", label: "Full communism", cost: 28, blurb: "Equality, inefficiency risk." },
];

const LABOR: ForgeChoice[] = [
  { id: "labor-slavery", label: "Slavery", cost: 6, blurb: "Cheap labor; revolt & diplomatic risk." },
  { id: "labor-serfdom", label: "Serfdom / feudal labor", cost: 10, blurb: "Hierarchy, low mobility." },
  { id: "labor-collectivism", label: "Collectivism", cost: 15, blurb: "Group loyalty, less individual drive." },
  { id: "labor-limited", label: "Limited freedoms", cost: 12, blurb: "Pragmatic middle." },
  { id: "labor-individual", label: "Full individual liberty", cost: 18, blurb: "Innovation & happiness; cohesion cost." },
];

const MILITARY: ForgeChoice[] = [
  { id: "mil-0", label: "Minimal / no standing army", cost: 0 },
  { id: "mil-10", label: "Regional defense", cost: 10 },
  { id: "mil-20", label: "Strong professional army", cost: 20 },
  { id: "mil-30", label: "Global superpower projection", cost: 30 },
];

const EDUCATION: ForgeChoice[] = [
  { id: "edu-5", label: "Basic literacy", cost: 5 },
  { id: "edu-12", label: "Universal secondary", cost: 12 },
  { id: "edu-20", label: "World-class universities + STEM", cost: 20 },
  { id: "edu-25", label: "Elite R&D / abstract human-capital boost", cost: 25 },
];

const INFRASTRUCTURE: ForgeChoice[] = [
  { id: "infra-5", label: "Basic roads & power", cost: 5 },
  { id: "infra-12", label: "Modern networks", cost: 12 },
  { id: "infra-20", label: "High-speed + green mega-projects", cost: 20 },
];

const FOREIGN: ForgeChoice[] = [
  { id: "for-iso", label: "Isolationist", cost: 5 },
  { id: "for-def", label: "Defensive alliances", cost: 10 },
  { id: "for-exp", label: "Aggressive expansionist", cost: 15 },
  { id: "for-soft", label: "Global diplomat / soft power", cost: 12 },
];

const DEMOGRAPHICS: ForgeChoice[] = [
  { id: "demo-closed", label: "Closed borders / cultural homogeneity", cost: 8, blurb: "Cohesion; less diversity." },
  { id: "demo-controlled", label: "Controlled immigration", cost: 12, blurb: "Balanced growth." },
  { id: "demo-open", label: "Open multiculturalism", cost: 18, blurb: "Innovation tilt; integration cost." },
];

const DEMO_ADDONS: ForgeChoice[] = [
  { id: "demo-add-eugenics", label: "Advanced genetic screening (sci-fi boost, abstract)", cost: 15 },
  { id: "demo-add-natalist", label: "Pro-natalist incentives", cost: 8 },
  { id: "demo-add-antinatal", label: "Anti-natalist / quality-over-quantity", cost: 10 },
];

const CULTURAL: ForgeChoice[] = [
  { id: "cul-trad", label: "Traditional / nationalist", cost: 8 },
  { id: "cul-mil", label: "Militaristic / warrior culture", cost: 10 },
  { id: "cul-prog", label: "Progressive / cosmopolitan", cost: 14 },
  { id: "cul-pac", label: "Pacifist / eco-focused", cost: 15 },
  { id: "cul-hedon", label: "Hedonistic / consumer culture", cost: 12 },
];

const ENVIRONMENT: ForgeChoice[] = [
  { id: "env-0", label: "Exploit freely (0)", cost: 0, blurb: "Short boom; long-term risk." },
  { id: "env-8", label: "Balanced green policy", cost: 8 },
  { id: "env-15", label: "Full eco-civilization", cost: 15, blurb: "Happiness tilt; growth cost." },
];

const CHOICE_INDEX: Record<ForgeStepId, ForgeChoice[] | null> = {
  government: GOVERNMENT,
  economy: ECONOMY,
  labor: LABOR,
  military: MILITARY,
  education: EDUCATION,
  infrastructure: INFRASTRUCTURE,
  foreignPolicy: FOREIGN,
  demographics: DEMOGRAPHICS,
  demographicsAddons: DEMO_ADDONS,
  cultural: CULTURAL,
  environment: ENVIRONMENT,
  confirm: null,
};

export function choicesForStep(stepId: ForgeStepId): ForgeChoice[] | null {
  return CHOICE_INDEX[stepId] ?? null;
}

export function choiceById(stepId: ForgeStepId, id: string): ForgeChoice | undefined {
  const list = choicesForStep(stepId);
  return list?.find((c) => c.id === id);
}

/** Spend from locked-in selections only (addons = chosen list). */
export function computeSpend(s: NationForgeSelections): number {
  let total = 0;
  const add = (stepId: ForgeStepId, id: string | undefined) => {
    if (!id) return;
    const c = choiceById(stepId, id);
    if (c) total += c.cost;
  };
  add("government", s.government);
  add("economy", s.economy);
  add("labor", s.labor);
  add("military", s.military);
  add("education", s.education);
  add("infrastructure", s.infrastructure);
  add("foreignPolicy", s.foreignPolicy);
  add("demographics", s.demographics);
  for (const id of s.demographicsAddons ?? []) {
    add("demographicsAddons", id);
  }
  add("cultural", s.cultural);
  add("environment", s.environment);
  return total;
}

export function remainingPoints(s: NationForgeSelections): number {
  return FORGE_POINT_BUDGET - computeSpend(s);
}

export function stepIdAtIndex(index: number): ForgeStepId | undefined {
  return FORGE_STEP_IDS[index];
}

export function isForgeSelectionsComplete(s: NationForgeSelections): boolean {
  return (
    Boolean(s.government && s.economy && s.labor) &&
    Boolean(s.military && s.education && s.infrastructure) &&
    Boolean(s.foreignPolicy && s.demographics) &&
    Array.isArray(s.demographicsAddons) &&
    Boolean(s.cultural && s.environment)
  );
}
