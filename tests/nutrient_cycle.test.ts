import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { SoilField, createPlant } from '../src/sim/plants';
import { createConfig } from '../src/sim/config';
import type { Organism, SimulationConfig } from '../src/sim/types';

describe('Nutrient Cycle', () => {
  it('initializes soil nutrients to baseline fertility (1.0 in fertile regions, marginFertility on margins, 0 on obstacles)', () => {
    const config = createConfig({
      gridWidth: 20,
      gridHeight: 20,
      foodRegionCount: 1,
      foodRegionRadius: 5,
      marginFertility: 0.2,
      nutrientCycleEnabled: true,
    });
    const obstacles = new Set<string>(['10,10']);
    const regions = [{ x: 10, y: 10, radius: 5, seasonPhase: 0 }];
    const soil = new SoilField(config, regions, obstacles);

    const w = 20;
    // Obstacle at (10, 10)
    expect(soil.nutrients[10 * w + 10]).toBe(0);
    expect(soil.fertility[10 * w + 10]).toBe(0);

    // Inside region (e.g. 11, 10, dist 1 <= 5)
    expect(soil.nutrients[10 * w + 11]).toBe(1.0);
    expect(soil.fertility[10 * w + 11]).toBe(1.0);

    // Outside region (e.g. 0, 0, dist hypot(10, 10) = 14.1 > 5)
    expect(soil.nutrients[0 * w + 0]).toBeCloseTo(0.2, 5);
    expect(soil.fertility[0 * w + 0]).toBeCloseTo(0.2, 5);
  });

  it('abiotic replenishment relaxes depleted soil towards baseline and diffuses to neighbors', () => {
    const config = createConfig({
      gridWidth: 10,
      gridHeight: 10,
      foodRegionCount: 0, // 1.0 everywhere off obstacles
      nutrientCycleEnabled: true,
      nutrientRegenRate: 0.05,
      nutrientDiffusionRate: 0.2,
    });
    const soil = new SoilField(config, [], new Set());
    const idx = 5 * 10 + 5;
    soil.nutrients[idx] = 0.2; // depleted

    const before = soil.nutrients[idx];
    soil.stepNutrients(config, []);

    // Relaxes towards 1.0 plus neighbor diffusion (neighbors are at 1.0 > 0.2)
    expect(soil.nutrients[idx]).toBeGreaterThan(before);
  });

  it('plant growth draws nutrients from soil', () => {
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */ 
      seed: 'nutrient-plant-draw',
      gridWidth: 20,
      gridHeight: 20,
      obstacleDensity: 0,
      initialOrganisms: 0,
      initialFoodPatches: 0,
      foodRegionCount: 0,
      plantsEnabled: true,
      nutrientCycleEnabled: true,
      nutrientPlantUptake: 0.5,
      nutrientRegenRate: 0, // freeze abiotic regen to measure exact uptake
      nutrientDiffusionRate: 0,
      weatherEnabled: false,
    });

    const soil = world.soil();
    const idx = 5 * 20 + 5;
    expect(soil.nutrients[idx]).toBe(1.0);

    // Add a plant at (5, 5)
    const plant = createPlant(world.plantCounters, {
      growthRate: 0.5,
      maxBiomass: 10,
      seedSize: 1,
      seedThreshold: 1,
      dispersal: 1,
      rootShare: 0,
      leanDormancy: 0,
    }, 2.0, world.tick, null);
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 2, capacity: 10, plant });

    world.step();

    // Plant grew, so soil nutrients at (5, 5) must have decreased
    expect(soil.nutrients[idx]).toBeLessThan(1.0);
    expect(plant.biomass).toBeGreaterThan(2.0);
  });

  it('organism metabolism excretes nutrients underfoot', () => {
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */ 
      seed: 'nutrient-excretion',
      gridWidth: 10,
      gridHeight: 10,
      obstacleDensity: 0,
      initialOrganisms: 1,
      initialFoodPatches: 0,
      foodRegionCount: 0,
      nutrientCycleEnabled: true,
      nutrientExcretion: 0.1,
      nutrientRegenRate: 0,
      nutrientDiffusionRate: 0,
    });

    const soil = world.soil();
    const beforeSum = Array.from(soil.nutrients).reduce((a, b) => a + b, 0);

    world.step();

    const afterSum = Array.from(soil.nutrients).reduce((a, b) => a + b, 0);
    // Organism metabolised energy during action, depositing excreted nutrients into soil
    expect(afterSum).toBeGreaterThan(beforeSum);

    const org = Array.from(world.organisms.values())[0];
    const cellNutrient = soil.nutrients[org.y * 10 + org.x];
    expect(cellNutrient).toBeGreaterThan(1.0);
  });

  it('rotting carrion returns nutrients to soil', () => {
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */ 
      seed: 'nutrient-carrion',
      gridWidth: 10,
      gridHeight: 10,
      obstacleDensity: 0,
      initialOrganisms: 0,
      initialFoodPatches: 0,
      foodRegionCount: 0,
      carrionEnabled: true,
      carrionLifetime: 2,
      nutrientCycleEnabled: true,
      nutrientCarrionDecomp: 0.1,
      nutrientRegenRate: 0,
      nutrientDiffusionRate: 0,
    });

    const soil = world.soil();
    const idx = 4 * 10 + 4;
    const initialNutrient = soil.nutrients[idx];

    // Place expiring carrion at (4, 4)
    world.carrion.set('4,4', {
      x: 4,
      y: 4,
      stock: 20,
      capacity: 20,
      expiresAt: world.tick + 1,
    });

    world.step();

    // Carrion expired and rotted, returning nutrients into soil cell
    expect(soil.nutrients[idx]).toBeGreaterThan(initialNutrient);
    expect(world.carrion.has('4,4')).toBe(false);
  });

  it('triggers local lean state and plant dormancy when soil nutrients drop below threshold', () => {
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */ 
      seed: 'nutrient-dormancy',
      gridWidth: 10,
      gridHeight: 10,
      obstacleDensity: 0,
      initialOrganisms: 0,
      initialFoodPatches: 0,
      foodRegionCount: 0,
      plantsEnabled: true,
      nutrientCycleEnabled: true,
      nutrientLeanThreshold: 0.4,
      nutrientRegenRate: 0,
      nutrientDiffusionRate: 0,
      growthCostFactor: 0,
      plantUpkeep: 0,
    });

    const soil = world.soil();
    const idx = 2 * 10 + 2;
    soil.nutrients[idx] = 0.3; // below 0.4 threshold

    expect(world.isCellLean(2, 2)).toBe(true);

    const sleeper = createPlant(world.plantCounters, {
      growthRate: 0.01,
      maxBiomass: 10,
      seedSize: 1,
      seedThreshold: 1,
      dispersal: 1,
      rootShare: 0,
      leanDormancy: 1.0,
    }, 4.0, world.tick, null);
    world.foodPatches.set('2,2', { x: 2, y: 2, stock: 4, capacity: 10, plant: sleeper });

    world.step();

    expect(sleeper.dormant).toBe(true);
    expect(sleeper.roots).toBeGreaterThan(0);
  });

  it('restores soil nutrients and continues bit-identically after snapshot round trip', () => {
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */ 
      seed: 'nutrient-snap',
      gridWidth: 20,
      gridHeight: 20,
      initialOrganisms: 10,
      initialFoodPatches: 10,
      nutrientCycleEnabled: true,
    });

    for (let t = 0; t < 50; t++) world.step();

    const snapshot = JSON.parse(JSON.stringify(world.exportState()));
    const restored = World.fromState(snapshot);

    expect(Array.from(restored.soil().nutrients)).toEqual(Array.from(world.soil().nutrients));

    for (let t = 0; t < 50; t++) {
      world.step();
      restored.step();
    }

    expect(Array.from(restored.soil().nutrients)).toEqual(Array.from(world.soil().nutrients));
    expect(restored.organisms.size).toBe(world.organisms.size);
    expect(world.stateHash()).toBe(restored.stateHash());
  });
});
