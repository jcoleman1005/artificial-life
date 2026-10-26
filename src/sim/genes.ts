import type { PRNG } from './prng';

/**
 * A small gene registry: each gene is a number with a range, a founder range,
 * a mutation size and optionally a budget group. Founders, inheritance,
 * clamping, budgets and locking work the same for every gene table, so new
 * evolvable numbers (plant genes, organism body traits) only need a table.
 */
export interface GeneDef {
  readonly min: number;
  readonly max: number;
  /** Founders (and random newcomers) draw uniformly from this range. */
  readonly founderMin: number;
  readonly founderMax: number;
  /** Value used when genes are locked (no variation, no mutation). Default: the founder range's midpoint. */
  readonly locked?: number;
  /** Mutation size as a fraction of the range; defaults to the caller's. */
  readonly mutationSd?: number;
  /** Genes in the same group share a budget (their sum is capped). */
  readonly budgetGroup?: string;
}

export type GeneTable<K extends string> = Readonly<Record<K, GeneDef>>;
export type Genes<K extends string> = Readonly<Record<K, number>>;

export interface InheritOptions {
  /** Probability each gene mutates. */
  readonly rate: number;
  /** Mutation size (fraction of the range) for genes without their own. */
  readonly sd: number;
  /** Cap on the sum of each budget group's genes. */
  readonly budgets?: Readonly<Record<string, number>>;
  /** Genes never change: children copy their parent, and no randomness is drawn. */
  readonly locked?: boolean;
}

/** Genes are stored to 4 decimals, so saves stay small and readable. */
const round4 = (v: number) => Number(v.toFixed(4));

export const geneKeys = <K extends string>(table: GeneTable<K>): K[] => Object.keys(table) as K[];

export function clampGene(def: GeneDef, v: number): number {
  return Math.max(def.min, Math.min(def.max, v));
}

export function lockedGenes<K extends string>(table: GeneTable<K>): Genes<K> {
  const genes = {} as Record<K, number>;
  for (const key of geneKeys(table)) {
    const d = table[key];
    genes[key] = round4(d.locked ?? (d.founderMin + d.founderMax) / 2);
  }
  return genes;
}

/**
 * Scales each over-budget group down in proportion (to the group's floor of
 * min values), so the group's sum equals its cap. Groups at or under budget
 * are untouched.
 */
export function applyBudgets<K extends string>(
  table: GeneTable<K>,
  genes: Record<K, number>,
  budgets: Readonly<Record<string, number>> | undefined
): void {
  if (!budgets) return;
  for (const [group, cap] of Object.entries(budgets)) {
    const keys = geneKeys(table).filter((k) => table[k].budgetGroup === group);
    const sum = keys.reduce((s, k) => s + genes[k], 0);
    if (sum <= cap) continue;
    const floor = keys.reduce((s, k) => s + table[k].min, 0);
    const scale = sum > floor ? Math.max(0, (cap - floor) / (sum - floor)) : 0;
    // Round down so rounding never lifts the sum back over the cap.
    for (const k of keys) {
      const d = table[k];
      genes[k] = Math.floor((d.min + (genes[k] - d.min) * scale) * 1e4) / 1e4;
    }
  }
}

/** Genes for a founder: uniform in each founder range, then budgeted. */
export function founderGenes<K extends string>(
  table: GeneTable<K>,
  prng: PRNG,
  options: Pick<InheritOptions, 'budgets' | 'locked'> = {}
): Genes<K> {
  if (options.locked) return lockedGenes(table);
  const genes = {} as Record<K, number>;
  for (const key of geneKeys(table)) {
    const d = table[key];
    genes[key] = round4(prng.nextFloat(d.founderMin, d.founderMax));
  }
  applyBudgets(table, genes, options.budgets);
  return genes;
}

/** A child's genes: the parent's, each mutated now and then, clamped, then budgeted. */
export function inheritGenes<K extends string>(
  table: GeneTable<K>,
  parent: Genes<K>,
  prng: PRNG,
  options: InheritOptions
): Genes<K> {
  if (options.locked) return { ...parent };
  const genes = {} as Record<K, number>;
  for (const key of geneKeys(table)) {
    const d = table[key];
    let v = parent[key];
    if (prng.next() < options.rate) {
      v += prng.nextGaussian(0, (d.mutationSd ?? options.sd) * (d.max - d.min));
    }
    genes[key] = round4(clampGene(d, v));
  }
  applyBudgets(table, genes, options.budgets);
  return genes;
}
