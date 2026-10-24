import type { PRNG } from './prng';
import type { PolicyWeights, SimulationConfig } from './types';

/** Shortest distance between two hues on the colour wheel, in [0, 180]. */
export function tagDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** How alike two tags look: 1 = identical hue, 0 = opposite sides of the wheel. */
export function tagSimilarity(a: number, b: number): number {
  return 1 - tagDistance(a, b) / 180;
}

/** Whether two tags count as kin for metrics and the inspector (a fixed perceptual threshold). */
export function isKin(a: number, b: number, config: Readonly<SimulationConfig>): boolean {
  return tagSimilarity(a, b) >= config.kinSimilarity;
}

/**
 * The sharing weight an organism applies to a neighbour of the given
 * similarity: its shareWithKin weight at or above kinSimilarity, its
 * shareWithStrangers weight at or below strangerSimilarity, and a linear
 * blend in between. Both ends evolve; only the cut-offs are fixed.
 */
export function shareWeightFor(
  policy: Readonly<PolicyWeights>,
  similarity: number,
  config: Readonly<SimulationConfig>
): number {
  const span = config.kinSimilarity - config.strangerSimilarity;
  const t = span > 0 ? (similarity - config.strangerSimilarity) / span : similarity >= config.kinSimilarity ? 1 : 0;
  const blend = Math.min(1, Math.max(0, t));
  return policy.shareWithStrangers + (policy.shareWithKin - policy.shareWithStrangers) * blend;
}

/** A child's tag: usually the parent's, occasionally nudged around the wheel. */
export function inheritTag(
  parentTag: number,
  config: Readonly<SimulationConfig>,
  prng: PRNG
): number {
  if (prng.next() >= config.tagMutationRate) return parentTag;
  const shifted = parentTag + prng.nextGaussian(0, config.tagMutationStdDev);
  return Number((((shifted % 360) + 360) % 360).toFixed(2));
}
