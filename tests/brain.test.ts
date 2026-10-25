import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { DEFAULT_CONFIG } from '../src/sim/config';
import {
  BRAIN_HIDDEN,
  BRAIN_INPUT_COUNT,
  HEAD_START_SKIP,
  brainDrift,
  createHeadStartBrain,
  mutateBrain,
} from '../src/sim/brain';
import type { Organism, PolicyWeights, SimulationConfig } from '../src/sim/types';

// Dials are unused under the brain controller; all zero here.
const ZERO_POLICY: PolicyWeights = {
  foodAttraction: 0,
  obstacleAvoidance: 0,
  crowdingAvoidance: 0,
  exploreTendency: 0,
  eatDrive: 0,
  reproduceDrive: 0,
  kinAffinity: 0,
  shareWithKin: 0,
  shareWithStrangers: 0,
  careForChildren: 0,
  forageDrive: 0,
  eatPriority: 0,
  hungerUrgency: 0,
  followFoodParent: 0,
  signalOnFood: 0,
  signalWhenHungry: 0,
  followSignal: 0,
  restDrive: 0,
  avoidOccupied: 0,
  leapEagerness: 0,
};

function brainWorld(overrides: Partial<SimulationConfig> = {}): World {
  return new World({
    seed: 11,
    gridWidth: 10,
    gridHeight: 10,
    initialOrganisms: 0,
    initialFoodPatches: 0,
    obstacleDensity: 0,
    immigrationInterval: 0,
    seasonLength: 0,
    tickMetabolismCost: 0,
    carryUpkeep: 0,
    foodRegenInterval: 9999,
    foodSpawnInterval: 9999,
    controller: 'brain',
    ...overrides,
  });
}

function organism(id: string, x: number, y: number, overrides: Partial<Organism> = {}): Organism {
  return {
    id,
    x,
    y,
    energy: 50,
    policy: ZERO_POLICY,
    tag: 0,
    carryCapacity: 2,
    dispersal: 1,
    memorySpan: 0,
    carnivory: 0,
    kills: 0,
    memoryWeights: [],
    memory: { food: null, signal: null, home: { x: 0, y: 0 }, registers: [0, 0, 0] },
    abilities: { diagonal: 0, squeeze: 0, leap: 0 },
    brain: createHeadStartBrain(new PRNG(1)),
    lineage: { id: `lin-${id}`, parentId: null, generation: 1, birthTick: 0 },
    age: 100,
    offspringCount: 0,
    foodEatenCount: 0,
    carriedFood: 0,
    foodGiven: 0,
    foodReceived: 0,
    signalTick: -1,
    recentHistory: [],
    ...overrides,
  };
}

describe('Brain controller', () => {
  it('has the expected shape and a dial-like head start', () => {
    const brain = createHeadStartBrain(new PRNG(3));
    expect(brain.skip).toEqual(HEAD_START_SKIP);
    expect(brain.hidden).toHaveLength(BRAIN_HIDDEN * BRAIN_INPUT_COUNT);
    expect(brain.out).toHaveLength(BRAIN_HIDDEN);
    expect(brainDrift(brain)).toBe(0);
  });

  it('mutates some weights at birth, within bounds, and never in place', () => {
    const parent = createHeadStartBrain(new PRNG(3));
    const unchanged = mutateBrain(parent, { ...DEFAULT_CONFIG, brainMutationRate: 0 }, new PRNG(4));
    expect(unchanged).toEqual(parent);
    const child = mutateBrain(parent, { ...DEFAULT_CONFIG, brainMutationRate: 0.5, brainMutationStdDev: 100 }, new PRNG(4));
    expect(child).not.toEqual(parent);
    expect(parent.skip).toEqual(HEAD_START_SKIP);
    for (const w of [...child.skip, ...child.hidden, ...child.out]) {
      expect(Math.abs(w)).toBeLessThanOrEqual(40);
    }
  });

  it('with its head start, a hungry organism on food eats', () => {
    const world = brainWorld();
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 3, capacity: 3 });
    world.foodPatches.set('7,5', { x: 7, y: 5, stock: 3, capacity: 3 });
    const o = organism('o', 5, 5, { energy: 20 });
    world.organisms.set(o.id, o);
    world.step();
    expect(o.recentHistory[0].chosenAction.type).toBe('EAT');
    expect('hiddenLayer' in o.recentHistory[0].scores[0].components).toBe(true);
  });

  it('with its head start, a hungry organism heads for visible food', () => {
    const world = brainWorld();
    world.foodPatches.set('7,5', { x: 7, y: 5, stock: 3, capacity: 3 });
    const o = organism('o', 5, 5, { energy: 20 });
    world.organisms.set(o.id, o);
    world.step();
    expect(o.recentHistory[0].chosenAction.type).toBe('MOVE_EAST');
  });

  it('still obeys the legal-action rules (no eating without room for a meal)', () => {
    const world = brainWorld();
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 3, capacity: 3 });
    const o = organism('o', 5, 5, { energy: 90 });
    world.organisms.set(o.id, o);
    world.step();
    expect(o.recentHistory[0].scores.some((s) => s.action.type === 'EAT')).toBe(false);
  });

  it('runs a whole world deterministically, keeping invariants', () => {
    const run = () => {
      const w = new World({ seed: 'brains', controller: 'brain' });
      const violations: string[] = [];
      for (let t = 0; t < 400; t++) {
        w.step();
        const cells = new Set<string>();
        for (const o of w.organisms.values()) {
          if (!(o.energy > 0 && o.energy <= w.config.maxEnergy)) violations.push(`energy ${o.energy}`);
          const key = `${o.x},${o.y}`;
          if (cells.has(key)) violations.push(`overlap ${key}`);
          cells.add(key);
        }
      }
      return { violations, csv: w.history.toCSV(), pop: w.organisms.size };
    };
    const a = run();
    const b = run();
    expect(a.violations).toEqual([]);
    expect(a.csv).toBe(b.csv);
    expect(a.pop).toBeGreaterThan(0);
  }, 60_000);

  it('can switch controller mid-run', () => {
    const w = new World({ seed: 5 });
    for (let t = 0; t < 50; t++) w.step();
    w.config.controller = 'brain';
    for (let t = 0; t < 50; t++) w.step();
    const any = Array.from(w.organisms.values())[0];
    expect('hiddenLayer' in any.recentHistory[0].scores[0].components).toBe(true);
  });
});
