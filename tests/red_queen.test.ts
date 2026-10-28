import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { createPlant, stepPlants } from '../src/sim/plants';
import { metabolismCost } from '../src/sim/traits';
import { brainFeatures, BRAIN_INPUTS, createHeadStartBrain } from '../src/sim/brain';
import type { Organism, PlantGenome, SimulationConfig } from '../src/sim/types';

function quietWorld(overrides: Partial<SimulationConfig> = {}): World {
  return new World({
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
});
