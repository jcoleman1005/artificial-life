import type { PRNG } from './prng';
import type { Organism, SimulationConfig } from './types';

/**
 * Life-history genes: when to reproduce, how much to put into a child, how
 * much fat to carry, how deep a rest to take, whether to lay eggs, and how
 * fast to live. Each has its own switch (the lock for a control arm), starts
 * every founder at a neutral or small value, and costs something:
 *
 * - threshold:  a low threshold gives more, poorer children (a flat tax each).
 * - investment: a rich child leaves the parent poorer.
 * - fat:        upkeep per unit of capacity, and a share of stored food is lost.
 * - torpor:     deeper rests save more upkeep but cost energy to act on the tick after a rest.
 * - eggs:       extra energy to lay, a decay chance, and a hatchling smaller than the egg.
 * - metabolism: a fast rate pays more upkeep and breeds sooner; a slow one pays less and waits longer.
 * - clutch:     children per mating (matings only); the pair's energy is split among them, and a
 *               clutch too poor to be viable fails (minViableChildEnergy).
 *
 * With a switch off the organism carries no such field and the world's old
 * fixed value applies, so the world is bit-identical to one without the gene.
 */

export type LifeField = 'reproThreshold' | 'investment' | 'fatCapacity' | 'torporDepth' | 'eggAllocation' | 'metabolicRate' | 'clutchSize';

export interface LifeGene {
  readonly field: LifeField;
  /** Trait id in the genome (dna.ts). */
  readonly traitId: number;
  readonly enabled: (c: Readonly<SimulationConfig>) => boolean;
  readonly founder: (c: Readonly<SimulationConfig>) => number;
  readonly step: (c: Readonly<SimulationConfig>) => number;
  readonly min: (c: Readonly<SimulationConfig>) => number;
  readonly max: (c: Readonly<SimulationConfig>) => number;
}

/** In genome (and birth PRNG draw) order. */
export const LIFE_GENES: readonly LifeGene[] = [
  {
    field: 'reproThreshold',
    traitId: 40,
    enabled: (c) => c.thresholdGeneEnabled,
    founder: (c) => c.reproductionThreshold,
    step: (c) => c.thresholdStep,
    min: (c) => c.thresholdMin,
    max: (c) => c.thresholdMax,
  },
  {
    field: 'investment',
    traitId: 41,
    enabled: (c) => c.investmentGeneEnabled,
    founder: (c) => c.reproductionEnergyFraction,
    step: (c) => c.investmentStep,
    min: (c) => c.investmentMin,
    max: (c) => c.investmentMax,
  },
  {
    field: 'fatCapacity',
    traitId: 42,
    enabled: (c) => c.fatEnabled,
    founder: (c) => c.fatFounder,
    step: (c) => c.fatStep,
    min: () => 0,
    max: (c) => c.maxFat,
  },
  {
    field: 'torporDepth',
    traitId: 43,
    enabled: (c) => c.torporEnabled,
    founder: (c) => c.torporFounder,
    step: (c) => c.torporStep,
    min: () => 0,
    max: () => 1,
  },
  {
    field: 'eggAllocation',
    traitId: 44,
    enabled: (c) => c.eggsEnabled,
    founder: (c) => c.eggFounder,
    step: (c) => c.eggStep,
    min: () => 0,
    max: () => 1,
  },
  {
    field: 'metabolicRate',
    traitId: 45,
    enabled: (c) => c.metabolismGeneEnabled,
    founder: (c) => c.metabolismFounder,
    step: (c) => c.metabolismStep,
    min: (c) => c.metabolismMin,
    max: (c) => c.metabolismMax,
  },
  {
    // Children per mating; founders 1, so the gene alone changes nothing at the start. Cloning ignores it.
    field: 'clutchSize',
    traitId: 46,
    enabled: (c) => c.clutchGeneEnabled,
    founder: () => 1,
    step: (c) => c.clutchStep,
    min: (c) => c.clutchMin,
    max: (c) => c.clutchMax,
  },
];

export const LIFE_TRAIT_BASE = 40;
export const LIFE_TRAIT_COUNT = LIFE_GENES.length;

export type LifeValues = { [F in LifeField]?: number };

export const geneForTrait = (traitId: number): LifeGene | undefined => LIFE_GENES.find((g) => g.traitId === traitId);

