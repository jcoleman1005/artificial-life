import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { createConfig } from '../src/sim/config';
import {
  DORMANCY_TRANSFER,
  PLANT_TRAITS,
  PLANT_TRAIT_KEYS,
  createPlant,
  founderGenome,
  inheritGenome,
} from '../src/sim/plants';
import type { Organism, Plant, PlantGenome, SimulationConfig } from '../src/sim/types';

/** An empty, flat world with plants on and nothing random happening. */
function plantWorld(overrides: Partial<SimulationConfig> = {}): World {
  return new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */ 
    seed: 'plants',
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
    ...overrides,
  });
}

const GENOME: PlantGenome = {
  growthRate: 0.3,
  maxBiomass: 8,
  seedSize: 1,
  seedThreshold: 1, // no seeds unless a test wants them
  dispersal: 2,
  rootShare: 0,
  leanDormancy: 0,
};

function addPlant(world: World, x: number, y: number, biomass: number, genome: Partial<PlantGenome> = {}, roots = 0): Plant {
  const plant = createPlant(world.plantCounters, { ...GENOME, ...genome }, biomass, world.tick, null);
  plant.roots = roots;
  world.foodPatches.set(`${x},${y}`, { x, y, stock: Math.floor(plant.biomass), capacity: Math.floor(plant.genome.maxBiomass), plant });
  return plant;
}

/** Growth minus upkeep for one tick, as the rules state it. */
function expectedNet(world: World, size: number, genome: PlantGenome, shade: number): number {
  const c = world.config;
  const vigour = size / (size + 1);
  const growth = genome.growthRate * vigour * Math.max(0, 1 - c.shadeStrength * shade);
  const upkeep = c.plantUpkeep * size + c.growthCostFactor * genome.growthRate * vigour;
  return growth - upkeep;
}

