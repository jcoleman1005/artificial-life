import type { PRNG } from './prng';
import type { Abilities, AbilityName, Organism, SimulationConfig } from './types';
import { carnivoreEfficiencyOf, digestiveEfficiencyOf, maxEnergyOf, metabolicRateOf, sizeOf } from './lifehistory';
import { bodyScaleOf, senescenceFactorOf } from './growth';

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
  subject: Readonly<Abilities> | Readonly<Pick<Organism, 'abilities' | 'size' | 'fat' | 'fatCapacity' | 'maturity' | 'toughness'>>,
  move: { readonly leap: boolean; readonly diagonal: boolean; readonly squeeze: boolean },
  config: Readonly<SimulationConfig>
): number {
  const isOrganism = 'abilities' in subject || 'size' in subject || 'fat' in subject || 'toughness' in subject;
  const abilities = isOrganism ? (subject as Pick<Organism, 'abilities'>).abilities : (subject as Abilities);
  let moveCost = config.moveCost;
  if (isOrganism) {
    const org = subject as Pick<Organism, 'abilities' | 'size' | 'fat' | 'fatCapacity' | 'maturity' | 'toughness'>;
    // Mass moved: the size gene's, times body scale while growing (1 when grown).
    const size = sizeOf(org, config) * bodyScaleOf(org, config);
    moveCost *= size;
    if (config.fatEnabled && config.fatDragCoeff > 0) {
      const fat = org.fat ?? 0;
      if (fat > 0) {
        const capacity = maxEnergyOf(org, config) + Math.max(1, org.fatCapacity ?? 0);
        moveCost *= 1 + config.fatDragCoeff * (fat / capacity);
      }
    }
    if (config.toughnessGeneEnabled && (config.armorDragCoeff ?? 0) > 0) {
      const toughness = org.toughness ?? 0;
      if (toughness > 0) {
        moveCost *= 1 + config.armorDragCoeff * toughness;
      }
    }
  }
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
  // Kleiber scaling on the effective size: the size gene's, times body scale while growing.
  const bodyScale = bodyScaleOf(organism, config);
  const sizeFactor =
    config.sizeGeneEnabled && organism.size !== undefined
      ? Math.pow(organism.size * bodyScale, config.sizeMetabolismExponent ?? 0.75)
      : bodyScale < 1
        ? Math.pow(bodyScale, config.sizeMetabolismExponent ?? 0.75)
        : 1;
  const metabolicRate =
    config.metabolismGeneEnabled && organism.metabolicRate !== undefined ? organism.metabolicRate : 1;
  const baseCost = config.tickMetabolismCost * sizeFactor * metabolicRate;

  // Sensory upkeep: neural/receptor maintenance scaling with area (radius^2)
  const sensoryUpkeep =
    config.sensingGeneEnabled && organism.sensingRadius !== undefined
      ? config.sensingUpkeepPerCell * (organism.sensingRadius * organism.sensingRadius)
      : 0;

  // Digestive organ upkeep: maintaining nutrient extraction machinery
  const digestiveUpkeep =
    config.digestiveGeneEnabled && organism.digestiveEfficiency !== undefined
      ? config.digestiveUpkeepRate * organism.digestiveEfficiency
      : 0;

  // Protein-processing upkeep: only a meat eater carries (and pays for) the machinery
  const carnivoreUpkeep =
    config.carnivoreGeneEnabled && organism.carnivoreEfficiency !== undefined
      ? config.carnivoreUpkeepRate * organism.carnivoreEfficiency * organism.carnivory
      : 0;

  // Detoxification upkeep: maintaining liver and metabolic enzymes scaling with body size
  const detoxUpkeep =
    config.detoxGeneEnabled && organism.detox !== undefined && organism.detox > 0
      ? config.detoxUpkeepRate * organism.detox * sizeFactor
      : 0;

  // Armor/Toughness upkeep: maintaining dense hide/carapace scaling with body size
  const toughnessUpkeep =
    config.toughnessGeneEnabled && organism.toughness !== undefined && organism.toughness > 0
      ? config.toughnessUpkeepRate * organism.toughness * sizeFactor
      : 0;

  // Chemical toxicity upkeep: synthesizing and maintaining defensive toxins scaling with body size
  const toxicityUpkeep =
    config.toxicityGeneEnabled && organism.toxicity !== undefined && organism.toxicity > 0
      ? config.toxicityUpkeepRate * organism.toxicity * sizeFactor
      : 0;

  // Stealth upkeep: maintaining silent stalking machinery and camouflage scaling with body size
  const stealthUpkeep =
    config.stealthGeneEnabled && organism.stealth !== undefined && organism.stealth > 0
      ? config.stealthUpkeepRate * organism.stealth * sizeFactor
      : 0;

  // Swimming upkeep: fins and buoyancy fat, carried on land too
  const swimUpkeep =
    config.swimGeneEnabled && config.elevationEnabled && organism.swim !== undefined && organism.swim > 0
      ? config.swimUpkeepRate * organism.swim * sizeFactor
      : 0;

  const total =
    baseCost +
    sensoryUpkeep +
    digestiveUpkeep +
    carnivoreUpkeep +
    detoxUpkeep +
    toughnessUpkeep +
    toxicityUpkeep +
    stealthUpkeep +
    swimUpkeep +
    config.carryUpkeep * organism.carryCapacity +
    (config.fatEnabled && organism.fatCapacity !== undefined ? config.fatUpkeep * organism.fatCapacity : 0) +
    (config.memoryEnabled ? config.memoryUpkeep * organism.memorySpan : 0) +
    // An ability only costs anything in worlds where it is enabled.
    config.abilityUpkeep *
      ((config.diagonalMoves ? organism.abilities.diagonal : 0) +
        (config.squeezeEnabled ? organism.abilities.squeeze : 0) +
        (config.leapEnabled ? organism.abilities.leap : 0)) +
    (splitDiets(config) ? config.dietUpkeep * (herbivoryOf(organism, config) + organism.carnivory) : 0) +
    // Stage 2: every gene costs upkeep, so genome length is under selection.
    (config.dnaVariationEnabled && organism.genome ? config.dnaUpkeepPerGene * (organism.genome.length / 3) : 0) +
    // Stage 3: each expressed connection of an acquired hidden unit (past the founders' 6) costs upkeep; founders pay 0.
    (config.dnaEnabled && config.dnaGrowableBrain && organism.circuit ? config.dnaUpkeepPerConnection * organism.circuit.acquiredConnections : 0);
  // Ageing: past senescenceAge the whole upkeep rises (x1 otherwise, and with ageing off).
  const aged = senescenceFactorOf(organism, config);
  return aged === 1 ? total : total * aged;
}

