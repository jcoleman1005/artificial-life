import type { PRNG } from './prng';
import type { Abilities, AbilityName, Organism, SimulationConfig } from './types';

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

/** Dispersal distance for a founder: 1–3 steps. */
export function founderDispersal(config: Readonly<SimulationConfig>, prng: PRNG): number {
  return Math.min(config.maxDispersal, prng.nextInt(1, 3));
}

/** A child's dispersal distance: usually the parent's, occasionally one more or one less (at least 1). */
export function inheritDispersal(parentDispersal: number, config: Readonly<SimulationConfig>, prng: PRNG): number {
  if (prng.next() >= config.traitMutationRate) return parentDispersal;
  const step = prng.next() < 0.5 ? -1 : 1;
  return Math.max(1, Math.min(config.maxDispersal, parentDispersal + step));
}

/** Movement abilities switched on in this world, in a fixed order. */
export function enabledAbilities(config: Readonly<SimulationConfig>): AbilityName[] {
  const names: AbilityName[] = [];
  if (config.diagonalMoves) names.push('diagonal');
  if (config.squeezeEnabled) names.push('squeeze');
  if (config.leapEnabled) names.push('leap');
  return names;
}

export const NO_ABILITIES: Abilities = { diagonal: 0, squeeze: 0, leap: 0 };

/**
 * A founder's movement abilities. In 'one' mode each founder gets exactly one
 * of the enabled abilities, or none, with equal chances, so lineages start out
 * specialised and selection can show which one pays.
 */
export function founderAbilities(config: Readonly<SimulationConfig>, prng: PRNG): Abilities {
  const enabled = enabledAbilities(config);
  if (config.founderAbilities === 'all') {
    return {
      diagonal: enabled.includes('diagonal') ? 1 : 0,
      squeeze: enabled.includes('squeeze') ? 1 : 0,
      leap: enabled.includes('leap') ? 1 : 0,
    };
  }
  const pick = prng.nextInt(0, enabled.length); // enabled.length means none
  return pick < enabled.length ? { ...NO_ABILITIES, [enabled[pick]]: 1 } : { ...NO_ABILITIES };
}

/** A child's abilities: the parent's, each flipped with probability abilityMutationRate. */
export function inheritAbilities(parent: Readonly<Abilities>, config: Readonly<SimulationConfig>, prng: PRNG): Abilities {
  const flip = (v: number) => (prng.next() < config.abilityMutationRate ? 1 - v : v);
  return { diagonal: flip(parent.diagonal), squeeze: flip(parent.squeeze), leap: flip(parent.leap) };
}

/** Energy spent per tick just staying alive, including the upkeep of body traits. */
export function metabolismCost(organism: Readonly<Organism>, config: Readonly<SimulationConfig>): number {
  return (
    config.tickMetabolismCost +
    config.carryUpkeep * organism.carryCapacity +
    (config.memoryEnabled ? config.memoryUpkeep * organism.memorySpan : 0) +
    // An ability only costs anything in worlds where it is enabled.
    config.abilityUpkeep *
      ((config.diagonalMoves ? organism.abilities.diagonal : 0) +
        (config.squeezeEnabled ? organism.abilities.squeeze : 0) +
        (config.leapEnabled ? organism.abilities.leap : 0))
  );
}
