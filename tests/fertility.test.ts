import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { createConfig } from '../src/sim/config';
import { createHeadStartBrain } from '../src/sim/brain';
import { SoilField } from '../src/sim/plants';
import { fertileCells } from '../src/sim/grazing';
import type { FoodRegion, Organism, PolicyWeights } from '../src/sim/types';

// Dynamic fertility (docs/decisions.md, "Dynamic fertility"): soil fertility is a live per-cell field.
// Grazing and trampling wear it, nutrients and rain rebuild it, within a floor and a cap.

const REGION: FoodRegion = { x: 10, y: 10, radius: 5, seasonPhase: 0 };
const cfg = (o = {}) => createConfig({ gridWidth: 30, gridHeight: 30, fertilityDynamicEnabled: true, ...o });
const soil = (o = {}) => new SoilField(cfg(o), [REGION], new Set(['3,3']));
const at = (x: number, y: number) => y * 30 + x;

const ZERO_POLICY: PolicyWeights = {
  foodAttraction: 0, obstacleAvoidance: 0, crowdingAvoidance: 0, exploreTendency: 0, eatDrive: 0,
  reproduceDrive: 0, kinAffinity: 0, shareWithKin: 0, shareWithStrangers: 0, careForChildren: 0,
  forageDrive: 0, eatPriority: 0, hungerUrgency: 0, followFoodParent: 0, signalOnFood: 0,
  signalWhenHungry: 0, followSignal: 0, restDrive: 0, avoidOccupied: 0, leapEagerness: 0,
};

function body(overrides: Partial<Organism> = {}): Organism {
  return {
    id: 'o', x: 5, y: 5, energy: 50, policy: ZERO_POLICY, tag: 0, carryCapacity: 2, dispersal: 1,
    memorySpan: 0, carnivory: 0, kills: 0, memoryWeights: [],
    memory: { food: null, signal: null, home: { x: 0, y: 0 }, registers: [0, 0, 0] },
    abilities: { diagonal: 0, squeeze: 0, leap: 0 }, brain: createHeadStartBrain(new PRNG(1)),
    lineage: { id: 'l', parentId: null, generation: 1, birthTick: 0 }, age: 100, offspringCount: 0,
    foodEatenCount: 0, carriedFood: 0, foodGiven: 0, foodReceived: 0, signalTick: -1, recentHistory: [],
    ...overrides,
  };
}

describe('Fertility field', () => {
  it('starts as the original map, with the original kept apart', () => {
    const s = soil();
    expect(s.fertility[at(10, 10)]).toBe(1);
    expect(s.fertility[at(25, 25)]).toBeCloseTo(0.2, 6);
    expect(s.fertility[at(3, 3)]).toBe(0); // rock
    expect(s.baseFertility).not.toBe(s.fertility);
    expect(Array.from(s.baseFertility)).toEqual(Array.from(s.fertility));
  });

  it('with the switch off is one array: nothing extra and nothing changes', () => {
    const s = soil({ fertilityDynamicEnabled: false });
    expect(s.baseFertility).toBe(s.fertility);
    s.addWear(at(10, 10), 1e6); // ignored
    s.applyWear(cfg({ fertilityDynamicEnabled: false }));
    s.stepFertility(cfg({ fertilityDynamicEnabled: false }), null);
    expect(s.fertility[at(10, 10)]).toBe(1);
  });

  it('stays between the floor and the cap, and never touches rock', () => {
    const c = cfg();
    const s = soil();
    for (let i = 0; i < 50; i++) s.addWear(at(10, 10), 1e9); // far more than the cell has
    s.addWear(at(3, 3), 1e9);
    s.applyWear(c);
    expect(s.fertility[at(10, 10)]).toBeCloseTo(c.marginFertility, 6); // the floor
    expect(s.fertility[at(3, 3)]).toBe(0);
    s.nutrients.fill(3); // far more than the cap
    const wet = new Uint8Array(900).fill(255);
    for (let i = 0; i < 4000; i++) s.stepFertility(c, wet);
    for (let i = 0; i < s.fertility.length; i++) {
      if (s.baseFertility[i] > 0) {
        expect(s.fertility[i]).toBeGreaterThanOrEqual(c.marginFertility - 1e-6);
        expect(s.fertility[i]).toBeLessThanOrEqual(c.fertilityMax + 1e-6);
      } else expect(s.fertility[i]).toBe(0);
    }
  });

  it('leaves cells at zero when the margin is zero', () => {
    const c = cfg({ marginFertility: 0 });
    const s = new SoilField(c, [REGION], new Set());
    s.nutrients.fill(1);
    for (let i = 0; i < 500; i++) s.stepFertility(c, new Uint8Array(900).fill(255));
    expect(s.fertility[at(25, 25)]).toBe(0);
  });

  it('wear does not depend on the order it was recorded in', () => {
    const c = cfg();
    const events = [at(10, 10), at(11, 10), at(10, 10), at(12, 12), at(11, 10), at(10, 10)].map((i, k) => [i, 100 + 37 * k] as const);
    const run = (list: readonly (readonly [number, number])[]) => {
      const s = soil();
      for (const [i, m] of list) s.addWear(i, m);
      s.applyWear(c);
      return Array.from(s.fertility);
    };
    expect(run([...events].reverse())).toEqual(run(events));
    expect(run([events[3], events[0], events[5], events[1], events[4], events[2]])).toEqual(run(events));
  });

  it('wears only the cell that was bitten or crossed, and by the set amount', () => {
    const c = cfg();
    const s = soil();
    s.addWear(at(10, 10), Math.round(1e6 * c.fertilityGrazeWear));
    s.applyWear(c);
    expect(s.fertility[at(10, 10)]).toBeCloseTo(1 - c.fertilityGrazeWear, 6);
    expect(s.fertility[at(11, 10)]).toBe(1);
    expect(s.fertility[at(9, 10)]).toBe(1);
  });

  it('rebuilds toward the soil nutrient level, at about the set rate', () => {
    const c = cfg();
    const s = soil();
    s.addWear(at(10, 10), 5e5); // down to 0.5
    s.applyWear(c);
    expect(s.fertility[at(10, 10)]).toBeCloseTo(0.5, 6);
    s.nutrients[at(10, 10)] = 1;
    for (let i = 0; i < 100; i++) s.stepFertility(c, null); // 100 passes of 10 ticks = 1,000 ticks
    const expected = 1 - 0.5 * Math.pow(1 - 10 * c.fertilityRebuildRate, 100);
    expect(s.fertility[at(10, 10)]).toBeCloseTo(expected, 3);
    expect(s.fertility[at(10, 10)]).toBeGreaterThan(0.9); // about 86% of the gap in a thousand ticks
  });

  it('follows the nutrient level down as well as up', () => {
    const c = cfg();
    const s = soil();
    s.nutrients[at(10, 10)] = 0.4; // a depleted cell
    s.nutrients[at(25, 25)] = 0.9; // a rich margin cell
    for (let i = 0; i < 100; i++) s.stepFertility(c, null);
    expect(s.fertility[at(10, 10)]).toBeLessThan(0.7);
    expect(s.fertility[at(25, 25)]).toBeGreaterThan(0.5);
  });

  it('gains where it has been raining, and not at all without weather', () => {
    const c = cfg({ nutrientCycleEnabled: false });
    const wet = new Uint8Array(900).fill(128);
    wet[at(25, 25)] = 255;
    const withRain = soil({ nutrientCycleEnabled: false });
    const without = soil({ nutrientCycleEnabled: false });
    for (let i = 0; i < 200; i++) {
      withRain.stepFertility(c, wet);
      without.stepFertility(c, null);
    }
    expect(withRain.fertility[at(25, 25)]).toBeGreaterThan(without.fertility[at(25, 25)] + 0.05);
    expect(withRain.fertility[at(24, 25)]).toBeCloseTo(without.fertility[at(24, 25)], 6); // dry neighbour
    expect(without.fertility[at(25, 25)]).toBeCloseTo(0.2, 5);
  });

  it('keeps the fertile ground proper (the overgrazing mask) fixed however fertility moves', () => {
    const s = soil();
    const before = fertileCells(s);
    s.addWear(at(10, 10), 9e5);
    s.applyWear(cfg());
    expect(fertileCells(s)).toEqual(before);
  });
});