const round3 = (v: number) => Number(v.toFixed(3));
export const clampLife = (gene: LifeGene, v: number, c: Readonly<SimulationConfig>): number =>
  round3(Math.max(gene.min(c), Math.min(gene.max(c), v)));

/** A founder's life-history values: just the genes that are switched on, all at their starting value. No PRNG draws. */
export function founderLife(config: Readonly<SimulationConfig>): LifeValues {
  const out: LifeValues = {};
  for (const g of LIFE_GENES) if (g.enabled(config)) out[g.field] = clampLife(g, g.founder(config), config);
  return out;
}

/** A child's value: usually the parent's, occasionally one step up or down (the same draws as the other body traits). */
export function inheritLifeValue(parent: number, gene: LifeGene, config: Readonly<SimulationConfig>, prng: PRNG): number {
  if (prng.next() >= config.traitMutationRate) return parent;
  const step = prng.next() < 0.5 ? -1 : 1;
  return clampLife(gene, parent + step * gene.step(config), config);
}

/** The life-history values an organism carries (only fields that exist on it). */
export function lifeOf(o: Readonly<Organism>): LifeValues {
  const out: LifeValues = {};
  for (const g of LIFE_GENES) if (o[g.field] !== undefined) out[g.field] = o[g.field];
  return out;
}

/** Whether an organism's fields match which genes are switched on (not so for a parent from before a switch changed). */
export function lifeMatchesConfig(o: Readonly<Organism>, config: Readonly<SimulationConfig>): boolean {
  return LIFE_GENES.every((g) => (o[g.field] !== undefined) === g.enabled(config));
}

/** A parent's values brought into line with the switches: missing genes start at the founder value, switched-off ones are dropped. */
export function lifeForConfig(o: Readonly<Organism>, config: Readonly<SimulationConfig>): LifeValues {
  const out: LifeValues = {};
  for (const g of LIFE_GENES) {
    if (!g.enabled(config)) continue;
    out[g.field] = o[g.field] ?? clampLife(g, g.founder(config), config);
  }
  return out;
}

/** Legacy-path inheritance of every enabled gene, in genome order. */
export function inheritLife(parent: Readonly<Organism>, config: Readonly<SimulationConfig>, prng: PRNG): LifeValues {
  const out: LifeValues = {};
  const base = lifeForConfig(parent, config);
  for (const g of LIFE_GENES) {
    const v = base[g.field];
    if (v !== undefined) out[g.field] = inheritLifeValue(v, g, config, prng);
  }
  return out;
}

// --- reading the genes, with the world's fixed value when a gene is off ---

export const thresholdOf = (o: Readonly<Pick<Organism, 'reproThreshold'>>, c: Readonly<SimulationConfig>): number =>
  o.reproThreshold ?? c.reproductionThreshold;

export const investmentOf = (o: Readonly<Pick<Organism, 'investment'>>, c: Readonly<SimulationConfig>): number =>
  o.investment ?? c.reproductionEnergyFraction;

/** Children per mating: continuous fecundity partition, at least clutchMin (1); 1 without the gene. */
export const clutchSizeOf = (o: Readonly<Pick<Organism, 'clutchSize'>>, c: Readonly<SimulationConfig>): number =>
  c.clutchGeneEnabled ? Math.max(c.clutchMin, o.clutchSize ?? 1) : 1;

export const metabolicRateOf = (o: Readonly<Pick<Organism, 'metabolicRate'>>, c: Readonly<SimulationConfig>): number =>
  c.metabolismGeneEnabled ? (o.metabolicRate ?? 1) : 1;

/** Ticks before it may reproduce again; 0 without the metabolism gene. */
export function birthCooldownOf(o: Readonly<Pick<Organism, 'metabolicRate'>>, c: Readonly<SimulationConfig>): number {
  return c.metabolismGeneEnabled ? Math.round(c.birthCooldown / (o.metabolicRate ?? 1)) : 0;
}

export const fatRoom = (o: Readonly<Pick<Organism, 'fatCapacity' | 'fat'>>, c: Readonly<SimulationConfig>): number =>
  c.fatEnabled ? Math.max(0, (o.fatCapacity ?? 0) - (o.fat ?? 0)) : 0;

/** Upkeep multiplier on a tick spent resting: 1 awake, falling to 1 − torporSaving at full depth. */
export const torporUpkeepFactor = (o: Readonly<Pick<Organism, 'torporDepth'>>, c: Readonly<SimulationConfig>): number =>
  1 - c.torporSaving * (o.torporDepth ?? 0);