/**
 * Upkeep multiplier from local temperature (docs/decisions.md, "Thermal physics"). `temp` is the
 * weather temperature in [-1, 1].
 *
 * Without thermalPhysicsEnabled this is the old rule: cold only, `1 + weatherChillCoeff × |temp|`
 * below zero, the same for every body.
 *
 * With it, both extremes cost and the body sets the scale. A body makes heat in proportion to its
 * metabolic rate and loses it through its surface, which relative to its volume is size^(-1/3):
 *   cold: 1 + chill × cold × size^(-1/3) × (1 − fatInsulation × fatRatio) / metabolicRate
 *   heat: 1 + heat × hot × size^(+1/3) × (1 + fatInsulation × fatRatio) × metabolicRate
 * where cold = max(0, −temp), hot = max(0, temp − thermalHeatThreshold) and fatRatio = fat/fatCapacity.
 * So small, lean, slow-burning bodies suffer most in the cold, and large, fat, fast-burning bodies
 * in the heat. A founder-shaped body (size 1, rate 1, no fat) pays exactly the old cold cost.
 * The exponents are fixed physics (surface area to volume, heat made ∝ metabolic rate).
 */
export function thermalUpkeepFactor(
  organism: Readonly<Pick<Organism, 'size' | 'metabolicRate' | 'fat' | 'fatCapacity'>>,
  temp: number,
  config: Readonly<SimulationConfig>
): number {
  if (!config.thermalPhysicsEnabled) {
    return temp < 0 ? 1 + config.weatherChillCoeff * Math.abs(temp) : 1;
  }
  const size = sizeOf(organism, config);
  const rate = metabolicRateOf(organism, config);
  const fatRatio =
    config.fatEnabled && (organism.fatCapacity ?? 0) > 0 ? Math.min(1, Math.max(0, (organism.fat ?? 0) / (organism.fatCapacity ?? 1))) : 0;
  if (temp < 0) {
    const insulation = 1 - config.thermalFatInsulation * fatRatio;
    return 1 + (config.weatherChillCoeff * -temp * Math.pow(size, -1 / 3) * insulation) / rate;
  }
  const hot = temp - config.thermalHeatThreshold;
  if (hot <= 0) return 1;
  const trapped = 1 + config.thermalFatInsulation * fatRatio;
  return 1 + config.thermalHeatCoeff * hot * Math.pow(size, 1 / 3) * trapped * rate;
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
export function plantYield(organism: Readonly<Pick<Organism, 'carnivory' | 'herbivory' | 'digestiveEfficiency' | 'maturity'>>, config: Readonly<SimulationConfig>): number {
  const eff = digestiveEfficiencyOf(organism, config);
  // A small body takes a smaller bite: yield scales with body scale (x1 when grown, and with growth off).
  const scale = bodyScaleOf(organism, config);
  const meal = splitDiets(config)
    ? config.foodEnergyYield * herbivoryOf(organism, config) * eff
    : !config.carrionEnabled
      ? config.foodEnergyYield * eff
      : config.foodEnergyYield * (1 - config.dietTradeoff * organism.carnivory) * eff;
  return scale === 1 ? meal : meal * scale;
}

/** Energy from a full carrion meal (carrionBite of carrion energy); 0 when carrion is off. */
export function carrionYield(organism: Readonly<Pick<Organism, 'carnivory' | 'digestiveEfficiency' | 'carnivoreEfficiency' | 'maturity'>>, config: Readonly<SimulationConfig>): number {
  const eff = digestiveEfficiencyOf(organism, config) * carnivoreEfficiencyOf(organism, config);
  // A small body takes a smaller bite (x1 when grown, and with growth off).
  return config.carrionEnabled ? config.carrionBite * bodyScaleOf(organism, config) * organism.carnivory * eff : 0;
}

/**
 * Carrion energy a body leaves: a fixed amount that scales with body size (1 without the size gene)
 * plus a share of what it still held. Never more than the body cost.
 */
export function carrionFromBody(bodyEnergy: number, config: Readonly<SimulationConfig>, size = 1): number {
  return config.carrionBodyEnergy * size + config.carrionEfficiency * Math.max(0, bodyEnergy);
}

/**
 * The chance an attack kills: the attacker's share of the two energies,
 * scaled by bite strength (bitePowerMin for a plant eater up to 1 for a full
 * meat eater). Prey that moves out of reach that tick escapes regardless.
 */
export function killChance(
  attacker: Readonly<Pick<Organism, 'energy' | 'carnivory' | 'stealth'>>,
  prey: Readonly<Pick<Organism, 'energy' | 'toughness'>>,
  config: Readonly<SimulationConfig>
): number {
  const total = attacker.energy + prey.energy;
  const share = total > 0 ? attacker.energy / total : 0;
  const bite = config.bitePowerMin + (1 - config.bitePowerMin) * attacker.carnivory;
  let chance = share * bite;
  if (config.stealthGeneEnabled && attacker.stealth !== undefined && attacker.stealth > 0) {
    chance *= 1 + (config.stealthAmbushBonus ?? 0.3) * attacker.stealth;
  }
  if (!config.toughnessGeneEnabled || prey.toughness === undefined || prey.toughness <= 0) {
    return Math.min(1, chance);
  }
  const armorEffectiveness = config.armorEffectiveness ?? 0.75;
  return Math.min(1, Math.max(0, chance * (1 - armorEffectiveness * prey.toughness)));
}
