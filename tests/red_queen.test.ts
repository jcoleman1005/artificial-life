import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { createPlant, stepPlants } from '../src/sim/plants';
import { metabolismCost, killChance, moveEnergyCost } from '../src/sim/traits';
import { brainFeatures, BRAIN_INPUTS, createHeadStartBrain } from '../src/sim/brain';
import { senseEnvironment } from '../src/sim/sensors';
import type { Organism, PlantGenome, SimulationConfig } from '../src/sim/types';

function quietWorld(overrides: Partial<SimulationConfig> = {}): World {
  return new World({
    // Isolate mechanisms from the 2026-10-29 DNA defaults: legacy ability costs, diets and mutation.
    dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false,
    seed: 'redqueen',
    gridWidth: 20,
    gridHeight: 20,
    obstacleDensity: 0,
    initialOrganisms: 0,
    initialFoodPatches: 0,
    foodRegionCount: 0,
    seasonLength: 0,
    immigrationInterval: 0,
    seedRainInterval: 0,
    plantsEnabled: true,
    weatherEnabled: false,
    nutrientCycleEnabled: false,
    ...overrides,
  });
}

const BASE_GENOME: PlantGenome = {
  growthRate: 0.3,
  maxBiomass: 10,
  seedSize: 1,
  seedThreshold: 1,
  dispersal: 2,
  rootShare: 0,
  leanDormancy: 0,
  defense: 0,
};

