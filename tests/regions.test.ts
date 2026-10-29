import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { FOOD_LAYOUTS, WORLD_SIZES } from '../src/sim/config';
import { regionSeasonAt } from '../src/sim/seasons';

/** A world with regions but no organisms, so only food changes. */
function regionWorld(overrides = {}): World {
  return new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */ 
    plantsEnabled: false,
    seed: 'regions',
    initialOrganisms: 0,
    immigrationInterval: 0,
    foodRegionCount: 4,
    foodRegionRadius: 6,
    seasonLength: 400,
    leanFraction: 0.5,
    windfallsEnabled: false, // windfalls land anywhere
    ...overrides,
  });
}

describe('Food regions', () => {
  it('grows every patch inside its own region', () => {
    const world = regionWorld();
    for (let t = 0; t < 600; t++) world.step();
    expect(world.foodRegions).toHaveLength(4);
    expect(world.foodPatches.size).toBeGreaterThan(20);
    for (const patch of world.foodPatches.values()) {
      const region = world.foodRegions[patch.region!];
      expect(Math.hypot(patch.x - region.x, patch.y - region.y)).toBeLessThanOrEqual(region.radius);
    }
  });

  it('spreads regions out and keeps them inside the world', () => {
    for (const seed of [1, 2, 3, 42]) {
      const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed, initialOrganisms: 0 });
      const { gridWidth, gridHeight, foodRegionRadius: radius } = world.config;
      for (const r of world.foodRegions) {
        expect(r.x).toBeGreaterThanOrEqual(radius);
        expect(r.y).toBeGreaterThanOrEqual(radius);
        expect(r.x).toBeLessThanOrEqual(gridWidth - 1 - radius);
        expect(r.y).toBeLessThanOrEqual(gridHeight - 1 - radius);
        for (const other of world.foodRegions) {
          if (other !== r) expect(Math.hypot(r.x - other.x, r.y - other.y)).toBeGreaterThan(radius * 2);
        }
      }
    }
  });

  it('is repeatable with the same seed', () => {
    const a = regionWorld();
    const b = regionWorld();
    for (let t = 0; t < 300; t++) {
      a.step();
      b.step();
    }
    expect(a.foodRegions).toEqual(b.foodRegions);
    expect(Array.from(a.foodPatches.values())).toEqual(Array.from(b.foodPatches.values()));
  });

  it('draws no regions when they are off', () => {
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...WORLD_SIZES.small, ...FOOD_LAYOUTS.anywhere, seed: 1 });
    expect(world.foodRegions).toHaveLength(0);
    for (const patch of world.foodPatches.values()) expect(patch.region).toBeUndefined();
  });

  it('staggers seasons so regions go lean at different times', () => {
    const world = regionWorld({ staggeredSeasons: true });
    const leanAt = (tick: number) =>
      world.foodRegions.map((r) => regionSeasonAt(tick, r, world.config)?.season === 'lean');
    // Phases 0, 1/4, 1/2, 3/4 of a 400-tick cycle that is lean in its second half
    expect(leanAt(0)).toEqual([false, false, true, true]);
    expect(leanAt(100)).toEqual([false, true, true, false]);
    // In step, every region shares the world's season
    const inStep = regionWorld({ staggeredSeasons: false });
    for (const r of inStep.foodRegions) expect(regionSeasonAt(250, r, inStep.config)?.season).toBe('lean');
  });

  it('regrows food slowly and spawns none in a lean region, normally in a plenty one', () => {
    const world = regionWorld({ staggeredSeasons: true, foodRegenInterval: 4, leanSlowdown: 8 });
    world.foodPatches.clear();
    // Region 0 is in plenty for ticks 0-199; region 2 is lean then.
    const [plenty, lean] = [world.foodRegions[0], world.foodRegions[2]];
    world.foodPatches.set('p', { x: plenty.x, y: plenty.y, stock: 0, capacity: 1000, region: 0 });
    world.foodPatches.set('l', { x: lean.x, y: lean.y, stock: 0, capacity: 1000, region: 2 });
    for (let t = 0; t < 160; t++) world.step();
    expect(world.foodPatches.get('p')!.stock).toBe(40); // every 4 ticks
    expect(world.foodPatches.get('l')!.stock).toBe(5); // every 32 ticks
    const spawned = Array.from(world.foodPatches.values()).filter((p) => p.stock > 0 && p.capacity !== 1000);
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned.every((p) => p.region !== 2)).toBe(true);
  });
});
