import type { PRNG } from './prng';
import type { Organism, SimulationConfig } from './types';

/** Carry capacity for a founder (pioneer or immigrant): 1–3 units. */
export function founderCarryCapacity(config: Readonly<SimulationConfig>, prng: PRNG): number {
  return Math.min(config.maxCarryCapacity, prng.nextInt(1, 3));
}

/** A child's carry capacity: usually the parent's, occasionally one more or one less. */
export function inheritCarryCapacity(
  parentCapacity: number,
  config: Readonly<SimulationConfig>,
  prng: PRNG
): number {
  if (prng.next() >= config.traitMutationRate) return parentCapacity;
  const step = prng.next() < 0.5 ? -1 : 1;
  return Math.max(0, Math.min(config.maxCarryCapacity, parentCapacity + step));
}

/** Whether a founder can leap (1) or not (0). */
export function founderCanLeap(config: Readonly<SimulationConfig>, prng: PRNG): number {
  return prng.next() < config.founderLeapChance ? 1 : 0;
}

/** A child's leap ability: usually the parent's, flipped with probability traitMutationRate. */
export function inheritCanLeap(parentCanLeap: number, config: Readonly<SimulationConfig>, prng: PRNG): number {
  return prng.next() < config.traitMutationRate ? 1 - parentCanLeap : parentCanLeap;
}

/** Energy spent per tick just staying alive, including the upkeep of body traits. */
export function metabolismCost(organism: Readonly<Organism>, config: Readonly<SimulationConfig>): number {
  return (
    config.tickMetabolismCost +
    config.carryUpkeep * organism.carryCapacity +
    config.leapUpkeep * organism.canLeap
  );
}