describe('Red Queen: Plant Defense & Herbivore Detox', () => {
  it('charges defense synthesis upkeep on defended plants', () => {
    const worldA = quietWorld({ plantDefenseEnabled: true, plantDefenseCostFactor: 0.5, plantUpkeep: 0.01 });
    const worldB = quietWorld({ plantDefenseEnabled: true, plantDefenseCostFactor: 0.5, plantUpkeep: 0.01 });

    const undefended = createPlant(worldA.plantCounters, { ...BASE_GENOME, defense: 0, growthRate: 0 }, 5, 0, null);
    const defended = createPlant(worldB.plantCounters, { ...BASE_GENOME, defense: 1.0, growthRate: 0 }, 5, 0, null);

    worldA.foodPatches.set('5,5', { x: 5, y: 5, stock: 5, capacity: 10, plant: undefended });
    worldB.foodPatches.set('5,5', { x: 5, y: 5, stock: 5, capacity: 10, plant: defended });

    stepPlants({
      patches: worldA.foodPatches,
      field: worldA.soil(),
      config: worldA.config,
      counters: worldA.plantCounters,
      worldLean: false,
      regionLean: [],
      prng: worldA.prng,
      tick: 1,
    });

    stepPlants({
      patches: worldB.foodPatches,
      field: worldB.soil(),
      config: worldB.config,
      counters: worldB.plantCounters,
      worldLean: false,
      regionLean: [],
      prng: worldB.prng,
      tick: 1,
    });

    // Defended plant pays additional upkeep: plantUpkeep * size * costFactor * defense
    expect(defended.biomass).toBeLessThan(undefended.biomass);
  });

  it('charges enzymatic detox upkeep on organisms proportional to detox and size', () => {
    const config = quietWorld().config;
    const baseOrg: Organism = {
      id: 'org-test',
      x: 0,
      y: 0,
      energy: 50,
      policy: {} as never,
      brain: createHeadStartBrain(new PRNG(1), config),
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 0,
      tag: 100,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-1', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      detox: 0.0,
    };

    const costZeroDetox = metabolismCost(baseOrg, config);
    const orgWithDetox = { ...baseOrg, detox: 0.5 };
    const costHalfDetox = metabolismCost(orgWithDetox, config);

    // Extra cost = config.detoxUpkeepRate * 0.5 * 1.0
    expect(costHalfDetox).toBeCloseTo(costZeroDetox + config.detoxUpkeepRate * 0.5, 4);

    // Scaling with size
    const largeOrgWithDetox = { ...baseOrg, size: 2.0, detox: 0.5 };
    const costLarge = metabolismCost(largeOrgWithDetox, config);
    expect(costLarge).toBeGreaterThan(costHalfDetox);
  });

  it('applies yield discount and acute malaise damage when grazing a defended plant without detox', () => {
    const world = quietWorld({
      plantDefenseEnabled: true,
      defenseYieldPenalty: 0.75,
      toxinMalaiseCost: 10.0,
      foodEnergyYield: 20,
    });

    // Highly defended plant: defense = 0.8
    const plant = createPlant(world.plantCounters, { ...BASE_GENOME, defense: 0.8 }, 5, 0, null);
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 5, capacity: 10, plant });

    const brain = createHeadStartBrain(world.prng, world.config);
    brain.skip[BRAIN_INPUTS.indexOf('isEat')] = 100; // force EAT action

    const org: Organism = {
      id: 'org-1',
      x: 5,
      y: 5,
      energy: 30,
      policy: {} as never,
      brain,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 0,
      tag: 120,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-1', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      detox: 0.0,
      lastBiteYield: 1.0,
    };
    world.organisms.set(org.id, org);

    const initialEnergy = org.energy;
    world.step();

    expect(org.foodEatenCount).toBe(1);
    expect(org.lastBiteYield).toBeCloseTo(0.40, 2);
    // Net gain was reduced due to penalty and malaise
    expect(org.energy).toBeLessThan(initialEnergy + 15);
  });

  it('neutralizes plant toxins when detox matches or exceeds defense', () => {
    const world = quietWorld({
      plantDefenseEnabled: true,
      defenseYieldPenalty: 0.75,
      toxinMalaiseCost: 10.0,
      foodEnergyYield: 20,
    });

    const plant = createPlant(world.plantCounters, { ...BASE_GENOME, defense: 0.8 }, 5, 0, null);
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 5, capacity: 10, plant });

    const brain = createHeadStartBrain(world.prng, world.config);
    brain.skip[BRAIN_INPUTS.indexOf('isEat')] = 100;

    const org: Organism = {
      id: 'org-1',
      x: 5,
      y: 5,
      energy: 30,
      policy: {} as never,
      brain,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 0,
      tag: 120,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-1', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      detox: 0.9,
      lastBiteYield: 1.0,
    };
    world.organisms.set(org.id, org);

    world.step();

    // Detox (0.9) >= defense (0.8) => unneutralized = 0. Full yield, zero malaise!
    expect(org.lastBiteYield).toBeCloseTo(1.0, 2);
    expect(org.energy).toBeGreaterThan(45);
  });

  it('exposes lastBiteYield in brain features', () => {
    const config = quietWorld().config;
    const org = {
      id: 'org-test',
      x: 0,
      y: 0,
      energy: 50,
      tag: 100,
      lastBiteYield: 0.45,
    } as Organism;

    const sensed = {
      registers: [0, 0, 0] as [number, number, number],
      neighbors: { count: 0, kinSimilarity: 0 },
      crowding: 0,
      energy: 50,
      carriedFood: 0,
    };

    const features = brainFeatures(
      { type: 'REST' },
      org,
      sensed as never,
      config,
      false,
      new PRNG(1)
    );

    const idx = BRAIN_INPUTS.indexOf('lastBiteYield');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(features[idx]).toBeCloseTo(0.45, 2);
  });

  it('reduces attack kill chance with prey toughness', () => {
    const config = quietWorld({ toughnessGeneEnabled: true, armorEffectiveness: 0.75 }).config;
    const attacker = { energy: 50, carnivory: 1.0 };
    const unarmoredPrey = { energy: 50, toughness: 0.0 };
    const armoredPrey = { energy: 50, toughness: 1.0 };

    const baseChance = killChance(attacker, unarmoredPrey, config);
    const armoredChance = killChance(attacker, armoredPrey, config);

    expect(baseChance).toBeCloseTo(0.5, 3);
    // 75% reduction: 0.5 * (1 - 0.75 * 1.0) = 0.125
    expect(armoredChance).toBeCloseTo(0.125, 3);
  });

  it('charges continuous mass upkeep for toughness proportional to body mass', () => {
    const config = quietWorld({ toughnessGeneEnabled: true, toughnessUpkeepRate: 0.025 }).config;
    const baseOrg: Organism = {
      id: 'org-test',
      x: 0,
      y: 0,
      energy: 50,
      policy: {} as never,
      brain: createHeadStartBrain(new PRNG(1), config),
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 0,
      tag: 100,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-1', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      toughness: 0.0,
    };

    const costZero = metabolismCost(baseOrg, config);
    const costTough = metabolismCost({ ...baseOrg, toughness: 0.8 }, config);
    expect(costTough).toBeCloseTo(costZero + 0.025 * 0.8 * 1.0, 4);

    const costLargeTough = metabolismCost({ ...baseOrg, size: 2.0, toughness: 0.8 }, config);
    expect(costLargeTough).toBeGreaterThan(costTough);
  });

  it('emits an involuntary death pulse upon fatal attack that is sensed as a signal', () => {
    const world = quietWorld({
      predationDefenseEnabled: true,
      predationEnabled: true,
      carrionEnabled: true,
      signalRadius: 8,
    });

    const attackerBrain = createHeadStartBrain(world.prng, world.config);
    attackerBrain.skip[BRAIN_INPUTS.indexOf('isAttack')] = 100;

    const attacker: Organism = {
      id: 'predator-1',
      x: 5,
      y: 5,
      energy: 80,
      policy: {} as never,
      brain: attackerBrain,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 1.0,
      tag: 10,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-pred', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
    };

    const preyBrain = createHeadStartBrain(world.prng, world.config);
    preyBrain.skip[BRAIN_INPUTS.indexOf('isRest')] = 100;

    const prey: Organism = {
      id: 'prey-1',
      x: 5,
      y: 6,
      energy: 5,
      policy: {} as never,
      brain: preyBrain,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 0,
      tag: 200,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-prey', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      toughness: 0.0,
    };

    const bystander: Organism = {
      id: 'bystander-1',
      x: 5,
      y: 9,
      energy: 50,
      policy: {} as never,
      brain: createHeadStartBrain(world.prng, world.config),
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 0,
      tag: 200,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-prey', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
    };

    world.organisms.set(attacker.id, attacker);
    world.organisms.set(prey.id, prey);
    world.organisms.set(bystander.id, bystander);

    world.step();

    expect(world.killsTotal).toBe(1);
    expect(world.deathPulses.length).toBe(1);
    expect(world.deathPulses[0].tag).toBe(prey.tag);

    const snapshot = world.getSnapshot();
    expect(snapshot.deathPulses?.length).toBe(1);
  });

  it('uncouples moveCarrion directional sensing from diet when predationDefenseEnabled is true', () => {
    const configOn = quietWorld({ predationDefenseEnabled: true }).config;
    const configOff = quietWorld({ predationDefenseEnabled: false }).config;

    const herbivore = {
      id: 'herbivore-1',
      x: 5,
      y: 5,
      energy: 50,
      tag: 100,
      carnivory: 0,
    } as Organism;

    const sensedWithCarrion = {
      registers: [0, 0, 0] as [number, number, number],
      nearestCarrion: { x: 5, y: 7, distance: 2, dx: 0, dy: 2 },
      neighbors: { count: 0, kinSimilarity: 0 },
      crowding: 0,
      energy: 50,
      carriedFood: 0,
    };

    const featuresOn = brainFeatures(
      { type: 'MOVE_SOUTH', target: { x: 5, y: 6 } },
      herbivore,
      sensedWithCarrion as never,
      configOn,
      false,
      new PRNG(1)
    );

    const featuresOff = brainFeatures(
      { type: 'MOVE_SOUTH', target: { x: 5, y: 6 } },
      herbivore,
      sensedWithCarrion as never,
      configOff,
      false,
      new PRNG(1)
    );

    const idx = BRAIN_INPUTS.indexOf('moveCarrion');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(featuresOn[idx]).toBeGreaterThan(0.5);
    expect(featuresOff[idx]).toBe(0);
  });

  it('increases movement energy cost proportionally to toughness and armorDragCoeff', () => {
    const config = quietWorld({
      toughnessGeneEnabled: true,
      armorDragCoeff: 0.35,
    }).config;

    const baseOrg: Pick<Organism, 'abilities' | 'size' | 'fat' | 'fatCapacity' | 'toughness'> = {
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      size: 1.0,
      toughness: 0.0,
    };

    const costZero = moveEnergyCost(baseOrg, { diagonal: false, squeeze: false, leap: false }, config);
    const costArmored = moveEnergyCost({ ...baseOrg, toughness: 0.8 }, { diagonal: false, squeeze: false, leap: false }, config);

    expect(costArmored).toBeCloseTo(costZero * (1 + 0.35 * 0.8), 4);
    expect(costArmored).toBeGreaterThan(costZero);
  });

  it('scales death pulse reach with victim metabolic rate and size', () => {
    const worldLow = quietWorld({
      predationDefenseEnabled: true,
      predationEnabled: true,
      signalRadius: 5,
      metabolismGeneEnabled: true,
    });
    const worldHigh = quietWorld({
      predationDefenseEnabled: true,
      predationEnabled: true,
      signalRadius: 5,
      metabolismGeneEnabled: true,
    });

    const createSetup = (w: World, preyRate: number) => {
      const attackerBrain = createHeadStartBrain(w.prng, w.config);
      attackerBrain.skip[BRAIN_INPUTS.indexOf('isAttack')] = 100;

      const attacker: Organism = {
        id: 'pred',
        x: 5,
        y: 5,
        energy: 80,
        policy: {} as never,
        brain: attackerBrain,
        abilities: { diagonal: 0, squeeze: 0, leap: 0 },
        carnivory: 1.0,
        tag: 10,
        carryCapacity: 0,
        dispersal: 1,
        memorySpan: 0,
        memoryWeights: [],
        memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
        kills: 0,
        lineage: { id: 'lin-pred', parentId: null, generation: 1, birthTick: 0 },
        age: 0,
        offspringCount: 0,
        foodEatenCount: 0,
        carriedFood: 0,
        foodGiven: 0,
        foodReceived: 0,
        signalTick: -1,
        recentHistory: [],
        size: 1.0,
        stealth: 0.0,
      };

      const preyBrain = createHeadStartBrain(w.prng, w.config);
      preyBrain.skip[BRAIN_INPUTS.indexOf('isRest')] = 100;

      const prey: Organism = {
        id: 'prey',
        x: 5,
        y: 6,
        energy: 5,
        policy: {} as never,
        brain: preyBrain,
        abilities: { diagonal: 0, squeeze: 0, leap: 0 },
        carnivory: 0,
        tag: 200,
        carryCapacity: 0,
        dispersal: 1,
        memorySpan: 0,
        memoryWeights: [],
        memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
        kills: 0,
        lineage: { id: 'lin-prey', parentId: null, generation: 1, birthTick: 0 },
        age: 0,
        offspringCount: 0,
        foodEatenCount: 0,
        carriedFood: 0,
        foodGiven: 0,
        foodReceived: 0,
        signalTick: -1,
        recentHistory: [],
        size: 1.0,
        stealth: 0.0,
        metabolicRate: preyRate,
      };

      const bystanderBrain = createHeadStartBrain(w.prng, w.config);
      bystanderBrain.skip[BRAIN_INPUTS.indexOf('isRest')] = 100;

      const bystander: Organism = {
        id: 'bystander',
        x: 5,
        y: 10, // distance from prey at (5,6) is |5-5| + |10-6| = 4
        energy: 50,
        policy: {} as never,
        brain: bystanderBrain,
        abilities: { diagonal: 0, squeeze: 0, leap: 0 },
        carnivory: 0,
        tag: 200,
        carryCapacity: 0,
        dispersal: 1,
        memorySpan: 0,
        memoryWeights: [],
        memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
        kills: 0,
        lineage: { id: 'lin-prey', parentId: null, generation: 1, birthTick: 0 },
        age: 0,
        offspringCount: 0,
        foodEatenCount: 0,
        carriedFood: 0,
        foodGiven: 0,
        foodReceived: 0,
        signalTick: -1,
        recentHistory: [],
        size: 1.0,
        stealth: 0.0,
      };

      w.organisms.set(attacker.id, attacker);
      w.organisms.set(prey.id, prey);
      w.organisms.set(bystander.id, bystander);
    };

    createSetup(worldLow, 0.5);
    createSetup(worldHigh, 2.0);

    worldLow.step();
    worldHigh.step();

    const snapLow = worldLow.getSnapshot();
    const snapHigh = worldHigh.getSnapshot();

    expect(snapLow.deathPulses?.[0]?.power).toBe(0.5);
    expect(snapHigh.deathPulses?.[0]?.power).toBe(2.0);

    const bLow = worldLow.organisms.get('bystander')!;
    const bHigh = worldHigh.organisms.get('bystander')!;

    const sensedLow = senseEnvironment(bLow, snapLow, worldLow.config);
    const sensedHigh = senseEnvironment(bHigh, snapHigh, worldHigh.config);

    expect(sensedLow.nearestSignal).toBeNull();
    expect(sensedHigh.nearestSignal).not.toBeNull();
    expect(sensedHigh.nearestSignal?.distance).toBe(4);
  });

  it('inflicts acute malaise and sets lastBiteYield when attacking toxic prey without detox', () => {
    const world = quietWorld({
      predationDefenseEnabled: true,
      predationEnabled: true,
      carrionEnabled: true,
      toxicityGeneEnabled: true,
      detoxGeneEnabled: true,
      toxinMalaiseCost: 15,
      defenseYieldPenalty: 0.5,
    });

    const attackerBrain = createHeadStartBrain(world.prng, world.config);
    attackerBrain.skip[BRAIN_INPUTS.indexOf('isAttack')] = 100;

    const attacker: Organism = {
      id: 'pred',
      x: 5,
      y: 5,
      energy: 80,
      policy: {} as never,
      brain: attackerBrain,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 1.0,
      tag: 10,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-pred', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      detox: 0.0,
    };

    const preyBrain = createHeadStartBrain(world.prng, world.config);
    preyBrain.skip[BRAIN_INPUTS.indexOf('isRest')] = 100;

    const prey: Organism = {
      id: 'prey',
      x: 5,
      y: 6,
      energy: 20,
      policy: {} as never,
      brain: preyBrain,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 0,
      tag: 200,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-prey', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      toxicity: 0.8,
    };

    world.organisms.set(attacker.id, attacker);
    world.organisms.set(prey.id, prey);

    const initialEnergy = attacker.energy;
    world.step();

    expect(world.killsTotal).toBe(1);
    const expectedDrop = world.config.attackCost + world.config.tickMetabolismCost + 15 * (0.8 - 0.3);
    expect(attacker.energy).toBeCloseTo(initialEnergy - expectedDrop, 2);
    expect(attacker.lastBiteYield).toBeCloseTo(1 - 0.5 * 0.8, 2);

    const carrion = world.carrion.get('5,6');
    expect(carrion).toBeDefined();
    expect(carrion?.toxicity).toBeCloseTo(0.8, 2);
  });

  it('scavenging toxic carrion applies malaise without detox, but detox neutralizes it', () => {
    const world = quietWorld({
      carrionEnabled: true,
      toxicityGeneEnabled: true,
      detoxGeneEnabled: true,
      toxinMalaiseCost: 20,
      defenseYieldPenalty: 0.5,
    });

    world.carrion.set('5,5', { x: 5, y: 5, stock: 30, expiresAt: 100, toxicity: 0.8 });
    world.carrion.set('6,6', { x: 6, y: 6, stock: 30, expiresAt: 100, toxicity: 0.8 });

    const vulnerableBrain = createHeadStartBrain(world.prng, world.config);
    vulnerableBrain.skip[BRAIN_INPUTS.indexOf('isEatCarrion')] = 100;

    const immuneBrain = createHeadStartBrain(world.prng, world.config);
    immuneBrain.skip[BRAIN_INPUTS.indexOf('isEatCarrion')] = 100;

    const vulnerable: Organism = {
      id: 'scav-vuln',
      x: 5,
      y: 5,
      energy: 40,
      policy: {} as never,
      brain: vulnerableBrain,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 1.0,
      tag: 10,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-scav', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      detox: 0.0,
    };

    const immune: Organism = {
      id: 'scav-imm',
      x: 6,
      y: 6,
      energy: 40,
      policy: {} as never,
      brain: immuneBrain,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 1.0,
      tag: 10,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-scav', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      detox: 1.0,
    };

    world.organisms.set(vulnerable.id, vulnerable);
    world.organisms.set(immune.id, immune);

    world.step();

    expect(vulnerable.lastBiteYield).toBeLessThan(1.0);
    expect(immune.lastBiteYield).toBe(1.0);
    expect(immune.energy).toBeGreaterThan(vulnerable.energy);
  });

  it('transfers toxicity to laid eggs and inflicts malaise on egg-eaters lacking detox', () => {
    const world = quietWorld({
      eggsEnabled: true,
      carrionEnabled: true,
      toxicityGeneEnabled: true,
      detoxGeneEnabled: true,
      toxinMalaiseCost: 20,
      defenseYieldPenalty: 0.5,
      eggHatchRadius: 0,
    });

    const parentBrain = createHeadStartBrain(world.prng, world.config);
    parentBrain.skip[BRAIN_INPUTS.indexOf('isReproduce')] = 100;

    const parent: Organism = {
      id: 'parent',
      x: 5,
      y: 5,
      energy: 80,
      policy: {} as never,
      brain: parentBrain,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 0,
      tag: 50,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-egg', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      toxicity: 0.9,
      eggAllocation: 1.0,
    };

    world.organisms.set(parent.id, parent);
    world.step();

    expect(world.eggs.size).toBe(1);
    const egg = Array.from(world.eggs.values())[0];
    expect(egg.toxicity).toBeCloseTo(0.9, 2);

    const eaterBrain = createHeadStartBrain(world.prng, world.config);
    eaterBrain.skip[BRAIN_INPUTS.indexOf('isEatCarrion')] = 100;

    const eater: Organism = {
      id: 'eater',
      x: egg.x,
      y: egg.y,
      energy: 30,
      policy: {} as never,
      brain: eaterBrain,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 1.0,
      tag: 10,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-eat', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      detox: 0.0,
    };

    world.organisms.delete('parent');
    world.organisms.set(eater.id, eater);

    world.step();

    expect(world.eggsEatenTotal).toBe(1);
    expect(eater.lastBiteYield).toBeCloseTo(1 - 0.5 * 0.9, 2);
  });

  it('charges continuous mass upkeep for stealth proportional to body mass', () => {
    const config = quietWorld({
      stealthGeneEnabled: true,
      stealthUpkeepRate: 0.02,
    }).config;

    const baseOrg: Organism = {
      id: 'org',
      x: 0,
      y: 0,
      energy: 50,
      policy: {} as never,
      brain: {} as never,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 0,
      tag: 0,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      stealth: 0.0,
    };

    const costZero = metabolismCost(baseOrg, config);
    const costStealth = metabolismCost({ ...baseOrg, stealth: 0.8 }, config);
    expect(costStealth).toBeCloseTo(costZero + 0.02 * 0.8 * 1.0, 4);

    const costLargeStealth = metabolismCost({ ...baseOrg, size: 2.0, stealth: 0.8 }, config);
    expect(costLargeStealth).toBeGreaterThan(costStealth);
  });

  it('boosts attack kill chance with predator stealth (ambush bonus)', () => {
    const config = quietWorld({
      stealthGeneEnabled: true,
      stealthAmbushBonus: 0.3,
      toughnessGeneEnabled: false,
    }).config;

    const attacker: Pick<Organism, 'energy' | 'carnivory' | 'stealth'> = {
      energy: 50,
      carnivory: 1.0,
      stealth: 0.0,
    };
    const prey: Pick<Organism, 'energy' | 'toughness'> = {
      energy: 50,
      toughness: 0.0,
    };

    const chanceNoStealth = killChance(attacker, prey, config);
    const chanceStealth = killChance({ ...attacker, stealth: 0.8 }, prey, config);

    expect(chanceStealth).toBeCloseTo(chanceNoStealth * (1 + 0.3 * 0.8), 4);
    expect(chanceStealth).toBeGreaterThan(chanceNoStealth);
  });

  it('minimizes death pulse power with predator stealth and completely negates it at full stealth', () => {
    const worldNormal = quietWorld({
      predationDefenseEnabled: true,
      predationEnabled: true,
      stealthGeneEnabled: true,
      metabolismGeneEnabled: true,
    });
    const worldSilent = quietWorld({
      predationDefenseEnabled: true,
      predationEnabled: true,
      stealthGeneEnabled: true,
      metabolismGeneEnabled: true,
    });

    const createPair = (w: World, attackerStealth: number) => {
      const attackerBrain = createHeadStartBrain(w.prng, w.config);
      attackerBrain.skip[BRAIN_INPUTS.indexOf('isAttack')] = 100;

      const attacker: Organism = {
        id: 'pred',
        x: 5,
        y: 5,
        energy: 80,
        policy: {} as never,
        brain: attackerBrain,
        abilities: { diagonal: 0, squeeze: 0, leap: 0 },
        carnivory: 1.0,
        tag: 10,
        carryCapacity: 0,
        dispersal: 1,
        memorySpan: 0,
        memoryWeights: [],
        memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
        kills: 0,
        lineage: { id: 'lin-pred', parentId: null, generation: 1, birthTick: 0 },
        age: 0,
        offspringCount: 0,
        foodEatenCount: 0,
        carriedFood: 0,
        foodGiven: 0,
        foodReceived: 0,
        signalTick: -1,
        recentHistory: [],
        size: 1.0,
        stealth: attackerStealth,
      };

      const preyBrain = createHeadStartBrain(w.prng, w.config);
      preyBrain.skip[BRAIN_INPUTS.indexOf('isRest')] = 100;

      const prey: Organism = {
        id: 'prey',
        x: 5,
        y: 6,
        energy: 10,
        policy: {} as never,
        brain: preyBrain,
        abilities: { diagonal: 0, squeeze: 0, leap: 0 },
        carnivory: 0,
        tag: 200,
        carryCapacity: 0,
        dispersal: 1,
        memorySpan: 0,
        memoryWeights: [],
        memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
        kills: 0,
        lineage: { id: 'lin-prey', parentId: null, generation: 1, birthTick: 0 },
        age: 0,
        offspringCount: 0,
        foodEatenCount: 0,
        carriedFood: 0,
        foodGiven: 0,
        foodReceived: 0,
        signalTick: -1,
        recentHistory: [],
        size: 1.0,
        metabolicRate: 1.0,
        stealth: 0.0,
      };

      w.organisms.set(attacker.id, attacker);
      w.organisms.set(prey.id, prey);
    };

    createPair(worldNormal, 0.4);
    createPair(worldSilent, 1.0);

    worldNormal.step();
    worldSilent.step();

    expect(worldNormal.killsTotal).toBe(1);
    expect(worldSilent.killsTotal).toBe(1);

    expect(worldNormal.deathPulses.length).toBe(1);
    expect(worldNormal.deathPulses[0].power).toBeCloseTo(0.6, 2);

    expect(worldSilent.deathPulses.length).toBe(0);
  });

  it('allows prey stealth to silence and negate its own death pulse upon death', () => {
    const world = quietWorld({
      predationDefenseEnabled: true,
      predationEnabled: true,
      stealthGeneEnabled: true,
      metabolismGeneEnabled: true,
    });

    const attackerBrain = createHeadStartBrain(world.prng, world.config);
    attackerBrain.skip[BRAIN_INPUTS.indexOf('isAttack')] = 100;

    const attacker: Organism = {
      id: 'pred',
      x: 5,
      y: 5,
      energy: 80,
      policy: {} as never,
      brain: attackerBrain,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 1.0,
      tag: 10,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-pred', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      stealth: 0.0,
    };

    const preyBrain = createHeadStartBrain(world.prng, world.config);
    preyBrain.skip[BRAIN_INPUTS.indexOf('isRest')] = 100;

    const prey: Organism = {
      id: 'prey',
      x: 5,
      y: 6,
      energy: 10,
      policy: {} as never,
      brain: preyBrain,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 },
      carnivory: 0,
      tag: 200,
      carryCapacity: 0,
      dispersal: 1,
      memorySpan: 0,
      memoryWeights: [],
      memory: { home: null, rememberedFood: null, rememberedSignal: null, registers: [0, 0, 0] },
      kills: 0,
      lineage: { id: 'lin-prey', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
      size: 1.0,
      metabolicRate: 1.0,
      stealth: 1.0,
    };

    world.organisms.set(attacker.id, attacker);
    world.organisms.set(prey.id, prey);

    world.step();

    expect(world.killsTotal).toBe(1);
    expect(world.deathPulses.length).toBe(0);
  });
});
