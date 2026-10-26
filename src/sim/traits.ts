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

/** Stage 1b.1: abilities are efficiencies in [0, 1] (DNA only). */
export const continuousAbilities = (config: Readonly<SimulationConfig>): boolean =>
  config.dnaEnabled && config.dnaContinuousAbilities;

/** Stage 1b.2: independent plant and meat efficiencies (DNA only). */
export const splitDiets = (config: Readonly<SimulationConfig>): boolean => config.dnaEnabled && config.dnaSplitDiets;

/** A child's ability efficiency: usually the parent's, occasionally drifted (kept in 0..1; 0 means not held). */
export function inheritAbilityEfficiency(parent: number, config: Readonly<SimulationConfig>, prng: PRNG): number {
  if (prng.next() >= config.traitMutationRate) return parent;
  const next = parent + prng.nextGaussian(0, config.abilityMutationStdDev);
  return Number(Math.max(0, Math.min(1, next)).toFixed(3));
}

/**
 * Energy for a successful move. Binary abilities: diagonals cost
 * diagonalMoveCost, squeezing multiplies the move's cost by
 * squeezeCostMultiplier, a leap costs leapCostMultiplier (all × moveCost).
 * Continuous abilities scale smoothly with efficiency e, matching the binary
 * cost at e = 1 for squeeze and leap, and an orthogonal step for a diagonal:
 * diagonal diagonalMoveCost − (diagonalMoveCost − 1)·e (1.4 − 0.4e),
 * squeeze squeezeCostMultiplier + 1 − e (3 − e), leap leapCostMultiplier + 1 − e (3.5 − e).
 */
export function moveEnergyCost(
  abilities: Readonly<Abilities>,
  move: { readonly leap: boolean; readonly diagonal: boolean; readonly squeeze: boolean },
  config: Readonly<SimulationConfig>
): number {
  const { moveCost } = config;
  if (!continuousAbilities(config)) {
    return move.leap
      ? moveCost * config.leapCostMultiplier
      : moveCost * (move.diagonal ? config.diagonalMoveCost : 1) * (move.squeeze ? config.squeezeCostMultiplier : 1);
  }
  if (move.leap) return moveCost * (config.leapCostMultiplier + 1 - abilities.leap);
  const diagonal = move.diagonal ? config.diagonalMoveCost - (config.diagonalMoveCost - 1) * abilities.diagonal : 1;
  const squeeze = move.squeeze ? config.squeezeCostMultiplier + 1 - abilities.squeeze : 1;
  return moveCost * diagonal * squeeze;
}

/**
 * Plant-eating efficiency under split diets. Organisms from before split
 * diets were on keep the plant yield their carnivory gave them.
 */
export function herbivoryOf(organism: Readonly<Pick<Organism, 'carnivory' | 'herbivory'>>, config: Readonly<SimulationConfig>): number {
  return organism.herbivory ?? Math.max(0, 1 - config.dietTradeoff * organism.carnivory);
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
        (config.leapEnabled ? organism.abilities.leap : 0)) +
    (splitDiets(config) ? config.dietUpkeep * (herbivoryOf(organism, config) + organism.carnivory) : 0)
  );
}

/** A founder's diet: mostly a plant eater (carnivory 0–0.2), so any taste for meat has to evolve. */
export function founderCarnivory(prng: PRNG): number {
  return Number(prng.nextFloat(0, 0.2).toFixed(3));
}

/** A child's diet: usually the parent's, occasionally shifted a little (kept in 0..1). */
export function inheritCarnivory(parent: number, config: Readonly<SimulationConfig>, prng: PRNG): number {
  if (prng.next() >= config.traitMutationRate) return parent;
  const next = parent + prng.nextGaussian(0, config.carnivoryMutationStdDev);
  return Number(Math.max(0, Math.min(1, next)).toFixed(3));
}

/** Energy from one unit of plant food: less for meat eaters, when carrion is on; herbivory × yield with split diets. */
export function plantYield(organism: Readonly<Pick<Organism, 'carnivory' | 'herbivory'>>, config: Readonly<SimulationConfig>): number {
  if (splitDiets(config)) return config.foodEnergyYield * herbivoryOf(organism, config);
  if (!config.carrionEnabled) return config.foodEnergyYield;
  return config.foodEnergyYield * (1 - config.dietTradeoff * organism.carnivory);
}

/** Energy from a full carrion meal (carrionBite of carrion energy); 0 when carrion is off. */
export function carrionYield(organism: Readonly<Pick<Organism, 'carnivory'>>, config: Readonly<SimulationConfig>): number {
  return config.carrionEnabled ? config.carrionBite * organism.carnivory : 0;
}

/** Carrion energy a body leaves: a fixed amount plus a share of what it still held. Never more than the body cost. */
export function carrionFromBody(bodyEnergy: number, config: Readonly<SimulationConfig>): number {
  return config.carrionBodyEnergy + config.carrionEfficiency * Math.max(0, bodyEnergy);
}

/**
 * The chance an attack kills: the attacker's share of the two energies,
 * scaled by bite strength (bitePowerMin for a plant eater up to 1 for a full
 * meat eater). Prey that moves out of reach that tick escapes regardless.
 */
export function killChance(
  attacker: Readonly<Pick<Organism, 'energy' | 'carnivory'>>,
  prey: Readonly<Pick<Organism, 'energy'>>,
  config: Readonly<SimulationConfig>
): number {
  const total = attacker.energy + prey.energy;
  const share = total > 0 ? attacker.energy / total : 0;
  const bite = config.bitePowerMin + (1 - config.bitePowerMin) * attacker.carnivory;
  return share * bite;
}
