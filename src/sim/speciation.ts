import { GENE_WORDS, GeneClass, TraitId, geneClassOf, geneCount, geneDose, geneIndexOf } from './dna';
import { geneForTrait } from './lifehistory';
import type { SimulationConfig } from './types';

/**
 * Reproductive isolation from genome distance (docs/specs/speciation.md).
 * Pure functions, no PRNG: crosses between genomes that have drifted far
 * apart yield children that may be inviable. Nothing here tells an organism
 * whom to mate with; the hue tag is excluded from the distance on purpose, so
 * it stays a neutral marker.
 */

/** The size of a typical difference for a trait gene, so every trait counts on a 0..1 scale. */
function traitScale(id: number, config: Readonly<SimulationConfig>): number {
  const life = geneForTrait(id);
  if (life) return Math.max(1e-9, life.max(config) - life.min(config));
  if (id >= TraitId.memoryWeight0 && id < TraitId.memoryWeight0 + 30) return config.genomeDistanceBrainScale;
  switch (id) {
    case TraitId.carryCapacity:
      return Math.max(1, config.maxCarryCapacity);
    case TraitId.dispersal:
      return Math.max(1, config.maxDispersal - 1);
    case TraitId.memorySpan:
      return Math.max(1, config.maxMemorySpan);
    default:
      return 1; // abilities, diets: already in [0, 1]
  }
}

function scaleFor(key: number, config: Readonly<SimulationConfig>): number {
  return geneClassOf(key) === GeneClass.trait ? traitScale(geneIndexOf(key), config) : config.genomeDistanceBrainScale;
}

/** Mean dose per key. A duplicated key (DNA Stage 2) counts as the mean of its copies. */
function dosesByKey(dna: ArrayLike<number>): Map<number, number> {
  const sums = new Map<number, { sum: number; n: number }>();
  const n = geneCount(dna);
  for (let g = 0; g < n; g++) {
    const at = g * GENE_WORDS;
    const key = dna[at];
    if (geneClassOf(key) === GeneClass.trait && geneIndexOf(key) === TraitId.tag) continue; // hue stays neutral
    const dose = geneDose(dna, at);
    const slot = sums.get(key);
    if (slot) {
      slot.sum += dose;
      slot.n++;
    } else sums.set(key, { sum: dose, n: 1 });
  }
  const means = new Map<number, number>();
  for (const [key, { sum, n: copies }] of sums) means.set(key, sum / copies);
  return means;
}

/**
 * How far apart two genomes are, in [0, 1]: the mean over the genes either has
 * (the hue gene aside) of the dose difference as a fraction of the gene's scale,
 * capped at 1. A gene only one genome has counts 1. Iterates `a`'s genes in
 * order, then the genes only `b` has in `b`'s order, so the sum is deterministic.
 */
export function genomeDistance(a: ArrayLike<number>, b: ArrayLike<number>, config: Readonly<SimulationConfig>): number {
  const da = dosesByKey(a);
  const db = dosesByKey(b);
  let total = 0;
  let count = 0;
  for (const [key, x] of da) {
    const y = db.get(key);
    total += y === undefined ? 1 : Math.min(1, Math.abs(x - y) / scaleFor(key, config));
    count++;
  }
  for (const key of db.keys()) {
    if (da.has(key)) continue;
    total += 1;
    count++;
  }
  return count === 0 ? 0 : total / count;
}

/** 0 at or below hybridTolerance, 1 at or above hybridFull, linear between. */
export function hybridIncompatibility(distance: number, config: Readonly<SimulationConfig>): number {
  const span = config.hybridFull - config.hybridTolerance;
  if (span <= 0) return distance > config.hybridTolerance ? 1 : 0;
  return Math.min(1, Math.max(0, (distance - config.hybridTolerance) / span));
}

/**
 * The chance each child of a cross with this genome distance is inviable. With
 * hybridControlInviability above 0 (the matched-random control arm) it is that
 * flat rate whatever the distance, so the arm costs matings the same overall
 * but not by distance.
 */
export function hybridInviableChance(distance: number, config: Readonly<SimulationConfig>): number {
  if (config.hybridControlInviability > 0) return config.hybridControlInviability;
  return config.hybridMaxInviability * hybridIncompatibility(distance, config);
}
