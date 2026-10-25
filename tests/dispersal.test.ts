import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { createHeadStartBrain } from '../src/sim/brain';
import { inheritDispersal } from '../src/sim/traits';
import { DEFAULT_CONFIG } from '../src/sim/config';
import type { Organism, PolicyWeights, SimulationConfig } from '../src/sim/types';

const NEUTRAL: PolicyWeights = {
  foodAttraction: 0, obstacleAvoidance: 0, crowdingAvoidance: 0, exploreTendency: 0,
  eatDrive: 0, reproduceDrive: 0, kinAffinity: 0, shareWithKin: 0, shareWithStrangers: 0,
  careForChildren: 0, forageDrive: 0, eatPriority: 0, hungerUrgency: 0, followFoodParent: 0,
  signalOnFood: 0, signalWhenHungry: 0, followSignal: 0, restDrive: 0, avoidOccupied: 0, leapEagerness: 0,
};

/** A parent at (10, 10) keen to reproduce, in an empty world where only births cost energy. */
function birthScene(dispersal: number, overrides: Partial<SimulationConfig> = {}, seed: string | number = 'disperse') {
  const world = new World({
    seed,
    gridWidth: 21,
    gridHeight: 21,
    initialOrganisms: 0,
    initialFoodPatches: 0,
    obstacleDensity: 0,
    foodRegionCount: 0,
    immigrationInterval: 0,
    seasonLength: 0,
    tickMetabolismCost: 0,
    carryUpkeep: 0,
    abilityUpkeep: 0,
    signalsEnabled: false,
    controller: 'dials',
    traitMutationRate: 0,
    ...overrides,
  });
  const parent: Organism = {
    id: 'parent',
    x: 10,
    y: 10,
    energy: 100,
    policy: { ...NEUTRAL, reproduceDrive: 2 },
    tag: 0,
    carryCapacity: 0,
    dispersal,
    abilities: { diagonal: 0, squeeze: 0, leap: 0 },
    brain: createHeadStartBrain(new PRNG(0)),
    lineage: { id: 'lin', parentId: null, generation: 1, birthTick: 0 },
    age: 0,
    offspringCount: 0,
    foodEatenCount: 0,
    carriedFood: 0,
    foodGiven: 0,
    foodReceived: 0,
    signalTick: -1,
    recentHistory: [],
  };
  world.obstacles.delete('10,10'); // the parent's own cell is never a rock
  world.organisms.set(parent.id, parent);
  world.step();
  const child = Array.from(world.organisms.values()).find((o) => o.id !== 'parent')!;
  const distance = Math.abs(child.x - 10) + Math.abs(child.y - 10);
  return { world, parent, child, distance };
}

// Child gets floor(100 × 0.45) = 45 and the parent pays a 5 tax: 50 before dispersal.
const BASE_COST = 50;

describe('Dispersal (inherited birth distance)', () => {
  it('places a child next to the parent at distance 1, at no extra cost', () => {
    const { parent, child, distance } = birthScene(1);
    expect(distance).toBe(1);
    expect(parent.energy).toBe(100 - BASE_COST);
    expect(child.dispersal).toBe(1);
  });

  it('places a child up to the dispersal distance away, charging per step beyond the first', () => {
    const distances = new Set<number>();
    for (let seed = 0; seed < 30; seed++) {
      const { parent, child, distance, world } = birthScene(5, {}, seed);
      expect(distance).toBeGreaterThanOrEqual(1);
      expect(distance).toBeLessThanOrEqual(5);
      expect(parent.energy).toBe(100 - BASE_COST - (distance - 1) * DEFAULT_CONFIG.dispersalCost);
      expect(child.energy).toBe(45);
      expect(world.birthDistanceSum).toBe(distance);
      distances.add(distance);
    }
    // Uniform over free cells within reach, so far cells are common.
    expect(Math.max(...distances)).toBe(5);
  });

  it('never lands a child on a rock or another organism', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { world } = birthScene(4, { obstacleDensity: 0.3 }, seed);
      const cells = new Set<string>();
      for (const o of world.organisms.values()) {
        const key = `${o.x},${o.y}`;
        expect(world.obstacles.has(key)).toBe(false);
        expect(cells.has(key)).toBe(false);
        cells.add(key);
      }
    }
  });

  it('only goes as far as the parent can afford', () => {
    // 50 energy spare after the birth itself, at 20 per extra step: at most 2 extra steps.
    for (let seed = 0; seed < 20; seed++) {
      const { parent, distance } = birthScene(8, { dispersalCost: 20 }, seed);
      expect(distance).toBeLessThanOrEqual(3);
      expect(parent.energy).toBeGreaterThan(0);
    }
  });

  it('is off with the experiment switch: every child is born adjacent', () => {
    for (let seed = 0; seed < 10; seed++) {
      expect(birthScene(6, { dispersalEnabled: false }, seed).distance).toBe(1);
    }
  });

  it('is inherited, shifting by one step at most, never below 1 or above the maximum', () => {
    const prng = new PRNG(7);
    const config = { ...DEFAULT_CONFIG, traitMutationRate: 1, maxDispersal: 4 };
    for (let i = 0; i < 200; i++) {
      const parent = 1 + (i % 4);
      const child = inheritDispersal(parent, config, prng);
      expect(Math.abs(child - parent)).toBeLessThanOrEqual(1);
      expect(child).toBeGreaterThanOrEqual(1);
      expect(child).toBeLessThanOrEqual(4);
    }
    expect(inheritDispersal(3, { ...config, traitMutationRate: 0 }, prng)).toBe(3);
  });

  it('keeps the world valid over a long run: no overlaps, nobody on rocks, positive energy', () => {
    const world = new World({ seed: 'disperse-run', gridWidth: 30, gridHeight: 30, initialOrganisms: 20, initialFoodPatches: 22, maxFoodPatches: 36 });
    for (let t = 0; t < 400; t++) {
      world.step();
      const cells = new Set<string>();
      for (const o of world.organisms.values()) {
        const key = `${o.x},${o.y}`;
        expect(cells.has(key)).toBe(false);
        expect(world.obstacles.has(key)).toBe(false);
        expect(o.energy).toBeGreaterThan(0);
        expect(o.dispersal).toBeGreaterThanOrEqual(1);
        cells.add(key);
      }
    }
    expect(world.birthsTotal).toBeGreaterThan(20);
    expect(world.birthDistanceSum).toBeGreaterThan(world.birthsTotal - 20); // some births went further than 1
  }, 30_000);
});
