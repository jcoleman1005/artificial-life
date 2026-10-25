import { describe, expect, it } from 'vitest';
import { World, type WorldState } from '../src/sim/world';
import type { SimulationConfig } from '../src/sim/types';

/** An empty world (no organisms, no ordinary food) with windfalls every 50 ticks. */
function windfallWorld(overrides: Partial<SimulationConfig> = {}): World {
  return new World({
    seed: 'windfall',
    gridWidth: 30,
    gridHeight: 30,
    initialOrganisms: 0,
    initialFoodPatches: 0,
    foodRegionCount: 0,
    foodSpawnInterval: 9999,
    immigrationInterval: 0,
    windfallsEnabled: true,
    windfallInterval: 50,
    windfallUnits: 40,
    windfallPatches: 5,
    windfallLifetime: 30,
    ...overrides,
  });
}

const windfallPatches = (w: World) => Array.from(w.foodPatches.values()).filter((p) => p.expiresAt !== undefined);

describe('Windfalls', () => {
  it('drops a cluster holding windfallUnits on the interval, on free cells close together', () => {
    const world = windfallWorld({ obstacleDensity: 0.15 });
    for (let t = 0; t < 50; t++) world.step();
    const patches = windfallPatches(world);
    expect(world.windfallsTotal).toBe(1);
    expect(patches.length).toBeGreaterThan(0);
    expect(patches.length).toBeLessThanOrEqual(5);
    expect(patches.reduce((s, p) => s + p.stock, 0)).toBe(40);
    const [c] = patches;
    for (const p of patches) {
      expect(world.obstacles.has(`${p.x},${p.y}`)).toBe(false);
      expect(Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y))).toBeLessThanOrEqual(4);
      expect(p.expiresAt).toBe(80);
    }
  });

  it('never regrows, and rots away uneaten after its lifetime', () => {
    const world = windfallWorld();
    for (let t = 0; t < 50; t++) world.step();
    const [patch] = windfallPatches(world);
    patch.stock -= 3; // as if eaten
    for (let t = 0; t < 29; t++) world.step();
    expect(patch.stock).toBe(patch.capacity - 3); // no regrowth
    world.step(); // tick 80: rots
    expect(windfallPatches(world)).toHaveLength(0);
    expect(world.windfallUnitsPlaced).toBe(40);
    expect(world.windfallUnitsRotted).toBe(37);
  });

  it('arrives in lean seasons too, and does not count against the limit on ordinary patches', () => {
    const world = windfallWorld({ seasonLength: 100, leanFraction: 0.9, staggeredSeasons: false, maxFoodPatches: 3, initialFoodPatches: 3, foodSpawnInterval: 5, windfallLifetime: 500 });
    for (let t = 0; t < 50; t++) world.step(); // tick 50 is lean
    expect(world.worldSeason()).toBe('lean');
    expect(world.windfallsTotal).toBe(1);
    const ordinary = Array.from(world.foodPatches.values()).filter((p) => p.expiresAt === undefined);
    expect(ordinary).toHaveLength(3);
  });

  it('is off by default and with the switch off draws nothing', () => {
    const world = windfallWorld({ windfallsEnabled: false });
    for (let t = 0; t < 200; t++) world.step();
    expect(world.windfallsTotal).toBe(0);
    expect(windfallPatches(world)).toHaveLength(0);
    expect(new World({ seed: 1 }).config.windfallsEnabled).toBe(false);
  });

  it('survives a snapshot: windfalls keep their expiry', () => {
    const world = windfallWorld();
    for (let t = 0; t < 60; t++) world.step();
    const restored = World.fromState(JSON.parse(JSON.stringify(world.exportState())) as WorldState);
    for (let t = 0; t < 40; t++) {
      world.step();
      restored.step();
    }
    expect(restored.windfallUnitsRotted).toBe(world.windfallUnitsRotted);
    expect(Array.from(restored.foodPatches.values())).toEqual(Array.from(world.foodPatches.values()));
  });
});
