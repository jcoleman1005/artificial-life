import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { seasonAt } from '../src/sim/seasons';

describe('Seasons', () => {
  const config = { ...DEFAULT_CONFIG, seasonLength: 100, leanFraction: 0.4 };

  it('runs plenty first, then a lean stretch at the end of each cycle', () => {
    expect(seasonAt(0, config)).toEqual({ season: 'plenty', ticksLeft: 60 });
    expect(seasonAt(59, config)).toEqual({ season: 'plenty', ticksLeft: 1 });
    expect(seasonAt(60, config)).toEqual({ season: 'lean', ticksLeft: 40 });
    expect(seasonAt(99, config)).toEqual({ season: 'lean', ticksLeft: 1 });
    expect(seasonAt(100, config)).toEqual({ season: 'plenty', ticksLeft: 60 });
  });

  it('is off when the season length is 0', () => {
    expect(seasonAt(123, { ...config, seasonLength: 0 })).toBeNull();
  });

  /** Total food regrown over a window of ticks in an empty world with one patch. */
  function regrowth(seasonLength: number, fromTick: number, ticks: number): number {
    const world = new World({
      seed: 1,
      gridWidth: 10,
      gridHeight: 10,
      initialOrganisms: 0,
      initialFoodPatches: 0,
      obstacleDensity: 0,
      immigrationInterval: 0,
      foodRegenInterval: 4,
      foodRegenAmount: 1,
      seasonLength,
      leanFraction: 0.5,
      leanSlowdown: 8,
    });
    while (world.tick < fromTick) world.step();
    world.foodPatches.clear();
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 0, capacity: 1000 });
    for (let t = 0; t < ticks; t++) world.step();
    return world.foodPatches.get('5,5')!.stock;
  }

  it('slows food regrowth and stops new patches during a lean season', () => {
    // Cycle of 320: ticks 0-159 plenty, 160-319 lean.
    const plenty = regrowth(320, 0, 128);
    const lean = regrowth(320, 160, 128);
    expect(plenty).toBe(32); // every 4 ticks
    expect(lean).toBe(4); // every 32 ticks

    const world = new World({ seed: 2, seasonLength: 320, leanFraction: 0.5, immigrationInterval: 0 });
    while (world.tick < 160) world.step();
    const patchesAtLeanStart = world.foodPatches.size;
    while (world.tick < 300) world.step();
    expect(world.foodPatches.size).toBe(patchesAtLeanStart);
  });

  it('reports the season in metrics and history', () => {
    const world = new World({ seed: 3, seasonLength: 20, leanFraction: 0.5 });
    for (let t = 0; t < 15; t++) world.step();
    expect(world.getMetrics().season).toBe('lean');
    const samples = world.history.getSamples();
    expect(samples.filter((s) => s.lean).map((s) => s.tick)).toEqual([10, 11, 12, 13, 14, 15]);
  });
});