describe('Plants', () => {
  it('grow by the stated formula, and shade slows them', () => {
    const world = plantWorld();
    const lone = addPlant(world, 3, 3, 2);
    const crowded = addPlant(world, 12, 12, 2);
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
      addPlant(world, 12 + dx, 12 + dy, 0.5);
    }
    world.step();
    expect(lone.biomass).toBeCloseTo(2 + expectedNet(world, 2, GENOME, 0), 10);
    expect(crowded.biomass).toBeCloseTo(2 + expectedNet(world, 2, GENOME, 1), 10);
    expect(crowded.biomass).toBeLessThan(lone.biomass);
    expect(world.foodPatches.get('3,3')!.stock).toBe(Math.floor(lone.biomass));
  });

  it('never grow past their maximum size; the extra growth goes into seeds', () => {
    const world = plantWorld();
    const plant = addPlant(world, 5, 5, 3.9, { maxBiomass: 4, seedThreshold: 0.5, seedSize: 50 });
    for (let t = 0; t < 50; t++) world.step();
    expect(plant.biomass + plant.roots).toBeLessThanOrEqual(4 + 1e-9);
    expect(plant.seedBudget).toBeGreaterThan(0);
  });

  it('lose exactly one unit when eaten; grazed bare without roots they die, with roots they regrow', () => {
    for (const roots of [0, 1]) {
      const world = plantWorld();
      const plant = addPlant(world, 5, 5, 1, {}, roots);
      const eater = makeEater(world, 5, 5);
      world.organisms.set(eater.id, eater);
      world.step();
      expect(eater.foodEatenCount).toBe(1);
      expect(world.plantCounters.grazedTotal).toBe(1);
      if (roots === 0) {
        expect(world.foodPatches.has('5,5')).toBe(false);
        expect(world.plantCounters.deathsGrazed).toBe(1);
      } else {
        expect(world.foodPatches.get('5,5')!.plant).toBe(plant);
        expect(plant.biomass).toBeGreaterThan(0);
        expect(plant.biomass).toBeLessThan(1);
      }
    }
  });

  it('drop seeds within their dispersal reach, never on obstacles or other plants', () => {
    const world = plantWorld({ plantMutationRate: 0 });
    for (let x = 6; x <= 14; x++) world.obstacles.add(`${x},6`);
    const parent = addPlant(world, 10, 10, 8, { seedThreshold: 0.1, seedSize: 0.2, dispersal: 3, maxBiomass: 8 });
    for (let t = 0; t < 20; t++) world.step();
    const children = Array.from(world.foodPatches.values()).filter((p) => p.plant && p.plant.parentId === parent.id);
    expect(children.length).toBeGreaterThan(3);
    for (const c of children) {
      expect(Math.max(Math.abs(c.x - 10), Math.abs(c.y - 10))).toBeLessThanOrEqual(3);
      expect(world.obstacles.has(`${c.x},${c.y}`)).toBe(false);
      expect(c.plant!.genome).toEqual(parent.genome);
      expect(c.plant!.generation).toBe(2);
      expect(c.plant!.lineageId).toBe(parent.lineageId);
    }
    expect(new Set(children.map((c) => `${c.x},${c.y}`)).size).toBe(children.length);
  });

  it('inherit genomes that stay within each trait range', () => {
    const prng = new PRNG('genomes');
    const config = createConfig({ plantMutationRate: 1, plantMutationStdDev: 0.5 });
    let genome = founderGenome(prng);
    for (let i = 0; i < 500; i++) {
      genome = inheritGenome(genome, config, prng);
      for (const key of PLANT_TRAIT_KEYS) {
        expect(genome[key]).toBeGreaterThanOrEqual(PLANT_TRAITS[key].min);
        expect(genome[key]).toBeLessThanOrEqual(PLANT_TRAITS[key].max);
      }
    }
    const unchanged = inheritGenome(GENOME, createConfig({ plantMutationRate: 0 }), prng);
    expect(unchanged).toEqual(GENOME);
  });

  it('move biomass into roots only in lean seasons, if dormant', () => {
    // Season cycle of 100 ticks, the last half lean (nutrientCycle disabled to isolate clock season mechanism).
    const world = plantWorld({ seasonLength: 100, leanFraction: 0.5, growthCostFactor: 0, plantUpkeep: 0, nutrientCycleEnabled: false });
    const sleeper = addPlant(world, 3, 3, 4, { leanDormancy: 1, growthRate: 0.01 });
    const awake = addPlant(world, 12, 12, 4, { leanDormancy: 0, growthRate: 0.01 });
    for (let t = 0; t < 40; t++) world.step();
    expect(sleeper.roots).toBe(0);
    expect(sleeper.dormant).toBe(false);
    while (world.tick < 51) world.step();
    expect(sleeper.dormant).toBe(true);
    expect(sleeper.roots).toBeGreaterThan(0);
    expect(awake.roots).toBe(0);
    // One fully dormant lean tick moves DORMANCY_TRANSFER of the edible biomass.
    const before = sleeper.biomass;
    world.step();
    expect(sleeper.biomass).toBeCloseTo(before * (1 - DORMANCY_TRANSFER), 10);
  });

  it('replace classic patches: founders are plants and no patches spawn', () => {
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 'plant-founders', plantsEnabled: true });
    expect(world.foodPatches.size).toBeGreaterThan(20);
    for (const p of world.foodPatches.values()) expect(p.plant).toBeDefined();
    for (let t = 0; t < 200; t++) world.step();
    for (const p of world.foodPatches.values()) if (p.expiresAt === undefined) expect(p.plant).toBeDefined();
  }, 30_000);

  it('continue bit-identically after a snapshot round trip', () => {
    const config = { seed: 'plant-snap', plantsEnabled: true, gridWidth: 30, gridHeight: 30, initialOrganisms: 20, initialFoodPatches: 22 };
    const world = new World(config);
    for (let t = 0; t < 300; t++) world.step();
    const restored = World.fromState(JSON.parse(JSON.stringify(world.exportState())));
    for (let t = 0; t < 300; t++) {
      world.step();
      restored.step();
    }
    expect(JSON.stringify(Array.from(restored.foodPatches.values()))).toBe(JSON.stringify(Array.from(world.foodPatches.values())));
    expect(restored.plantCounters).toEqual(world.plantCounters);
    expect(restored.organisms.size).toBe(world.organisms.size);
  }, 60_000);

  it('stay sound over a long run and repeat exactly with the same seed', async () => {
    const run = async () => {
      const w = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 'plant-long', plantsEnabled: true, gridWidth: 30, gridHeight: 30, initialOrganisms: 20, initialFoodPatches: 22 });
      for (let t = 0; t < 1000; t++) {
        w.step();
        if (t % 100 !== 0) continue;
        // Yield to the event loop now and then, so vitest's worker RPC doesn't time out on a long synchronous run.
        await new Promise((resolve) => setImmediate(resolve));
        for (const p of w.foodPatches.values()) {
          if (!p.plant) continue;
          expect(p.plant.biomass).toBeGreaterThanOrEqual(0);
          expect(p.plant.roots).toBeGreaterThanOrEqual(0);
          expect(p.stock).toBe(Math.floor(p.plant.biomass));
          expect(w.obstacles.has(`${p.x},${p.y}`)).toBe(false);
        }
      }
      return w;
    };
    const a = await run();
    const b = await run();
    expect(JSON.stringify(Array.from(a.foodPatches.values()))).toBe(JSON.stringify(Array.from(b.foodPatches.values())));
    expect(a.getMetrics().plants!.count).toBeGreaterThan(0);
    expect(a.getMetrics().plants!.grazedTotal).toBeGreaterThan(0);
  }, 180_000);

  it('draw nothing extra from the PRNG when off', () => {
    const a = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  plantsEnabled: false, seed: 'plants-off', gridWidth: 30, gridHeight: 30, initialOrganisms: 20, initialFoodPatches: 22 });
    for (let t = 0; t < 200; t++) a.step();
    expect(a.getMetrics().plants).toBeNull();
    for (const p of a.foodPatches.values()) expect(p.plant).toBeUndefined();
  }, 60_000);
});

/** A hungry organism that will eat what is underfoot (food first). */
function makeEater(world: World, x: number, y: number): Organism {
  const template = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 'eater', gridWidth: 10, gridHeight: 10, initialOrganisms: 1, initialFoodPatches: 0, obstacleDensity: 0 });
  const org = Array.from(template.organisms.values())[0];
  org.x = x;
  org.y = y;
  org.energy = 30;
  return { ...org, id: 'eater-1', policy: { ...org.policy, eatPriority: 2, eatDrive: 2 } };
}
