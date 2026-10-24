import type { PRNG } from './prng';
import type { SimulationConfig } from './types';

/** Shortest distance between two hues on the colour wheel, in [0, 180]. */
export function tagDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Whether two tags look alike to the organisms (a fixed perceptual ability). */
export function isKin(a: number, b: number, config: Readonly<SimulationConfig>): boolean {
  return tagDistance(a, b) <= config.kinToleranceDegrees;
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