describe('Fertility in a world', () => {
  it('a body crossing a cell wears that cell by the set amount, after the action phase', () => {
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */ 
      seed: 4, gridWidth: 12, gridHeight: 12, weatherEnabled: false, obstacleDensity: 0, foodRegionCount: 0,
      initialOrganisms: 0, initialFoodPatches: 0, torporEnabled: false, controller: 'dials', terrainEnabled: false,
    });
    const mover = body({ id: 'mover', x: 6, y: 6, energy: 80, policy: { ...ZERO_POLICY, exploreTendency: 2 } });
    world.organisms.set(mover.id, mover);
    world.step();
    expect([mover.x, mover.y]).not.toEqual([6, 6]);
    const f = world.soil().fertility;
    const entered = f[mover.y * 12 + mover.x];
    expect(entered).toBeCloseTo(1 - world.config.fertilityTrampleWear, 6);
    expect(f[6 * 12 + 6]).toBe(1); // the cell it left
  });

  it('is deterministic, and a save carries the live field so a restored world continues identically', () => {
    const a = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 31 });
    const b = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 31 });
    for (let t = 0; t < 150; t++) {
      a.step();
      b.step();
    }
    expect(Array.from(a.soil().fertility)).toEqual(Array.from(b.soil().fertility));
    const base = Array.from(a.soil().baseFertility);
    expect(Array.from(a.soil().fertility)).not.toEqual(base); // it has worn
    const restored = World.fromState(a.exportState());
    expect(restored.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 40; t++) {
      a.step();
      restored.step();
    }
    expect(restored.stateHash()).toBe(a.stateHash());
    expect(Array.from(restored.soil().fertility)).toEqual(Array.from(a.soil().fertility));
  }, 120_000);

  it('with the switch off the fertility never changes, and a save from before it loads with it off', () => {
    const w = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 32, fertilityDynamicEnabled: false });
    for (let t = 0; t < 120; t++) w.step();
    expect(w.soil().fertility).toBe(w.soil().baseFertility);
    const state = w.exportState();
    expect(state.soilFertility).toBeUndefined();

    const on = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 33 });
    for (let t = 0; t < 30; t++) on.step();
    const { soilFertility: _field, ...old } = on.exportState();
    const { fertilityDynamicEnabled: _flag, ...oldConfig } = old.config as unknown as Record<string, unknown>;
    const loaded = World.fromState({ ...old, config: oldConfig as unknown as typeof old.config });
    expect(loaded.config.fertilityDynamicEnabled).toBe(false);
    expect(loaded.soil().fertility).toBe(loaded.soil().baseFertility);
  }, 120_000);

  it('keeps the energy books balanced with dynamic fertility on', () => {
    const w = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 34, ledgerCheckInterval: 1 });
    for (let t = 0; t < 250; t++) w.step();
    expect(w.ledgerReport()!.violations).toBe(0);
  }, 120_000);
});
